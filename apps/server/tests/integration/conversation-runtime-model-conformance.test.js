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

function emptyReply(provider) {
  if (provider === 'openai') return { output_text: '  ' }
  if (provider === 'anthropic') return { content: [{ type: 'text', text: '  ' }] }
  if (provider === 'gemini') return { candidates: [{ content: { parts: [{ text: '  ' }] } }] }
  return { choices: [{ message: { content: '  ' } }] }
}

function abortAwareFetch(_url, { signal }) {
  return new Promise((_, reject) => {
    if (signal.aborted) return reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true })
  })
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

  it.each([...PUBLIC_LINE_PROVIDERS, ...PRIVATE_RUNTIME_PROVIDERS].flatMap(provider => [
    ['HTTP failure', provider, () => new Response('private provider body', { status: 503 }), 'MODEL_PROVIDER_HTTP_503'],
    ['invalid JSON', provider, () => new Response('{', { status: 200 }), 'MODEL_PROVIDER_INVALID_JSON'],
    ['empty response', provider, () => new Response(JSON.stringify(emptyReply(provider)), { status: 200 }), 'MODEL_PROVIDER_EMPTY_RESPONSE'],
    ['network failure', provider, async () => { throw new Error('synthetic network detail') }, 'MODEL_PROVIDER_NETWORK_ERROR'],
  ]))('matches legacy %s error contract for %s', async (_label, provider, response, expected) => {
    const baseUrl = provider === 'prp' ? 'https://prp.example' : undefined
    const legacy = createModelProviderPort({ provider, model: 'test-model', credential: credentialValue, baseUrl,
      timeoutMs: 1000, fetchFn: response })
    const runtime = createModelPort({ timeoutMs: 1000, fetchFn: response })
    const input = { question, evidence, contextPacket: null }
    const runtimeInput = { ...input, credential: { provider, model: 'test-model', apiKey: credentialValue,
      ...(baseUrl ? { baseUrl } : {}) }, deadlineAt: new Date(Date.now() + 5000).toISOString() }
    await expect(legacy.generate(input)).rejects.toMatchObject({ message: expected })
    await expect(runtime.generate(runtimeInput)).rejects.toMatchObject({ message: expected })
  })

  it.each([...PUBLIC_LINE_PROVIDERS, ...PRIVATE_RUNTIME_PROVIDERS])('matches legacy %s caller deadline timeout', async provider => {
    const baseUrl = provider === 'prp' ? 'https://prp.example' : undefined
    const legacy = createModelProviderPort({ provider, model: 'test-model', credential: credentialValue, baseUrl,
      timeoutMs: 100, fetchFn: abortAwareFetch })
    // The Runtime's local safety timeout is longer; the caller's operation deadline
    // is the bound that must stop the provider request.
    const runtime = createModelPort({ timeoutMs: 5000, fetchFn: abortAwareFetch })
    const deadlineAt = new Date(Date.now() + 100).toISOString()
    const input = { question, evidence, contextPacket: null }
    const [legacyResult, runtimeResult] = await Promise.allSettled([
      legacy.generate(input),
      runtime.generate({ ...input, credential: { provider, model: 'test-model', apiKey: credentialValue,
        ...(baseUrl ? { baseUrl } : {}) }, deadlineAt }),
    ])
    expect(legacyResult).toMatchObject({ status: 'rejected', reason: { message: 'MODEL_PROVIDER_TIMEOUT' } })
    expect(runtimeResult).toMatchObject({ status: 'rejected', reason: { message: 'MODEL_PROVIDER_TIMEOUT' } })
  })

  it.each([
    ['complete reasoning block', '<think>private reasoning</think>safe answer', 'safe answer'],
    ['orphan closing tag', 'private reasoning</think>safe answer', 'safe answer'],
    ['unfinished reasoning block', 'safe answer<think>private reasoning', 'safe answer'],
  ])('preserves the legacy PRP %s filter', async (_label, content, expected) => {
    const body = { choices: [{ message: { content } }] }
    const legacy = createModelProviderPort({ provider: 'prp', model: 'test-model', credential: credentialValue,
      baseUrl: 'https://prp.example', timeoutMs: 1000, fetchFn: async () => new Response(JSON.stringify(body)) })
    const runtime = createModelPort({ timeoutMs: 1000, fetchFn: async () => new Response(JSON.stringify(body)) })
    const input = { question, evidence, contextPacket: null }
    const legacyResult = await legacy.generate(input)
    const runtimeResult = await runtime.generate({ ...input,
      credential: { provider: 'prp', model: 'test-model', apiKey: credentialValue, baseUrl: 'https://prp.example' },
      deadlineAt: new Date(Date.now() + 5000).toISOString() })
    expect(legacyResult.text).toBe(expected)
    expect(runtimeResult).toBe(expected)
  })

  it('fails closed when a PRP answer contains reasoning only', async () => {
    const body = { choices: [{ message: { content: '<think>private reasoning</think>' } }] }
    const legacy = createModelProviderPort({ provider: 'prp', model: 'test-model', credential: credentialValue,
      baseUrl: 'https://prp.example', timeoutMs: 1000, fetchFn: async () => new Response(JSON.stringify(body)) })
    const runtime = createModelPort({ timeoutMs: 1000, fetchFn: async () => new Response(JSON.stringify(body)) })
    await expect(legacy.generate({ question, evidence })).rejects.toMatchObject({ message: 'MODEL_PROVIDER_EMPTY_RESPONSE' })
    await expect(runtime.generate({ question, evidence,
      credential: { provider: 'prp', model: 'test-model', apiKey: credentialValue, baseUrl: 'https://prp.example' },
      deadlineAt: new Date(Date.now() + 5000).toISOString() })).rejects.toMatchObject({ message: 'MODEL_PROVIDER_EMPTY_RESPONSE' })
  })

  it.each(PUBLIC_LINE_PROVIDERS)('records the legacy %s custom endpoint discrepancy without broadening Runtime routing', async provider => {
    const override = 'https://compatibility.example/v1/custom'
    const calls = []
    const legacy = createModelProviderPort({ provider, model: 'test-model', credential: credentialValue, baseUrl: override,
      timeoutMs: 1000, fetchFn: captureFetch(providerReplies[provider], calls) })
    await legacy.generate({ question, evidence })
    expect(calls[0].url).toBe(override)

    const runtime = createModelPort({ timeoutMs: 1000, fetchFn: captureFetch(providerReplies[provider], []) })
    await expect(runtime.generate({ question, evidence,
      credential: { provider, model: 'test-model', apiKey: credentialValue, baseUrl: override },
      deadlineAt: new Date(Date.now() + 5000).toISOString() })).rejects.toMatchObject({ message: 'MODEL_BASE_URL_NOT_ALLOWED' })
  })
})
