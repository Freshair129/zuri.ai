import { describe, it, expect, vi } from 'vitest'
import { createModelProviderPort, PUBLIC_LINE_PROVIDERS } from '@/modules/agent/model-provider'

// @req FR-048 — provider/auth choice is normalized and public LINE denies subscription CLIs.
// @req FR-079 — the main-dev local Ollama source remains keyless and source-bound.
// @spec SDD-025, SEC-009
// @tested tests/unit/model-provider-port.test.js

const cases = [
  ['openrouter', { choices: [{ message: { content: 'คำตอบจาก OpenRouter' } }] }],
  ['openai', { output_text: 'คำตอบจาก OpenAI' }],
  ['anthropic', { content: [{ type: 'text', text: 'คำตอบจาก Anthropic' }] }],
  ['gemini', { candidates: [{ content: { parts: [{ text: 'คำตอบจาก Gemini' }] } }] }],
  ['groq', { choices: [{ message: { content: 'คำตอบจาก Groq' } }] }],
]

describe('ModelProviderPort (FR-048)', () => {
  it('declares only the five approved public providers', () => {
    expect(PUBLIC_LINE_PROVIDERS).toEqual(['openrouter', 'openai', 'anthropic', 'gemini', 'groq'])
  })

  it.each(cases)('normalizes %s response text and keeps credentials out of the result', async (provider, responseBody) => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify(responseBody), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const port = createModelProviderPort({
      provider,
      model: 'test-model',
      credential: 'super-secret',
      fetchFn,
      timeoutMs: 1000,
    })

    const result = await port.generate({ question: 'ราคาเท่าไร', evidence: { records: [] } })
    expect(result.text).toContain('คำตอบจาก')
    expect(JSON.stringify(result)).not.toContain('super-secret')
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('fails closed for subscription-backed CLI providers on public LINE', () => {
    expect(() => createModelProviderPort({ provider: 'claude-cli', model: 'x', credential: 'session' })).toThrow(/public LINE|provider/i)
    expect(() => createModelProviderPort({ provider: 'codex-cli', model: 'x', credential: 'session' })).toThrow(/public LINE|provider/i)
  })

  it('treats every 2xx as success and rejects non-2xx without leaking the key', async () => {
    const ok = createModelProviderPort({
      provider: 'openai',
      model: 'test-model',
      credential: 'hidden-key',
      fetchFn: async () => new Response(JSON.stringify({ output_text: 'ผ่าน' }), { status: 201 }),
    })
    await expect(ok.generate({ question: 'q', evidence: { records: [] } })).resolves.toMatchObject({ text: 'ผ่าน' })

    const denied = createModelProviderPort({
      provider: 'openai',
      model: 'test-model',
      credential: 'hidden-key',
      fetchFn: async () => new Response('denied', { status: 401 }),
    })
    await expect(denied.generate({ question: 'q', evidence: { records: [] } })).rejects.not.toThrow(/hidden-key/)
  })

  it('allows the main-dev source only at the fixed Docker-host Ollama origin without credentials', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ response: 'คำตอบจาก Ollama' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    const port = createModelProviderPort({
      runtimeSource: 'MAIN_DEV_LOCAL_OLLAMA',
      provider: 'ollama',
      model: 'mellum:latest',
      baseUrl: 'http://host.docker.internal:11434',
      fetchFn,
      timeoutMs: 1000,
    })

    await expect(port.generate({ question: 'คำถาม', evidence: { records: [] } }))
      .resolves.toMatchObject({ provider: 'ollama', model: 'mellum:latest', text: 'คำตอบจาก Ollama' })
    expect(fetchFn).toHaveBeenCalledWith('http://host.docker.internal:11434/api/generate', expect.objectContaining({
      method: 'POST',
      redirect: 'error',
      headers: expect.not.objectContaining({ Authorization: expect.anything() }),
    }))
    expect(JSON.parse(fetchFn.mock.calls[0][1].body)).toMatchObject({ think: false, options: { num_predict: 256 } })
  })

  it('rejects a token-capped main-dev reply rather than delivering an incomplete answer', async () => {
    const port = createModelProviderPort({ runtimeSource: 'MAIN_DEV_LOCAL_OLLAMA', provider: 'ollama',
      model: 'local-test', baseUrl: 'http://host.docker.internal:11434',
      fetchFn: async () => new Response(JSON.stringify({ response: 'unfinished answer', done: true, done_reason: 'length' })),
    })
    await expect(port.generate({ question: 'q', evidence: { records: [] } })).rejects.toThrow(/TRUNCATED/)
  })

  it('keeps legacy local-evaluation generation options unchanged', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ response: 'answer' })))
    const port = createModelProviderPort({ runtimeSource: 'TEST', provider: 'ollama',
      model: 'local-test', baseUrl: 'http://127.0.0.1:11434', fetchFn,
    })
    await port.generate({ question: 'q', evidence: { records: [] } })
    const body = JSON.parse(fetchFn.mock.calls[0][1].body)
    expect(body).not.toHaveProperty('think')
    expect(body).not.toHaveProperty('options')
  })

  it.each([
    ['main-dev source with loopback override', 'MAIN_DEV_LOCAL_OLLAMA', 'http://127.0.0.1:11434'],
    ['local source with Docker-host endpoint', 'LOCAL_DEV', 'http://host.docker.internal:11434'],
    ['main-dev source with HTTPS endpoint', 'MAIN_DEV_LOCAL_OLLAMA', 'https://host.docker.internal:11434'],
  ])('rejects %s', (_label, runtimeSource, baseUrl) => {
    expect(() => createModelProviderPort({ runtimeSource, provider: 'ollama', model: 'mellum:latest', baseUrl }))
      .toThrow(/OLLAMA|URL|loopback/i)
  })

  it('rejects credentials for the keyless main-dev Ollama source', () => {
    expect(() => createModelProviderPort({
      runtimeSource: 'MAIN_DEV_LOCAL_OLLAMA',
      provider: 'ollama',
      model: 'mellum:latest',
      baseUrl: 'http://host.docker.internal:11434',
      credential: 'must-not-be-used',
    })).toThrow(/OLLAMA_CREDENTIAL_FORBIDDEN/)
  })

  it('does not allow the main-dev Ollama source to select a keyed provider', () => {
    expect(() => createModelProviderPort({
      runtimeSource: 'MAIN_DEV_LOCAL_OLLAMA',
      provider: 'openai',
      model: 'gpt-test',
      credential: 'must-not-be-used',
    })).toThrow(/MAIN_DEV_LOCAL_OLLAMA_OLLAMA_ONLY/)
  })

  it('bounds main-dev Ollama generation responses before JSON parsing', async () => {
    const port = createModelProviderPort({
      runtimeSource: 'MAIN_DEV_LOCAL_OLLAMA',
      provider: 'ollama',
      model: 'mellum:latest',
      baseUrl: 'http://host.docker.internal:11434',
      fetchFn: async () => new Response('{"response":"ok"}', {
        status: 200,
        headers: { 'content-length': '1048577' },
      }),
      timeoutMs: 1000,
    })

    await expect(port.generate({ question: 'q', evidence: { records: [] } }))
      .rejects.toThrow(/MODEL_PROVIDER_RESPONSE_TOO_LARGE/)
  })

  it('cancels an oversized declared generation body without reading or falling back', async () => {
    const body = { cancel: vi.fn(async () => {}), getReader: vi.fn() }
    const fetchFn = vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': '1048577' }),
      body,
    }))
    const port = createModelProviderPort({
      runtimeSource: 'MAIN_DEV_LOCAL_OLLAMA',
      provider: 'ollama',
      model: 'mellum:latest',
      baseUrl: 'http://host.docker.internal:11434',
      fetchFn,
      timeoutMs: 1000,
    })

    await expect(port.generate({ question: 'q', evidence: { records: [] } }))
      .rejects.toThrow(/MODEL_PROVIDER_RESPONSE_TOO_LARGE/)
    expect(body.cancel).toHaveBeenCalledTimes(1)
    expect(body.getReader).not.toHaveBeenCalled()
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })

  it('bounds main-dev Ollama generation request bodies before network access', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ response: 'should not run' }), { status: 200 }))
    const port = createModelProviderPort({
      runtimeSource: 'MAIN_DEV_LOCAL_OLLAMA',
      provider: 'ollama',
      model: 'mellum:latest',
      baseUrl: 'http://host.docker.internal:11434',
      fetchFn,
      timeoutMs: 1000,
    })

    await expect(port.generate({ question: 'q'.repeat(1024 * 1024), evidence: { records: [] } }))
      .rejects.toThrow(/MODEL_PROVIDER_REQUEST_TOO_LARGE/)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
