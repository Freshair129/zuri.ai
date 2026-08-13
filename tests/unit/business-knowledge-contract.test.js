import { describe, it, expect } from 'vitest'
import {
  createInMemoryBusinessKnowledgeReader,
  normalizeBusinessKnowledgeRecord,
  PUBLIC_BUSINESS_KNOWLEDGE_FIELDS,
} from '@/modules/knowledge/business-contract'

// @req FR-047 — curated business knowledge is allow-listed, registered and business-scoped.
// @spec SDD-025, SEC-009
// @tested tests/unit/business-knowledge-contract.test.js

const record = {
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
}

describe('BusinessKnowledgeReadPort (FR-047)', () => {
  it('accepts only the public projection contract', () => {
    const normalized = normalizeBusinessKnowledgeRecord(record)
    expect(Object.keys(normalized).sort()).toEqual([...PUBLIC_BUSINESS_KNOWLEDGE_FIELDS].sort())
    expect(() => normalizeBusinessKnowledgeRecord({ ...record, margin_pct: 55 })).toThrow(/unrecognized|forbidden/i)
    expect(() => normalizeBusinessKnowledgeRecord({ ...record, customer_email: 'x@example.com' })).toThrow(/unrecognized|forbidden/i)
  })

  it('runs registered business-scoped queries with deterministic row caps', async () => {
    const reader = createInMemoryBusinessKnowledgeReader([
      record,
      { ...record, knowledge_id: 'sg:sku:USB-002', product_code: 'USB-002', name: 'แฟลชไดรฟ์โลหะ', sell_price: 150 },
      { ...record, knowledge_id: 'other:sku:USB-999', business_id: 'other', product_code: 'USB-999' },
    ])

    const packet = await reader.query({
      businessId: 'smartgift',
      queryId: 'product_search',
      params: { term: 'แฟลชไดรฟ์' },
      limit: 1,
    })

    expect(packet.queryId).toBe('product_search')
    expect(packet.sensitivity).toBe('PUBLIC')
    expect(packet.records).toHaveLength(1)
    expect(packet.records[0].business_id).toBe('smartgift')
  })

  it('rejects arbitrary query ids and unsafe parameters', async () => {
    const reader = createInMemoryBusinessKnowledgeReader([record])
    await expect(reader.query({ businessId: 'smartgift', queryId: 'raw_sql', params: { sql: 'select * from customer' } })).rejects.toThrow(/registered query/i)
  })
})
