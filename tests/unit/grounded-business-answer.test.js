import { describe, it, expect, vi } from 'vitest'
import { answerBusinessQuestion } from '@/modules/agent/grounded-business-answer'

// @req FR-049 — model wording is accepted only when its facts and numbers are evidenced.
// @spec SDD-025, SEC-009
// @tested tests/unit/grounded-business-answer.test.js

const evidence = {
  queryId: 'product_search',
  queryVersion: '1.0.0',
  businessId: 'smartgift',
  sensitivity: 'PUBLIC',
  asOf: '2026-08-12T00:00:00.000Z',
  records: [{
    knowledge_id: 'sg:sku:USB-001',
    business_id: 'smartgift',
    knowledge_type: 'PRODUCT',
    product_code: 'USB-001',
    name: 'แฟลชไดรฟ์ไม้',
    category: 'USB',
    description: 'แฟลชไดรฟ์สำหรับของพรีเมียม',
    unit: 'ชิ้น',
    sell_price: 120,
    currency: 'THB',
    moq: 100,
    colors: ['ไม้ธรรมชาติ'],
    specification: { capacity: '32GB' },
    source_ref: 'catalog:usb:2026-08',
    source_sha256: 'a'.repeat(64),
    as_of: '2026-08-12T00:00:00.000Z',
    approved_at: '2026-08-14T00:00:00.000Z',
    is_active: true,
    sensitivity: 'PUBLIC',
    contract_version: '1.0.0',
  }],
}

describe('answerBusinessQuestion (FR-049)', () => {
  it('returns a supported Thai answer with evidence metadata', async () => {
    const knowledge = { query: vi.fn(async () => evidence) }
    const model = { provider: 'openai', model: 'test', generate: vi.fn(async () => ({ text: 'แฟลชไดรฟ์ไม้ ราคา 120 บาท ขั้นต่ำ 100 ชิ้น ความจุ 32GB' })) }
    const result = await answerBusinessQuestion({ businessId: 'smartgift', question: 'USB-001 ราคาเท่าไร' }, { knowledge, model })

    expect(result.text).toContain('120')
    expect(result.grounded).toBe(true)
    expect(result.verification.supported).toBe(true)
    expect(result.evidence.records[0].source_ref).toBe('catalog:usb:2026-08')
  })

  it('rejects an unsupported number and returns a deterministic evidence fallback', async () => {
    const knowledge = { query: vi.fn(async () => evidence) }
    const model = { provider: 'openai', model: 'test', generate: vi.fn(async () => ({ text: 'ราคา 999 บาท ส่งฟรีภายใน 2 วัน' })) }
    const result = await answerBusinessQuestion({ businessId: 'smartgift', question: 'USB-001 ราคาเท่าไร' }, { knowledge, model })

    expect(result.verification.supported).toBe(false)
    expect(result.text).not.toContain('999')
    expect(result.text).toContain('120')
    expect(result.text).toContain('ข้อมูล ณ')
  })

  it('does not call a provider when evidence is absent', async () => {
    const knowledge = { query: vi.fn(async () => ({ ...evidence, records: [] })) }
    const model = { provider: 'openai', model: 'test', generate: vi.fn() }
    const result = await answerBusinessQuestion({ businessId: 'smartgift', question: 'มีรุ่นล่องหนไหม' }, { knowledge, model })

    expect(model.generate).not.toHaveBeenCalled()
    expect(result.grounded).toBe(false)
    expect(result.text).toMatch(/ยังไม่พบ|ข้อมูลไม่พอ/)
  })

  it('falls back safely when the provider times out or fails', async () => {
    const knowledge = { query: vi.fn(async () => evidence) }
    const model = { provider: 'groq', model: 'test', generate: vi.fn(async () => { throw new Error('network failed with secret abc') }) }
    const result = await answerBusinessQuestion({ businessId: 'smartgift', question: 'USB-001 ราคาเท่าไร' }, { knowledge, model })

    expect(result.text).toContain('120')
    expect(result.provider.status).toBe('fallback')
    expect(JSON.stringify(result)).not.toContain('secret abc')
  })
})
