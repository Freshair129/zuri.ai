import { describe, expect, it, vi } from 'vitest'
import { createModelProviderPort } from '@/modules/agent/model-provider'

// @req FR-171 — exact model-call evidence, nullable provider usage and failure propagation.
// @spec ADR-070

function response(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

function portFor(provider, body, options = {}) {
  return createModelProviderPort({
    provider,
    model: 'trace-model',
    credential: provider === 'ollama' ? undefined : 'trace-secret',
    runtimeSource: provider === 'ollama' ? 'TEST' : undefined,
    baseUrl: provider === 'ollama' ? 'http://127.0.0.1:11434' : 'https://provider.test/v1',
    fetchFn: vi.fn(async () => response(body, options.response)),
    timeoutMs: options.timeoutMs ?? 1000,
  })
}

const input = { question: 'ราคาเท่าไร', evidence: { records: [] } }

describe('ModelProviderPort execution trace v0.3', () => {
  it('awaits before, passes its handle to after, excludes transport secrets, and preserves full output', async () => {
    const fullOutput = 'x'.repeat(6001)
    const order = []
    const after = vi.fn(async payload => {
      order.push('after')
      expect(payload).toMatchObject({
        provider: 'openai',
        model: 'trace-model',
        handle: { ctxId: 'ctx-1', modelCallId: 'call-1' },
        outputText: fullOutput,
        errorCode: null,
        providerRequestId: 'request-1',
        usage: {
          inputTokens: 10,
          outputTokens: 6,
          totalTokens: 16,
          cachedInputTokens: 4,
          reasoningTokens: 2,
        },
        usageSource: 'PROVIDER_REPORTED',
        totalTokensSource: 'PROVIDER_REPORTED',
      })
      expect(payload.startedAt).toEqual(expect.any(String))
      expect(payload.finishedAt).toEqual(expect.any(String))
      expect(payload.durationMs).toEqual(expect.any(Number))
      expect(payload).not.toHaveProperty('providerUsage')
      expect(payload).not.toHaveProperty('completedAt')
      expect(payload).not.toHaveProperty('startedAtUtc')
      expect(payload).not.toHaveProperty('finishedAtUtc')
      expect(JSON.stringify(payload)).not.toContain('trace-secret')
      expect(JSON.stringify(payload)).not.toContain('provider.test')
    })
    const before = vi.fn(async payload => {
      order.push('before')
      expect(payload.provider).toBe('openai')
      expect(payload.model).toBe('trace-model')
      expect(payload.promptVersion).toEqual(expect.any(String))
      expect(payload.systemPrompt).toMatchObject({
        id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
        version: payload.promptVersion,
        content: expect.stringContaining('EVIDENCE JSON'),
        hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      })
      expect(payload.systemPrompt.content).not.toContain('ราคาเท่าไร')
      expect(payload.systemPrompt.content).not.toContain('records')
      expect(payload.requestBody).toMatchObject({ model: 'trace-model', max_output_tokens: 500 })
      expect(payload.requestBody).not.toHaveProperty('headers')
      expect(payload.requestBody).not.toHaveProperty('url')
      expect(JSON.stringify(payload)).not.toContain('trace-secret')
      return { ctxId: 'ctx-1', modelCallId: 'call-1' }
    })
    const fetchFn = vi.fn(async () => {
      order.push('fetch')
      return response({
        id: 'response-1',
        output_text: fullOutput,
        usage: {
          input_tokens: 10,
          input_tokens_details: { cached_tokens: 4 },
          output_tokens: 6,
          output_tokens_details: { reasoning_tokens: 2 },
          total_tokens: 16,
        },
      }, { headers: { 'x-request-id': 'request-1' } })
    })
    const port = createModelProviderPort({
      provider: 'openai',
      model: 'trace-model',
      credential: 'trace-secret',
      fetchFn,
      timeoutMs: 1000,
    })

    const result = await port.generate({ ...input, trace: { beforeModelCall: before, afterModelCall: after } })

    expect(order).toEqual(['before', 'fetch', 'after'])
    expect(before).toHaveBeenCalledTimes(1)
    expect(after).toHaveBeenCalledTimes(1)
    expect(result.text).toHaveLength(5000)
    expect(result.usage).toMatchObject({ inputTokens: 10, outputTokens: 6, totalTokens: 16, cachedInputTokens: 4 })
    expect(JSON.stringify(result)).not.toContain('trace-secret')
  })

  it.each([
    ['openai', {
      output_text: 'openai',
      usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 3 } },
    }, { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 3 }, usageSource: 'PROVIDER_REPORTED', totalTokensSource: 'PROVIDER_REPORTED' }],
    ['anthropic', {
      content: [{ type: 'text', text: 'anthropic' }],
      usage: { input_tokens: 10, cache_creation_input_tokens: 2, cache_read_input_tokens: 3, output_tokens: 5 },
    }, { usage: { inputTokens: 15, outputTokens: 5, totalTokens: 20, cachedInputTokens: 3 }, usageSource: 'PROVIDER_REPORTED', totalTokensSource: 'DERIVED_FROM_PROVIDER_COUNTS' }],
    ['gemini', {
      candidates: [{ content: { parts: [{ text: 'gemini' }] } }],
      usageMetadata: { promptTokenCount: 10, cachedContentTokenCount: 3, candidatesTokenCount: 5, thoughtsTokenCount: 3, totalTokenCount: 18 },
    }, { usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18, cachedInputTokens: 3, reasoningTokens: 3 }, usageSource: 'PROVIDER_REPORTED', totalTokensSource: 'PROVIDER_REPORTED' }],
    ['openrouter', {
      choices: [{ message: { content: 'openrouter' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 3 } },
    }, { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 3 }, usageSource: 'PROVIDER_REPORTED', totalTokensSource: 'PROVIDER_REPORTED' }],
    ['groq', {
      choices: [{ message: { content: 'groq' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }, { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: null }, usageSource: 'PROVIDER_REPORTED', totalTokensSource: 'PROVIDER_REPORTED' }],
    ['ollama', {
      response: 'ollama', prompt_eval_count: 10, prompt_eval_cached_count: 3, eval_count: 5,
    }, { usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, cachedInputTokens: 3 }, usageSource: 'PROVIDER_REPORTED', totalTokensSource: 'DERIVED_FROM_PROVIDER_COUNTS' }],
  ])('normalizes %s usage and keeps provider subsets out of totals', async (provider, body, expected) => {
    const after = vi.fn()
    const port = portFor(provider, body)
    const result = await port.generate({ ...input, trace: { afterModelCall: after } })

    expect(result.usage).toMatchObject(expected.usage)
    expect(result).toMatchObject({ usageSource: expected.usageSource, totalTokensSource: expected.totalTokensSource })
    expect(after).toHaveBeenCalledWith(expect.objectContaining({
      usage: expect.objectContaining(expected.usage),
      usageSource: expected.usageSource,
      totalTokensSource: expected.totalTokensSource,
    }))
  })

  it('keeps absent usage fields nullable instead of inventing zeroes', async () => {
    const after = vi.fn()
    const port = portFor('openai', { output_text: 'no usage' })

    await port.generate({ ...input, trace: { afterModelCall: after } })

    expect(after.mock.calls[0][0].usage).toEqual({
      inputTokens: null,
      outputTokens: null,
      totalTokens: null,
      cachedInputTokens: null,
      reasoningTokens: null,
    })
    expect(after.mock.calls[0][0]).toMatchObject({ usageSource: 'UNAVAILABLE', totalTokensSource: 'UNAVAILABLE' })
  })

  it('records stable provider errors without passing raw errors to the observer', async () => {
    const after = vi.fn()
    const port = portFor('openrouter', { error: { message: 'secret provider detail' } }, {
      response: { status: 429, headers: { 'x-request-id': 'request-429' } },
    })

    await expect(port.generate({ ...input, trace: { afterModelCall: after } })).rejects.toThrow('MODEL_PROVIDER_HTTP_429')
    expect(after).toHaveBeenCalledWith(expect.objectContaining({
      errorCode: 'MODEL_PROVIDER_HTTP_429',
      outputText: null,
      providerRequestId: 'request-429',
    }))
    expect(JSON.stringify(after.mock.calls[0][0])).not.toContain('secret provider detail')
  })

  it('does not call the network when beforeModelCall fails, and propagates after failures', async () => {
    const fetchFn = vi.fn()
    const beforeFailure = new Error('TRACE_WRITE_FAILED')
    const before = vi.fn(async () => { throw beforeFailure })
    const port = createModelProviderPort({
      provider: 'openai', model: 'trace-model', credential: 'trace-secret', fetchFn, timeoutMs: 1000,
    })

    await expect(port.generate({ ...input, trace: { beforeModelCall: before } })).rejects.toBe(beforeFailure)
    expect(fetchFn).not.toHaveBeenCalled()

    const afterFailure = new Error('TRACE_AFTER_FAILED')
    const after = vi.fn(async () => { throw afterFailure })
    const successfulPort = createModelProviderPort({
      provider: 'openai', model: 'trace-model', credential: 'trace-secret',
      fetchFn: vi.fn(async () => response({ output_text: 'answer' })), timeoutMs: 1000,
    })
    await expect(successfulPort.generate({ ...input, trace: { afterModelCall: after } })).rejects.toBe(afterFailure)
    expect(after).toHaveBeenCalledTimes(1)
  })

  it('bounds response JSON parsing with the configured timeout', async () => {
    const after = vi.fn()
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: () => new Promise(() => {}),
    }))
    const port = createModelProviderPort({
      provider: 'openai', model: 'trace-model', credential: 'trace-secret', fetchFn, timeoutMs: 100,
    })

    await expect(port.generate({ ...input, trace: { afterModelCall: after } })).rejects.toThrow('MODEL_PROVIDER_TIMEOUT')
    expect(after).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'MODEL_PROVIDER_TIMEOUT' }))
  })
})
