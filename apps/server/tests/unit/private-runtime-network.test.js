// @req FR-267 — native Server provider transport, auth, aliases, TLS and redirect refusal.
// @spec ADR-099 D10, ADR-100 D7
import { describe, it, expect } from 'vitest'
import { createServer } from 'node:http'
import { readFileSync } from 'node:fs'
import { createModelProviderPort } from '@/modules/agent/model-provider'
import { createModelProviderAdminPort } from '@/platform/integrations/providers/model/model-provider-admin-port'
import { readPrivateRuntimeBaseUrl } from '@/platform/integrations/providers/model/private-runtime-config'
import { normalizePrivateRuntimeBaseUrl } from '../../../../services/conversation-runtime/src/private-runtime-config.js'
import { createMockPrivateRuntime } from '../../../../services/conversation-runtime/scripts/mock-private-runtime.mjs'

const KEY = 'synthetic-business-a-key'
async function listen(server, protocol = 'http') {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  return `${protocol}://127.0.0.1:${server.address().port}`
}
async function close(server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
const input = { question: 'q', evidence: { records: [] } }

describe('PRP native transport', () => {
  it('keeps independent URL validators equivalent', () => {
    for (const value of [undefined, '', 'http://127.0.0.1:4000', 'http://localhost:4000', 'http://[::1]:4000',
      'https://172.30.99.10:4443', 'https://prp.example/prefix/', 'http://litellm:4000',
      'https://169.254.169.254', 'https://2852039166', 'https://[::ffff:a9fe:a9fe]',
      'https://metadata.google.internal.', 'https://a:b@prp.example', 'https://prp.example/?x=1']) {
      expect(normalizePrivateRuntimeBaseUrl(value)).toBe(readPrivateRuntimeBaseUrl({ ZURI_PRIVATE_RUNTIME_BASE_URL: value }))
    }
  })

  it('validates a scoped key and alias, and sends a completion through native fetch on loopback', async () => {
    let calls = 0
    const server = createServer(async (req, res) => {
      calls++
      if (req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401); res.end('SECRET_ERROR_BODY'); return }
      res.setHeader('Content-Type', 'application/json')
      if (req.url === '/v1/models') { res.end(JSON.stringify({ object: 'list', data: [{ id: 'local-alias', object: 'model' }] })); return }
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      expect(JSON.parse(Buffer.concat(chunks)).model).toBe('local-alias')
      res.end(JSON.stringify({ choices: [{ message: { content: '<think>private</think>answer' } }] }))
    })
    const baseUrl = await listen(server)
    try {
      const admin = createModelProviderAdminPort()
      await expect(admin.validateKey({ provider: 'prp', apiKey: KEY, model: 'local-alias', baseUrl })).resolves.toMatchObject({ validationCode: 'MODEL_KEY_VALIDATED:PRP' })
      await expect(admin.validateKey({ provider: 'prp', apiKey: 'wrong-business-key', model: 'local-alias', baseUrl })).rejects.toMatchObject({ code: 'MODEL_KEY_REJECTED' })
      await expect(admin.validateKey({ provider: 'prp', apiKey: KEY, model: 'denied-alias', baseUrl })).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND' })
      expect((await createModelProviderPort({ provider: 'prp', credential: KEY, model: 'local-alias', baseUrl }).generate(input)).text).toBe('answer')
      expect(calls).toBe(4)
    } finally { await close(server) }
  })

  it('neither discovery nor completion follows redirects to another origin', async () => {
    let leaked = 0
    const trap = createServer((req, res) => { leaked++; res.end('{}') })
    const trapUrl = await listen(trap)
    const server = createServer((req, res) => { res.writeHead(307, { location: trapUrl }); res.end() })
    const baseUrl = await listen(server)
    try {
      await expect(createModelProviderAdminPort().validateKey({ provider: 'prp', apiKey: KEY, model: 'local-alias', baseUrl })).rejects.toMatchObject({ code: 'MODEL_PROVIDER_UNAVAILABLE' })
      await expect(createModelProviderPort({ provider: 'prp', credential: KEY, model: 'local-alias', baseUrl }).generate(input)).rejects.toThrow('MODEL_PROVIDER_NETWORK_ERROR')
      expect(leaked).toBe(0)
    } finally { await close(server); await close(trap) }
  })

  it('refuses an invalid TLS certificate before sending the key', async () => {
    const fixtureRoot = new URL('../../../../services/conversation-runtime/test/fixtures/prp-tls/', import.meta.url)
    const { server, state } = createMockPrivateRuntime({ cert: readFileSync(new URL('TEST-ONLY-cert.pem', fixtureRoot)), key: readFileSync(new URL('TEST-ONLY-key.pem', fixtureRoot)) })
    const baseUrl = await listen(server, 'https')
    try {
      await expect(createModelProviderAdminPort().validateKey({ provider: 'prp', apiKey: KEY, model: 'local-alias', baseUrl })).rejects.toMatchObject({ code: 'MODEL_PROVIDER_UNAVAILABLE' })
      await expect(createModelProviderPort({ provider: 'prp', credential: KEY, model: 'local-alias', baseUrl }).generate(input)).rejects.toThrow('MODEL_PROVIDER_NETWORK_ERROR')
      expect(state).toEqual({ models: 0, completions: 0, rejected: 0 })
    } finally { await close(server) }
  })
})
