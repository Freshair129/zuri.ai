// @req FR-266 — the model-provider admin port proves a key with a cheap
//   authenticated read, maps every refusal to a stable code, and lets nothing about
//   the key or the provider's error body out.
// @spec ADR-100 D4; SEC-030
// @tested tests/unit/platform/model-provider-admin-port.test.js
import { describe, expect, it, vi } from 'vitest'
import {
  MODEL_PROVIDER_API,
  createModelProviderAdminPort,
} from '@/platform/integrations/providers/model/model-provider-admin-port'

const KEY = 'sk-0123456789abcdef0123456789abcdef'

function port(respond) {
  const calls = []
  const fetchFn = vi.fn(async (url, init) => {
    calls.push({ url, init })
    return respond(url, init)
  })
  return { port: createModelProviderAdminPort({ fetchFn }), calls, fetchFn }
}

const ok = () => ({ status: 200, ok: true })
const code = (status) => ({ status, ok: status < 300 })

describe('model provider admin port', () => {
  it('refuses an unconfigured port rather than falling back to a default fetch', () => {
    expect(() => createModelProviderAdminPort({ fetchFn: null })).toThrow('MODEL_PROVIDER_ADMIN_PORT_CONFIGURATION_INVALID')
    expect(() => createModelProviderAdminPort({ fetchFn: async () => ok(), timeoutMs: 0 })).toThrow('MODEL_PROVIDER_ADMIN_PORT_CONFIGURATION_INVALID')
    expect(() => createModelProviderAdminPort({ fetchFn: async () => ok(), timeoutMs: 120_000 })).toThrow('MODEL_PROVIDER_ADMIN_PORT_CONFIGURATION_INVALID')
  })

  it('probes a model listing, not a completion, so validating a key costs no tokens', async () => {
    const { port: subject, calls } = port(ok)
    await subject.validateKey({ provider: 'anthropic', apiKey: KEY })
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(MODEL_PROVIDER_API.anthropic)
    expect(calls[0].init.method).toBe('GET')
  })

  it('carries the key in each provider’s own header and never in the URL', async () => {
    for (const [provider, header] of [['anthropic', 'x-api-key'], ['gemini', 'x-goog-api-key']]) {
      const { port: subject, calls } = port(ok)
      await subject.validateKey({ provider, apiKey: KEY })
      expect(calls[0].init.headers[header]).toBe(KEY)
      expect(calls[0].url).not.toContain(KEY)
    }
    for (const provider of ['openai', 'groq']) {
      const { port: subject, calls } = port(ok)
      await subject.validateKey({ provider, apiKey: KEY })
      expect(calls[0].init.headers.authorization).toBe(`Bearer ${KEY}`)
      expect(calls[0].url).not.toContain(KEY)
    }
  })

  it('returns a provider-scoped validation code on success and nothing from the provider’s body', async () => {
    const { port: subject } = port(() => ({ status: 200, ok: true, json: async () => ({ data: [{ id: 'secret-model', owned_by: 'org_private' }] }) }))
    const result = await subject.validateKey({ provider: 'openai', apiKey: KEY })
    expect(result).toEqual({ provider: 'openai', validationCode: 'MODEL_KEY_VALIDATED:OPENAI' })
  })

  it('maps 401 and 403 to one rejection, so a response cannot tell them apart', async () => {
    for (const status of [401, 403]) {
      const { port: subject } = port(() => code(status))
      await expect(subject.validateKey({ provider: 'anthropic', apiKey: KEY })).rejects.toMatchObject({ code: 'MODEL_KEY_REJECTED', status: 422 })
    }
  })

  it('reports a wrong probe or an outage as our unavailability, never as a bad key', async () => {
    // 400 and 404 mean the probe is wrong for this provider. Calling that a
    // rejected key would tell an owner to replace a key that works.
    for (const status of [400, 404, 429, 500, 503]) {
      const { port: subject } = port(() => code(status))
      await expect(subject.validateKey({ provider: 'anthropic', apiKey: KEY })).rejects.toMatchObject({ code: 'MODEL_PROVIDER_UNAVAILABLE', status: 503 })
    }
  })

  it('treats a network failure and an abort as unavailable, never as a verdict', async () => {
    const { port: subject } = port(() => { throw new Error('ECONNRESET sk-leaky-in-message') })
    const error = await subject.validateKey({ provider: 'anthropic', apiKey: KEY }).catch(e => e)
    expect(error).toMatchObject({ code: 'MODEL_PROVIDER_UNAVAILABLE', status: 503 })
    // The transport's own message is dropped rather than wrapped: it can quote
    // the request, and the caller only needs the code (SEC-030).
    expect(error.message).toBe('MODEL_PROVIDER_UNAVAILABLE')
    expect(error.cause).toBeUndefined()
  })

  it('refuses a provider it has no probe for before calling anything', async () => {
    const { port: subject, fetchFn } = port(ok)
    await expect(subject.validateKey({ provider: 'ollama', apiKey: KEY })).rejects.toMatchObject({ code: 'MODEL_PROVIDER_UNSUPPORTED', status: 400 })
    await expect(subject.validateKey({ provider: 'not-a-provider', apiKey: KEY })).rejects.toMatchObject({ code: 'MODEL_PROVIDER_UNSUPPORTED', status: 400 })
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
