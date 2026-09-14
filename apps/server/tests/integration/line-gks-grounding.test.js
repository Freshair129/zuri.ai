import { describe, expect, it, vi } from 'vitest'
import { createServerLineAnswer } from '@/modules/agent/server-line-answer'

// @req FR-235 — LINE answer grounding from the published knowledge corpus,
// exercised end to end through createServerLineAnswer: mode selection, the
// corpus reader, the mode-gated fallback, the budget and every trace hop.
// @spec ADR-090 D1-D5, SEC-032, SDD-099
// @tested tests/integration/line-gks-grounding.test.js

vi.mock('@/lib/db', () => ({ default: {} }))

const queryKnowledgeCorpusMock = vi.hoisted(() => vi.fn())
vi.mock('@/modules/knowledge/knowledge-corpus-service', () => ({
  queryKnowledgeCorpus: (...args) => queryKnowledgeCorpusMock(...args),
}))

const tenantId = '11111111-1111-4111-8111-111111111111'
const businessId = '22222222-2222-4222-8222-222222222222'
const otherBusinessId = '33333333-3333-4333-8333-333333333333'

function job({ knowledgeGrounding, modelAccess = 'LOCAL_ONLY', tenant = tenantId, business = businessId } = {}) {
  return {
    tenantId: tenant, businessId: business, modelAccess,
    inbound: { body: 'AB-1 ราคาเท่าไร' },
    account: { tenantId: tenant, businessId: business, ...(knowledgeGrounding !== undefined ? { knowledgeGrounding } : {}) },
  }
}

function businessKnowledgeEvidence() {
  return { records: [{ name: 'แก้ว', product_code: 'AB-1', sell_price: 50, currency: 'THB', unit: 'ชิ้น', moq: 1, specification: {}, as_of: '2026-09-01T00:00:00Z' }] }
}

function corpusHit(overrides = {}) {
  return { id: 'hit-1', text: 'AB-1 คือแก้วน้ำ ราคา 50 บาท', score: 0.9, citationId: 'cit-1', sourceId: 'src-1', snapshotId: 'snap-1', generation: 1, ...overrides }
}

function fakeTrace() {
  return {
    recordThreadMemory: vi.fn(),
    recordEvidence: vi.fn(),
    recordContextReceipt: vi.fn(),
    assertHealthy: vi.fn(),
  }
}

describe('FR-235 — LINE knowledge grounding modes', () => {
  it('BUSINESS_KNOWLEDGE (default, no account field): byte-identical trace — one BUSINESS_QUERY hop, no corpus call, no ContextReceipt', async () => {
    queryKnowledgeCorpusMock.mockClear()
    const knowledge = { query: vi.fn().mockResolvedValue(businessKnowledgeEvidence()) }
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ knowledge })
    const text = await answer(job(), { trace })

    expect(text).toContain('AB-1')
    expect(queryKnowledgeCorpusMock).not.toHaveBeenCalled()
    expect(trace.recordEvidence).toHaveBeenCalledTimes(1)
    const [, evidence, meta] = trace.recordEvidence.mock.calls[0]
    expect(evidence).toEqual(businessKnowledgeEvidence())
    expect(meta).toBeUndefined() // the pre-FR-235 call shape: (query, evidence) only
    expect(trace.recordContextReceipt).not.toHaveBeenCalled()
  })

  it('BUSINESS_KNOWLEDGE (explicit): same byte-identical behaviour as an account with no grounding field', async () => {
    queryKnowledgeCorpusMock.mockClear()
    const knowledge = { query: vi.fn().mockResolvedValue(businessKnowledgeEvidence()) }
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ knowledge })
    await answer(job({ knowledgeGrounding: 'BUSINESS_KNOWLEDGE' }), { trace })
    expect(queryKnowledgeCorpusMock).not.toHaveBeenCalled()
    expect(trace.recordEvidence).toHaveBeenCalledTimes(1)
  })

  it('an unrecognised grounding value fails closed to BUSINESS_KNOWLEDGE, never to a corpus read', async () => {
    queryKnowledgeCorpusMock.mockClear()
    const knowledge = { query: vi.fn().mockResolvedValue(businessKnowledgeEvidence()) }
    const answer = createServerLineAnswer({ knowledge })
    await answer(job({ knowledgeGrounding: 'NOT_A_REAL_MODE' }))
    expect(queryKnowledgeCorpusMock).not.toHaveBeenCalled()
  })

  it('GKS_CORPUS: reads the published corpus, traces one GKS_CORPUS hop and a ContextReceipt, and answers from the chunk', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockResolvedValue({ corpusGeneration: 4, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [corpusHit()] })
    const knowledge = { query: vi.fn() } // must never be read in GKS_CORPUS mode
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ knowledge })
    const text = await answer(job({ knowledgeGrounding: 'GKS_CORPUS' }), { trace })

    expect(knowledge.query).not.toHaveBeenCalled()
    expect(queryKnowledgeCorpusMock).toHaveBeenCalledTimes(1)
    expect(queryKnowledgeCorpusMock.mock.calls[0][0]).toEqual({ businessId, query: 'AB-1', topK: 5 })
    expect(text).toContain('AB-1')

    expect(trace.recordEvidence).toHaveBeenCalledTimes(1)
    const [, evidence, meta] = trace.recordEvidence.mock.calls[0]
    expect(evidence.records).toHaveLength(1)
    expect(meta).toMatchObject({ source: 'GKS_CORPUS', reason: null })
    expect(meta.retrievalRefs).toEqual([{ citationId: 'cit-1', sourceId: 'src-1', snapshotId: 'snap-1', generation: 1, corpusGeneration: 4, manifestHash: 'h'.repeat(64) }])
    expect(typeof meta.budgetMs).toBe('number')

    expect(trace.recordContextReceipt).toHaveBeenCalledTimes(1)
    const receipt = trace.recordContextReceipt.mock.calls[0][0]
    // The ContextReceipt's citations are exactly the citation ids on the
    // evidence records the model actually received (the last recordEvidence
    // call), not a superset and not a subset.
    expect(receipt.refs.citations).toEqual(evidence.records.map((record) => record.citationId))
  })

  it('GKS_CORPUS: no evidence yields the deterministic reply and zero model calls, with no fallback reader touched', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockResolvedValue({ corpusGeneration: 1, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [] })
    const generate = vi.fn()
    const resolveModel = vi.fn().mockResolvedValue({ provider: 'openai', model: 'fixture', generate })
    const runtimeFactory = vi.fn().mockResolvedValue({ businessKnowledge: { query: vi.fn() }, resolveModel })
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ runtimeFactory })
    const text = await answer(job({ knowledgeGrounding: 'GKS_CORPUS', modelAccess: 'EXTERNAL_MODEL_ALLOWED' }), { trace })

    expect(text).toContain('ยังไม่พบข้อมูลสินค้า')
    expect(generate).not.toHaveBeenCalled()
    expect(trace.recordEvidence).toHaveBeenCalledTimes(2)
    expect(trace.recordEvidence.mock.calls[0][2]).toMatchObject({ source: 'GKS_CORPUS', reason: 'NO_EVIDENCE' })
    expect(trace.recordEvidence.mock.calls[1][2]).toMatchObject({ source: 'NONE', reason: 'NO_EVIDENCE' })
    expect(trace.recordContextReceipt).not.toHaveBeenCalled()
  })

  it('GKS_THEN_BUSINESS_KNOWLEDGE: a timed-out corpus hop is GKS_UNAVAILABLE, traced, and falls back to business knowledge', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({ corpusGeneration: 1, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [corpusHit()] }), 100)))
    const knowledge = { query: vi.fn().mockResolvedValue(businessKnowledgeEvidence()) }
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ knowledge, env: { ZURI_LINE_KNOWLEDGE_BUDGET_MS: '5' } })
    const text = await answer(job({ knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE' }), { trace })

    expect(text).toContain('AB-1')
    expect(knowledge.query).toHaveBeenCalledTimes(1)
    expect(trace.recordEvidence).toHaveBeenCalledTimes(2)
    expect(trace.recordEvidence.mock.calls[0][2]).toMatchObject({ source: 'GKS_CORPUS', reason: 'GKS_UNAVAILABLE' })
    expect(trace.recordEvidence.mock.calls[1][2]).toMatchObject({ source: 'BUSINESS_KNOWLEDGE', reason: 'GKS_UNAVAILABLE' })
  })

  it('GKS_THEN_BUSINESS_KNOWLEDGE: no evidence anywhere yields the deterministic reply and zero model calls', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockResolvedValue({ corpusGeneration: 1, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60', results: [] })
    const generate = vi.fn()
    const resolveModel = vi.fn().mockResolvedValue({ provider: 'openai', model: 'fixture', generate })
    const runtimeFactory = vi.fn().mockResolvedValue({ businessKnowledge: { query: async () => ({ records: [] }) }, resolveModel })
    const trace = fakeTrace()
    const answer = createServerLineAnswer({ runtimeFactory })
    const text = await answer(job({ knowledgeGrounding: 'GKS_THEN_BUSINESS_KNOWLEDGE', modelAccess: 'EXTERNAL_MODEL_ALLOWED' }), { trace })

    expect(text).toContain('ยังไม่พบข้อมูลสินค้า')
    expect(generate).not.toHaveBeenCalled()
    expect(trace.recordEvidence).toHaveBeenCalledTimes(3)
    expect(trace.recordEvidence.mock.calls[2][2]).toMatchObject({ source: 'NONE', reason: 'NO_EVIDENCE' })
  })

  it('never reads another Business\'s corpus: two jobs for different Businesses each query only their own scope', async () => {
    queryKnowledgeCorpusMock.mockClear()
    queryKnowledgeCorpusMock.mockImplementation(async ({ businessId: requested }) => ({
      corpusGeneration: 1, manifestHash: 'h'.repeat(64), ranking: 'rrf-k60',
      results: [corpusHit({ text: `evidence for ${requested}` })],
    }))
    const answer = createServerLineAnswer({ knowledge: { query: vi.fn() } })
    await answer(job({ knowledgeGrounding: 'GKS_CORPUS', business: businessId }))
    await answer(job({ knowledgeGrounding: 'GKS_CORPUS', business: otherBusinessId }))

    expect(queryKnowledgeCorpusMock).toHaveBeenCalledTimes(2)
    expect(queryKnowledgeCorpusMock.mock.calls[0][0].businessId).toBe(businessId)
    expect(queryKnowledgeCorpusMock.mock.calls[0][1].viewer).toEqual({ visibleBusinessIds: [businessId] })
    expect(queryKnowledgeCorpusMock.mock.calls[1][0].businessId).toBe(otherBusinessId)
    expect(queryKnowledgeCorpusMock.mock.calls[1][1].viewer).toEqual({ visibleBusinessIds: [otherBusinessId] })
  })

  it('an account scope mismatch is rejected before any corpus or business-knowledge read', async () => {
    queryKnowledgeCorpusMock.mockClear()
    const knowledge = { query: vi.fn() }
    const answer = createServerLineAnswer({ knowledge })
    const input = job({ knowledgeGrounding: 'GKS_CORPUS' })
    input.account.businessId = otherBusinessId
    await expect(answer(input)).rejects.toThrow('LINE_ANSWER_SCOPE_MISMATCH')
    expect(queryKnowledgeCorpusMock).not.toHaveBeenCalled()
    expect(knowledge.query).not.toHaveBeenCalled()
  })
})
