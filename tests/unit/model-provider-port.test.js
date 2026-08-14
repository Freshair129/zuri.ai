import { describe, it, expect, vi } from 'vitest'
import { createModelProviderPort, PUBLIC_LINE_PROVIDERS } from '@/modules/agent/model-provider'

// @req FR-048 — provider/auth choice is normalized and public LINE denies subscription CLIs.
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
})
