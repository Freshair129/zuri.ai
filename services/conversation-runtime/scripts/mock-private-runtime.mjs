// @req FR-267 — GPU-free synthetic provider fixture, never a production gateway.
// @tested services/conversation-runtime/test/private-runtime-network.test.js
import { createServer } from 'node:https'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

export function createMockPrivateRuntime({ cert, key, redirectUrl, expectedHost } = {}) {
  const state = { models: 0, completions: 0, rejected: 0 }
  const server = createServer({ cert, key }, async (req, res) => {
    const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
    if (req.url === '/healthz') return send(200, { status: 'MOCK_ONLY' })
    if (expectedHost && req.headers.host !== expectedHost) return send(421, { error: 'WRONG_VIRTUAL_HOST' })
    if (redirectUrl) { res.writeHead(307, { location: redirectUrl }); res.end(); return }
    if (req.headers.authorization !== 'Bearer synthetic-business-a-key') { state.rejected++; return send(401, { error: 'SYNTHETIC_KEY_REJECTED' }) }
    if (req.url === '/v1/models' && req.method === 'GET') {
      state.models++
      return send(200, { object: 'list', data: [{ id: 'local-alias', object: 'model' }] })
    }
    if (req.url !== '/v1/chat/completions' || req.method !== 'POST') return send(404, {})
    let size = 0
    const chunks = []
    for await (const chunk of req) {
      size += chunk.length
      if (size > 1024 * 1024) return send(413, {})
      chunks.push(chunk)
    }
    let body
    try { body = JSON.parse(Buffer.concat(chunks)) } catch { return send(400, {}) }
    if (Object.keys(body).some(k => !['model', 'messages', 'max_tokens', 'stream'].includes(k))) return send(400, { error: 'UNSUPPORTED_PARAMETER' })
    if (body.model !== 'local-alias') return send(body.model === 'business-b-alias' ? 403 : 404, { error: 'ALIAS_NOT_GRANTED' })
    state.completions++
    return send(200, { id: 'synthetic-call', object: 'chat.completion', model: 'local-alias',
      choices: [{ message: { role: 'assistant', content: '<think>private synthetic reasoning</think>PRP synthetic qualification' }, finish_reason: 'stop' }] })
  })
  return { server, state }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = createMockPrivateRuntime({ cert: readFileSync(process.env.MOCK_PRP_CERT_FILE), key: readFileSync(process.env.MOCK_PRP_KEY_FILE),
    expectedHost: process.env.MOCK_PRP_EXPECT_HOST })
  server.listen(Number(process.env.MOCK_PRP_PORT ?? 4443), '0.0.0.0')
  const close = () => { server.closeAllConnections(); server.close() }
  process.once('SIGTERM', close)
  process.once('SIGINT', close)
}
