import { describe, it, expect } from 'vitest'
import { KNOWLEDGE_SENSITIVITY_LEVELS } from '@/lib/validation/enums'
import { normalizeBusinessKnowledgeRecord, createInMemoryBusinessKnowledgeReader } from '@/modules/knowledge/business-contract'

// @req FR-111 — knowledge sensitivity lattice and processing policy fields
// @spec SDD-062, docs/KNOWLEDGE-INGESTION-17-STAGE-SPEC.md §10, §3.3

const record = (over = {}) => ({
  knowledge_id: `kn_${over.product_code ?? 'P-1'}`,
  business_id: 'biz_1',
  knowledge_type: 'PRODUCT',
  product_code: 'P-1',
  name: 'Gift set',
  category: null,
  description: null,
  unit: null,
  sell_price: null,
  currency: null,
  moq: null,
  colors: [],
  specification: {},
  source_ref: 'doc://x',
  source_sha256: 'a'.repeat(64),
  as_of: '2026-08-27T00:00:00.000Z',
  approved_at: '2026-08-27T00:00:00.000Z',
  is_active: true,
  sensitivity: 'PUBLIC',
  contract_version: '1.0.0',
  ...over,
})

describe('the lattice', () => {
  it('has the four levels the specification names, most open first', () => {
    expect(KNOWLEDGE_SENSITIVITY_LEVELS).toEqual(['PUBLIC', 'INTERNAL', 'CONFIDENTIAL', 'RESTRICTED'])
  })

  it('is not the agent action vocabulary — HIGH is not a knowledge level', () => {
    expect(KNOWLEDGE_SENSITIVITY_LEVELS).not.toContain('HIGH')
    expect(KNOWLEDGE_SENSITIVITY_LEVELS).not.toContain('LOW')
  })

  it('lets the contract STORE a record above PUBLIC', () => {
    expect(() => normalizeBusinessKnowledgeRecord(record({ sensitivity: 'INTERNAL' }))).not.toThrow()
  })

  it('still refuses a level that is not in the lattice', () => {
    expect(() => normalizeBusinessKnowledgeRecord(record({ sensitivity: 'SECRET' }))).toThrow()
  })
})

describe('widening what may be stored does not widen what is served', () => {
  it('serves PUBLIC and withholds everything above it', async () => {
    const reader = createInMemoryBusinessKnowledgeReader([
      record({ product_code: 'P-PUB', sensitivity: 'PUBLIC' }),
      record({ product_code: 'P-INT', sensitivity: 'INTERNAL' }),
      record({ product_code: 'P-CON', sensitivity: 'CONFIDENTIAL' }),
      record({ product_code: 'P-RES', sensitivity: 'RESTRICTED' }),
    ])
    const packet = await reader.query({ queryId: 'product_search', businessId: 'biz_1', params: { term: 'Gift' } })
    expect(packet.records.map((r) => r.product_code)).toEqual(['P-PUB'])
  })

  it('the packet does not merely claim PUBLIC — it refuses to wrap anything else', async () => {
    const reader = createInMemoryBusinessKnowledgeReader([record({ sensitivity: 'INTERNAL' })])
    const packet = await reader.query({ queryId: 'product_search', businessId: 'biz_1', params: { term: 'Gift' } })
    expect(packet.sensitivity).toBe('PUBLIC')
    expect(packet.records).toEqual([])
  })
})

import { classifyKnowledgeObject, resolveExecutionLocation } from '@/modules/knowledge/classification'

const classification = (over = {}) => ({
  scope: { tenantId: 'ten_1', businessId: 'biz_1' },
  sensitivity: 'INTERNAL',
  retention_policy: 'RETAIN_7Y',
  export_policy: 'NO_EXPORT',
  cloud_processing_allowed: true,
  embedding_allowed: true,
  ...over,
})

describe('nothing is assumed — every field is stated or the object is refused', () => {
  it.each([
    'sensitivity',
    'retention_policy',
    'export_policy',
    'cloud_processing_allowed',
    'embedding_allowed',
  ])('refuses an object with no %s rather than choosing one for it', (field) => {
    const input = classification()
    delete input[field]
    expect(() => classifyKnowledgeObject(input)).toThrow(new RegExp(field))
  })

  it('does not treat an absent sensitivity as PUBLIC — the permissive value is never the default', () => {
    const input = classification()
    delete input.sensitivity
    expect(() => classifyKnowledgeObject(input)).toThrow()
    try {
      classifyKnowledgeObject(input)
    } catch (error) {
      expect(error.message).not.toMatch(/defaulted|assumed/i)
    }
  })

  it('refuses false as if it were missing? no — false is a stated value and is kept', () => {
    const c = classifyKnowledgeObject(classification({ cloud_processing_allowed: false, embedding_allowed: false }))
    expect(c.cloud_processing_allowed).toBe(false)
    expect(c.embedding_allowed).toBe(false)
  })
})

describe('scope is not optional', () => {
  it.each([
    ['no tenant', { businessId: 'biz_1' }],
    ['no business', { tenantId: 'ten_1' }],
    ['nothing at all', {}],
  ])('refuses an object with %s', (_label, scope) => {
    expect(() => classifyKnowledgeObject(classification({ scope }))).toThrow(/scope/i)
  })
})

describe('execution location comes from the object, never from the deployment', () => {
  it('sends a cloud-forbidden object local', () => {
    expect(resolveExecutionLocation(classifyKnowledgeObject(classification({ cloud_processing_allowed: false })))).toBe('LOCAL')
  })

  it('ignores a deployment preference that would widen it', () => {
    const c = classifyKnowledgeObject(classification({ cloud_processing_allowed: false }))
    expect(resolveExecutionLocation(c, { preferred: 'CLOUD' })).toBe('LOCAL')
    expect(resolveExecutionLocation(c, { preferred: 'CLOUD', force: true })).toBe('LOCAL')
  })

  it('lets a cloud-permitted object run anywhere', () => {
    expect(resolveExecutionLocation(classifyKnowledgeObject(classification()))).toBe('ANY')
  })
})

import { assertIndexable } from '@/modules/knowledge/classification'
import { chunkDocument } from '@/modules/knowledge/chunking'

describe('classify, then index — never index, then filter', () => {
  const classified = () => classifyKnowledgeObject(classification())

  it('lets a classified object through', () => {
    expect(() => assertIndexable({ id: 'k1', classification: classified() })).not.toThrow()
  })

  it('refuses an object carrying no classification at all', () => {
    expect(() => assertIndexable({ id: 'k1' })).toThrow(/classif/i)
  })

  it('refuses an object whose classification was assembled by hand and is short a field', () => {
    const partial = { ...classified(), export_policy: undefined }
    expect(() => assertIndexable({ id: 'k1', classification: partial })).toThrow(/export_policy/)
  })

  it('refuses an object whose scope went missing between classification and indexing', () => {
    const tampered = { ...classified(), scope: { businessId: 'biz_1' } }
    expect(() => assertIndexable({ id: 'k1', classification: tampered })).toThrow(/scope/i)
  })
})

describe('the classification reaches the chunks Stage 7 makes', () => {
  it('a chunk carries the scope its object was classified with', () => {
    const c = classifyKnowledgeObject(classification())
    const { chunks } = chunkDocument({
      documentId: 'doc_1',
      scope: c.scope,
      provenance: { source_ref: 'doc://x' },
      blocks: [
        { type: 'heading', level: 1, text: 'Terms' },
        { type: 'text', text: 'Net thirty.' },
      ],
    })
    expect(chunks[0].scope).toEqual({ tenantId: 'ten_1', businessId: 'biz_1' })
  })
})
