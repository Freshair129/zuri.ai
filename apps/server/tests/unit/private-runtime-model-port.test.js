// @req FR-267 — LINE answers on the operator's Private Runtime Platform: the port
//   calls PRP's OpenAI-compatible chat completions at the configured address only,
//   and a reasoning model's thinking never reaches a customer.
// @spec ADR-100 D7; ADR-099 D8, D10
// @tested tests/unit/private-runtime-model-port.test.js
import { describe, expect, it, vi } from 'vitest'
import { createModelProviderPort, PRIVATE_RUNTIME_PROVIDERS, PUBLIC_LINE_PROVIDERS, stripReasoning } from '@/modules/agent/model-provider'

const BASE = 'https://gpu.example.test'
const reply = (content) => vi.fn(async () => new Response(JSON.stringify({ id: 'chatcmpl-1', choices: [{ message: { content } }] }), {
  status: 200, headers: { 'content-type': 'application/json' },
}))
const prpPort = (fetchFn, extra = {}) => createModelProviderPort({
  provider: 'prp', model: 'typhoon2.5-qwen3-4b', credential: 'sk-prp-client-key-0123456789', baseUrl: BASE, fetchFn, timeoutMs: 1000, ...extra,
})
const ask = (port) => port.generate({ question: 'ราคาเท่าไร', evidence: { records: [] } })

describe('private runtime model port (FR-267)', () => {
  it('keeps the private runtime off the public provider list', () => {
    // FR-048's public list is unchanged; `prp` is its own, separately named kind.
    expect(PUBLIC_LINE_PROVIDERS).not.toContain('prp')
    expect(PRIVATE_RUNTIME_PROVIDERS).toEqual(['prp'])
  })

  it('calls PRP’s chat completions at the configured address with only contract fields', async () => {
    const fetchFn = reply('ราคา 50 บาทครับ')
    const result = await ask(prpPort(fetchFn))
    expect(result.text).toBe('ราคา 50 บาทครับ')
    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(`${BASE}/v1/chat/completions`)
    expect(init.headers.Authorization).toBe('Bearer sk-prp-client-key-0123456789')
    expect(init.redirect).toBe('error')
    const body = JSON.parse(init.body)
    // PRP rejects unsupported fields rather than dropping them, so nothing extra is sent.
    expect(Object.keys(body).sort()).toEqual(['max_tokens', 'messages', 'model', 'stream'])
    expect(body).toMatchObject({ model: 'typhoon2.5-qwen3-4b', stream: false })
    expect(JSON.stringify(result)).not.toContain('sk-prp-client-key')
  })

  it('refuses to build without the operator’s address, rather than guessing one', () => {
    expect(() => createModelProviderPort({ provider: 'prp', model: 'm', credential: 'sk-prp-client-key-0123456789', fetchFn: vi.fn() }))
      .toThrow(/MODEL_PROVIDER_NOT_ALLOWED_FOR_PUBLIC_LINE: baseUrl/)
  })

  it('never sends a reasoning block to the customer', async () => {
    const fetchFn = reply('<think>ลูกค้าถามราคา ต้องดูหลักฐาน…</think>\n\nราคา 50 บาทครับ')
    expect((await ask(prpPort(fetchFn))).text).toBe('ราคา 50 บาทครับ')
  })

  it('fails the answer, rather than sending it, when the model produced only unfinished thinking', async () => {
    // Cut off at the token limit mid-thought: there is no answer to send.
    const fetchFn = reply('<think>ลูกค้าถามราคา ต้องดูหลักฐานก่อน แล้วก็')
    await expect(ask(prpPort(fetchFn))).rejects.toThrow(/MODEL_PROVIDER_EMPTY_RESPONSE/)
  })
})

describe('stripReasoning', () => {
  it('removes complete thinking blocks wherever they appear', () => {
    expect(stripReasoning('<think>a</think>คำตอบ')).toBe('คำตอบ')
    expect(stripReasoning('ก่อน <THINK>x\ny</THINK> หลัง')).toBe('ก่อน  หลัง')
    expect(stripReasoning('<think>1</think>A<think>2</think>B')).toBe('AB')
  })

  it('removes a leading run closed by </think> with no opening tag', () => {
    // A chat template that puts <think> into the prompt yields output that starts mid-thought.
    expect(stripReasoning('ลูกค้าถามราคา ดูหลักฐาน</think>\n\nราคา 50 บาท')).toBe('ราคา 50 บาท')
  })

  it('removes an opening tag never closed, and everything after it', () => {
    expect(stripReasoning('คำตอบ<think>ยังคิดอยู่')).toBe('คำตอบ')
    expect(stripReasoning('<think>ยังคิดอยู่')).toBe('')
  })

  it('leaves an answer with no thinking untouched', () => {
    expect(stripReasoning('ราคา 50 บาทครับ')).toBe('ราคา 50 บาทครับ')
    expect(stripReasoning(undefined)).toBeUndefined()
  })
})
