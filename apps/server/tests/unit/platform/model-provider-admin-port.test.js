// @req FR-266 — the model-provider admin port proves a key *and the model it will
//   be used with* in one cheap authenticated read, maps every refusal to a stable
//   code, and lets nothing about the key or the provider's error body out.
// @spec ADR-100 D4; SEC-030
// @tested tests/unit/platform/model-provider-admin-port.test.js
import { describe, expect, it, vi } from 'vitest'
import {
  MODEL_PROVIDER_API,
  createModelProviderAdminPort,
  modelProbeUrl,
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
const probe = (provider, model = 'some-model') => ({ provider, apiKey: KEY, model })

describe('model provider admin port', () => {
  it('refuses an unconfigured port rather than falling back to a default fetch', () => {
    expect(() => createModelProviderAdminPort({ fetchFn: null })).toThrow('MODEL_PROVIDER_ADMIN_PORT_CONFIGURATION_INVALID')
    expect(() => createModelProviderAdminPort({ fetchFn: async () => ok(), timeoutMs: 0 })).toThrow('MODEL_PROVIDER_ADMIN_PORT_CONFIGURATION_INVALID')
    expect(() => createModelProviderAdminPort({ fetchFn: async () => ok(), timeoutMs: 120_000 })).toThrow('MODEL_PROVIDER_ADMIN_PORT_CONFIGURATION_INVALID')
  })

  it('reads the one chosen model, not a completion, so validating costs no tokens', async () => {
    const { port: subject, calls } = port(ok)
    await subject.validateKey(probe('anthropic', 'claude-sonnet-5'))
    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe(`${MODEL_PROVIDER_API.anthropic}claude-sonnet-5`)
    expect(calls[0].init.method).toBe('GET')
  })

  it('reads the chosen model at every provider’s own per-model endpoint', async () => {
    const expected = {
      anthropic: 'https://api.anthropic.com/v1/models/claude-sonnet-5',
      openai: 'https://api.openai.com/v1/models/gpt-4o-mini',
      gemini: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash',
      groq: 'https://api.groq.com/openai/v1/models/llama-3.3-70b-versatile',
    }
    const models = { anthropic: 'claude-sonnet-5', openai: 'gpt-4o-mini', gemini: 'gemini-2.0-flash', groq: 'llama-3.3-70b-versatile' }
    for (const [provider, url] of Object.entries(expected)) {
      const { port: subject, calls } = port(ok)
      await subject.validateKey(probe(provider, models[provider]))
      expect(calls[0].url).toBe(url)
    }
  })

  it('encodes the model id as one path segment, so it cannot walk to another endpoint', () => {
    // MODEL_ID_PATTERN admits `/` and `.` for namespaced and fine-tuned ids. Left
    // unencoded, this would leave `/models/` for another endpoint under the owner's key.
    const url = modelProbeUrl('openai', 'a/../../v1/files')
    expect(url).toBe('https://api.openai.com/v1/models/a%2F..%2F..%2Fv1%2Ffiles')
    expect(new URL(url).pathname).toBe('/v1/models/a%2F..%2F..%2Fv1%2Ffiles')
    // A fine-tuned OpenAI id keeps its colons meaningful after decoding.
    expect(decodeURIComponent(modelProbeUrl('openai', 'ft:gpt-4o-mini:org::abc').split('/models/')[1])).toBe('ft:gpt-4o-mini:org::abc')
  })

  it('carries the key in each provider’s own header and never in the URL', async () => {
    for (const [provider, header] of [['anthropic', 'x-api-key'], ['gemini', 'x-goog-api-key']]) {
      const { port: subject, calls } = port(ok)
      await subject.validateKey(probe(provider))
      expect(calls[0].init.headers[header]).toBe(KEY)
      expect(calls[0].url).not.toContain(KEY)
    }
    for (const provider of ['openai', 'groq']) {
      const { port: subject, calls } = port(ok)
      await subject.validateKey(probe(provider))
      expect(calls[0].init.headers.authorization).toBe(`Bearer ${KEY}`)
      expect(calls[0].url).not.toContain(KEY)
    }
  })

  it('returns a provider-scoped validation code on success and nothing from the provider’s body', async () => {
    const { port: subject } = port(() => ({ status: 200, ok: true, json: async () => ({ id: 'gpt-4o-mini', owned_by: 'org_private' }) }))
    const result = await subject.validateKey(probe('openai', 'gpt-4o-mini'))
    expect(result).toEqual({ provider: 'openai', validationCode: 'MODEL_KEY_VALIDATED:OPENAI' })
  })

  it('maps 401 and 403 to one rejection, so a response cannot tell them apart', async () => {
    for (const status of [401, 403]) {
      const { port: subject } = port(() => code(status))
      await expect(subject.validateKey(probe('anthropic'))).rejects.toMatchObject({ code: 'MODEL_KEY_REJECTED', status: 422 })
    }
  })

  it('names a missing model separately from a bad key, so the owner fixes the right field', async () => {
    // The owner's case on 2026-09-21: the key worked and the model id was the
    // question. A listing probe answered only the first; this one answers both.
    const { port: subject } = port(() => code(404))
    await expect(subject.validateKey(probe('openai', 'gpt-4o-minni'))).rejects.toMatchObject({ code: 'MODEL_NOT_FOUND', status: 422 })
  })

  it('reports a malformed request or an outage as our unavailability, never as a bad key or model', async () => {
    for (const status of [400, 429, 500, 503]) {
      const { port: subject } = port(() => code(status))
      await expect(subject.validateKey(probe('anthropic'))).rejects.toMatchObject({ code: 'MODEL_PROVIDER_UNAVAILABLE', status: 503 })
    }
  })

  it('treats a network failure and an abort as unavailable, never as a verdict', async () => {
    const { port: subject } = port(() => { throw new Error('ECONNRESET sk-leaky-in-message') })
    const error = await subject.validateKey(probe('anthropic')).catch(e => e)
    expect(error).toMatchObject({ code: 'MODEL_PROVIDER_UNAVAILABLE', status: 503 })
    // The transport's own message is dropped rather than wrapped: it can quote
    // the request, and the caller only needs the code (SEC-030).
    expect(error.message).toBe('MODEL_PROVIDER_UNAVAILABLE')
    expect(error.cause).toBeUndefined()
  })

  it('refuses a provider it has no probe for before calling anything', async () => {
    const { port: subject, fetchFn } = port(ok)
    await expect(subject.validateKey(probe('ollama'))).rejects.toMatchObject({ code: 'MODEL_PROVIDER_UNSUPPORTED', status: 400 })
    await expect(subject.validateKey(probe('not-a-provider'))).rejects.toMatchObject({ code: 'MODEL_PROVIDER_UNSUPPORTED', status: 400 })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('refuses a missing or malformed model id before calling anything', async () => {
    // It builds a URL from the value, so it does not trust a caller to have checked.
    const { port: subject, fetchFn } = port(ok)
    for (const model of [undefined, '', ' gpt', '../x', 'a b']) {
      await expect(subject.validateKey({ provider: 'openai', apiKey: KEY, model })).rejects.toMatchObject({ code: 'MODEL_ID_INVALID', status: 400 })
    }
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
