import { describe, expect, it, vi } from 'vitest'
import { createCorpusKnowledgeReader } from '@/modules/knowledge/corpus-knowledge-reader'

// @req FR-235 — the in-process corpus reader over queryKnowledgeCorpus.
// @spec ADR-072 D5, ADR-090 D1, D3
// @tested tests/unit/corpus-knowledge-reader.test.js

const TENANT_ID = 'tenant-a'
const BUSINESS_ID = 'business-a'

function hit(overrides = {}) {
  return {
    id: 'hit-1', text: 'สินค้า USB-001 ราคา 120 บาท', score: 0.9,
    citationId: 'cit-1', sourceId: 'src-1', snapshotId: 'snap-1', generation: 1,
    ...overrides,
  }
}

describe('createCorpusKnowledgeReader (FR-235)', () => {
  it('requires a server-derived tenant and Business scope at construction', () => {
    expect(() => createCorpusKnowledgeReader({ businessId: BUSINESS_ID })).toThrow(/CORPUS_KNOWLEDGE_READER_SCOPE_REQUIRED/)
    expect(() => createCorpusKnowledgeReader({ tenantId: TENANT_ID })).toThrow(/CORPUS_KNOWLEDGE_READER_SCOPE_REQUIRED/)
  })

  it('derives a free-text query from the registered query and reads only its own Business', async () => {
    const queryKnowledgeCorpus = vi.fn(async () => ({ corpusGeneration: 3, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [hit()] }))
    const reader = createCorpusKnowledgeReader({ tenantId: TENANT_ID, businessId: BUSINESS_ID, queryKnowledgeCorpus })
    await reader.query({ queryId: 'product_detail', params: { productCode: 'USB-001' }, limit: 1 })

    expect(queryKnowledgeCorpus).toHaveBeenCalledTimes(1)
    const [input, options] = queryKnowledgeCorpus.mock.calls[0]
    expect(input).toEqual({ businessId: BUSINESS_ID, query: 'USB-001', topK: 5 })
    // The viewer is a read-only capability naming exactly this one Business —
    // never a wider grant, never accepted as a caller-supplied argument.
    expect(options.viewer).toEqual({ visibleBusinessIds: [BUSINESS_ID] })
  })

  it('builds product_compare and product_search free-text queries the same way selectRegisteredQuery derives them', async () => {
    const queryKnowledgeCorpus = vi.fn(async () => ({ corpusGeneration: 1, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [] }))
    const reader = createCorpusKnowledgeReader({ tenantId: TENANT_ID, businessId: BUSINESS_ID, queryKnowledgeCorpus })
    await reader.query({ queryId: 'product_compare', params: { productCodes: ['A-1', 'B-2'] }, limit: 3 })
    expect(queryKnowledgeCorpus.mock.calls[0][0].query).toBe('A-1 B-2')
    await reader.query({ queryId: 'product_search', params: { term: 'สายชาร์จ' }, limit: 5 })
    expect(queryKnowledgeCorpus.mock.calls[1][0].query).toBe('สายชาร์จ')
  })

  it('returns empty evidence, never calling the corpus, when no search text can be derived', async () => {
    const queryKnowledgeCorpus = vi.fn()
    const reader = createCorpusKnowledgeReader({ tenantId: TENANT_ID, businessId: BUSINESS_ID, queryKnowledgeCorpus })
    const result = await reader.query({ queryId: 'product_search', params: {}, limit: 5 })
    expect(queryKnowledgeCorpus).not.toHaveBeenCalled()
    expect(result.records).toEqual([])
  })

  it('maps corpus hits into CORPUS_CHUNK records carrying retrieval references, and never composes or records anything itself', async () => {
    const queryKnowledgeCorpus = vi.fn(async () => ({
      corpusGeneration: 7, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60',
      results: [hit({ id: 'a' }), hit({ id: 'b', citationId: 'cit-2', text: 'ข้อมูลอีกชิ้น' })],
    }))
    const reader = createCorpusKnowledgeReader({ tenantId: TENANT_ID, businessId: BUSINESS_ID, queryKnowledgeCorpus })
    const result = await reader.query({ queryId: 'product_detail', params: { productCode: 'X' }, limit: 1 })

    expect(result.records).toHaveLength(2)
    for (const record of result.records) {
      expect(record.kind).toBe('CORPUS_CHUNK')
      expect(typeof record.text).toBe('string')
      expect(record.corpusGeneration).toBe(7)
      expect(record.manifestHash).toBe('h'.repeat(64))
    }
    expect(result.retrievalRefs).toHaveLength(2)
    expect(result.retrievalRefs[0]).toMatchObject({ citationId: 'cit-1', sourceId: 'src-1', snapshotId: 'snap-1', generation: 1, corpusGeneration: 7 })
    // @req FR-234/SDD-100 — this reader returns evidence only. Composition
    // and its ContextReceipt are owned entirely by server-line-answer.js, so
    // one model invocation can never get two receipts for one turn.
    expect(result).not.toHaveProperty('receipt')
  })

  it('enforces the byte budget: an over-budget hit is dropped, an earlier smaller hit is kept', async () => {
    const bigText = 'ก'.repeat(3000) // multi-byte UTF-8, several bytes per char
    const queryKnowledgeCorpus = vi.fn(async () => ({
      corpusGeneration: 1, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60',
      results: [hit({ id: 'small', citationId: 'cit-small', text: 'short' }), hit({ id: 'big', citationId: 'cit-big', text: bigText })],
    }))
    const reader = createCorpusKnowledgeReader({ tenantId: TENANT_ID, businessId: BUSINESS_ID, queryKnowledgeCorpus, maxPacketBytes: 100 })
    const result = await reader.query({ queryId: 'product_detail', params: { productCode: 'X' }, limit: 1 })
    expect(result.records).toHaveLength(1)
    expect(result.records[0].citationId).toBe('cit-small')
  })

  it('reports an empty result when the corpus returns no hits', async () => {
    const queryKnowledgeCorpus = vi.fn(async () => ({ corpusGeneration: 1, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [] }))
    const reader = createCorpusKnowledgeReader({ tenantId: TENANT_ID, businessId: BUSINESS_ID, queryKnowledgeCorpus })
    const result = await reader.query({ queryId: 'product_detail', params: { productCode: 'X' }, limit: 1 })
    expect(result.records).toEqual([])
    expect(result.retrievalRefs).toEqual([])
  })
})
