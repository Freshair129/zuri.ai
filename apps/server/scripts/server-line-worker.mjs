#!/usr/bin/env node
// @req FR-149, FR-152 — supervised worker, one bounded request at a time:
//   a conversation tick, then a rich menu tick, on the same bearer.
// @spec ADR-061
// @tested tests/integration/server-line-jobs.test.js
import { setTimeout as delay } from 'node:timers/promises'
const endpoint = new URL(process.env.ZURI_LINE_WORKER_URL || 'http://web:3000/api/line-oa/worker')
const token = process.env.ZURI_LINE_WORKER_TOKEN
if (!token || token.length < 32) throw new Error('ZURI_LINE_WORKER_TOKEN_REQUIRED')
if (endpoint.username || endpoint.password || endpoint.pathname !== '/api/line-oa/worker'
  || (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['web','localhost','127.0.0.1','[::1]'].includes(endpoint.hostname)))) throw new Error('LINE_WORKER_URL_INVALID')
let stopping = false
process.on('SIGTERM', () => { stopping = true })
process.on('SIGINT', () => { stopping = true })
const richMenuEndpoint = new URL('/api/line-oa/rich-menu-worker', endpoint)
async function tick(url, event) {
  try {
    const response = await fetch(url, { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(240_000) })
    console.log(JSON.stringify({ event, status: response.status }))
    await response.body?.cancel()
  } catch { console.error(JSON.stringify({ event: `${event}.unavailable` })) }
}
while (!stopping) {
  await tick(endpoint, 'line.worker.tick')
  if (!stopping) await tick(richMenuEndpoint, 'line.rich-menu-worker.tick')
  if (!stopping) await delay(1000)
}
