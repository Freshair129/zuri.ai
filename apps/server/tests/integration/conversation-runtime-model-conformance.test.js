import { describe, expect, it } from 'vitest'
import { createModelProviderPort, PRIVATE_RUNTIME_PROVIDERS, PUBLIC_LINE_PROVIDERS } from '@/modules/agent/model-provider'
import { createModelPort } from '../../../../services/conversation-runtime/src/model-port.js'

// @req FR-048, FR-149, FR-171 — the extracted provider adapter preserves LINE provider behavior.
// @spec ADR-106 D2, SDD-108 — compare the deployed Server consumer and isolated Runtime consumer.
// @tested tests/integration/conversation-runtime-model-conformance.test.js
const question = 'ราคาเท่าไร'
const evidence = { records: [{ product_code: 'A1', name: 'สินค้าทดสอบ', sell_price: 12 }] }
const credentialValue = 'synthetic-provider-key'
const providerReplies = {
  openrouter: { choices: [{ message: { content: 'คำตอบ' } }] },
  openai: { output_text: 'คำตอบ' },
  anthropic: { content: [{ type: 'text', text: 'คำตอบ' }] },
  gemini: { candidates: [{ content: { parts: [{ text: 'คำตอบ' }] } }] },
  groq: { choices: [{ message: { content: 'คำตอบ' } }] },
  prp: { choices: [{ message: { content: 'คำตอบ' } }] },
}

function captureFetch(body, calls) {
  return async (url, options) => {
    calls.push({ url: String(url), method: options.method, headers: Object.fromEntries(new Headers(options.headers)), body: JSON.parse(options.body) })
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

describe('Conversation Runtime provider consumer conformance', () => {
  it.each([...PUBLIC_LINE_PROVIDERS, ...PRIVATE_RUNTIME_PROVIDERS])('matches the legacy %s request and response contract', async provider => {
    const oldCalls = []
    const newCalls = []
    const baseUrl = provider === 'prp' ? 'https://prp.example' : undefined
    const legacy = createModelProviderPort({ provider, model: 'test-model', credential: credentialValue,
      baseUrl, timeoutMs: 1000, fetchFn: captureFetch(providerReplies[provider], oldCalls) })
    const runtime = createModelPort({ timeoutMs: 1000, fetchFn: captureFetch(providerReplies[provider], newCalls) })
    const legacyResult = await legacy.generate({ question, evidence, contextPacket: null })
    const runtimeResult = await runtime.generate({ question, evidence, contextPacket: null,
      credential: { provider, model: 'test-model', apiKey: credentialValue, ...(baseUrl ? { baseUrl } : {}) },
      deadlineAt: new Date(Date.now() + 5000).toISOString() })

    expect(runtimeResult).toBe(legacyResult.text)
    expect(newCalls).toEqual(oldCalls)
    expect(JSON.stringify(runtimeResult)).not.toContain(credentialValue)
  })

  it.each([
    ['HTTP failure', () => new Response('private body', { status: 503 }), 'MODEL_PROVIDER_HTTP_503'],
    ['invalid JSON', () => new Response('{', { status: 200 }), 'MODEL_PROVIDER_INVALID_JSON'],
    ['empty response', () => new Response(JSON.stringify({ output_text: '  ' }), { status: 200 }), 'MODEL_PROVIDER_EMPTY_RESPONSE'],
  ])('matches legacy provider errors for %s', async (_label, response, expected) => {
    const config = { provider: 'openai', model: 'test-model', credential: credentialValue, timeoutMs: 1000 }
    const legacy = createModelProviderPort({ ...config, fetchFn: async () => response() })
    const runtime = createModelPort({ timeoutMs: 1000, fetchFn: async () => response() })
    const input = { question, evidence, contextPacket: null }
    const runtimeInput = { ...input, credential: { provider: 'openai', model: 'test-model', apiKey: credentialValue },
      deadlineAt: new Date(Date.now() + 5000).toISOString() }
    await expect(legacy.generate(input)).rejects.toMatchObject({ message: expected })
    await expect(runtime.generate(runtimeInput)).rejects.toMatchObject({ message: expected })
  })

  it('matches the legacy provider deadline and typed timeout result', async () => {
    const waitingFetch = async (_url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
    })
    const legacy = createModelProviderPort({ provider: 'openai', model: 'test-model', credential: credentialValue,
      timeoutMs: 100, fetchFn: waitingFetch })
    const runtime = createModelPort({ timeoutMs: 100, fetchFn: waitingFetch })
    const input = { question, evidence, contextPacket: null }
    await expect(legacy.generate(input)).rejects.toMatchObject({ message: 'MODEL_PROVIDER_TIMEOUT' })
    await expect(runtime.generate({ ...input, credential: { provider: 'openai', model: 'test-model', apiKey: credentialValue },
      deadlineAt: new Date(Date.now() + 5000).toISOString() })).rejects.toMatchObject({ message: 'MODEL_PROVIDER_TIMEOUT' })
  })
})
