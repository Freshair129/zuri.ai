import { createServer } from 'node:http'

// @req FR-149 — independent liveness and dependency readiness endpoints.
// @spec ADR-106 D5, SDD-108 — readiness is false until the authenticated core port responds.
// @tested services/conversation-runtime/test/health-server.test.js
export function createHealthServer({ isReady = () => false } = {}) {
  return createServer((request, response) => {
    response.setHeader('content-type', 'application/json; charset=utf-8')
    if (request.method === 'GET' && request.url === '/healthz') {
      response.writeHead(200).end(JSON.stringify({ status: 'UP' }))
      return
    }
    if (request.method === 'GET' && request.url === '/readyz') {
      const ready = isReady()
      response.writeHead(ready ? 200 : 503).end(JSON.stringify({ status: ready ? 'READY' : 'NOT_READY' }))
      return
    }
    response.writeHead(404).end()
  })
}
