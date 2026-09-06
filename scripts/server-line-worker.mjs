#!/usr/bin/env node
// @req FR-149 — supervised worker, one bounded request at a time.
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
while (!stopping) {
  try {
    const response = await fetch(endpoint, { method: 'POST', redirect: 'error',
      headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(240_000) })
    console.log(JSON.stringify({ event: 'line.worker.tick', status: response.status }))
    await response.body?.cancel()
  } catch { console.error(JSON.stringify({ event: 'line.worker.unavailable' })) }
  if (!stopping) await delay(1000)
}
