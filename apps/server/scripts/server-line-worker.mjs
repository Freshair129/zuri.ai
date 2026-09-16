#!/usr/bin/env node
// @req FR-149, FR-152 — supervised worker, one bounded request at a time:
//   a conversation tick, then a rich menu tick, on the same bearer.
// @spec ADR-061
// @tested tests/integration/server-line-jobs.test.js
import { setTimeout as delay } from 'node:timers/promises'
import { IDLE_START_MS, RICH_MENU_MIN_INTERVAL_MS, didWork, nextCadence } from './worker-cadence.mjs'
const endpoint = new URL(process.env.ZURI_LINE_WORKER_URL || 'http://web:3000/api/line-oa/worker')
const token = process.env.ZURI_LINE_WORKER_TOKEN
if (!token || token.length < 32) throw new Error('ZURI_LINE_WORKER_TOKEN_REQUIRED')
if (endpoint.username || endpoint.password || endpoint.pathname !== '/api/line-oa/worker'
  || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['web','localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)))) throw new Error('LINE_WORKER_URL_INVALID')
let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })
const richMenuEndpoint = new URL('/api/line-oa/rich-menu-worker', endpoint)

// This loop ran at a flat 1 s, awake or not. That is ~86,400 rounds a day, and an idle round is not
// free: the conversation tick alone runs four maintenance updates and four reads against a Postgres
// that is not in this datacentre. On a day the queue handled twelve jobs, essentially all of that
// traffic asked "anything yet?" and was told no — while competing for the same connection pool the
// webhook needs to answer LINE inside its ~1 s tolerance.
//
// So the cadence follows the work: quick while there is any, backing off geometrically while there
// is none. A productive round resets it immediately, so a busy period runs *faster* than the old
// flat second rather than slower. The idle ceiling is affordable because it is no longer what a
// waiting customer experiences — admission nudges this endpoint directly the moment an event is
// admitted (see `admitCapturedLineEvents`), and this loop is the floor underneath that nudge.

/** True when the tick did work — the one signal the cadence is derived from. */
async function tick(url, event) {
  try {
    const response = await fetch(url, { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(240_000) })
    // The body is what says whether anything happened; both workers report `status: 'IDLE'` for a
    // round that found nothing. Reading it also consumes the stream, which the cancel() did before.
    const body = await response.json().catch(() => null)
    console.log(JSON.stringify({ event, status: response.status,
      ...(body?.status ? { outcome: body.status } : {}),
      ...(Number.isInteger(body?.executed) ? { executed: body.executed, sent: body.sent } : {}) }))
    return didWork(response.ok, body)
  } catch { console.error(JSON.stringify({ event: `${event}.unavailable` })); return false }
}

let idleMs = IDLE_START_MS
let richMenuCheckedAt = 0
while (!stopping) {
  let worked = await tick(endpoint, 'line.worker.tick')
  if (!stopping && Date.now() - richMenuCheckedAt >= RICH_MENU_MIN_INTERVAL_MS) {
    richMenuCheckedAt = Date.now()
    worked = await tick(richMenuEndpoint, 'line.rich-menu-worker.tick') || worked
  }
  if (stopping) break
  const cadence = nextCadence({ worked, idleMs })
  idleMs = cadence.idleMs
  await delay(cadence.delayMs)
}
