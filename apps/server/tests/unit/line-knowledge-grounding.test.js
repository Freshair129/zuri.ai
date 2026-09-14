import { describe, expect, it, vi } from 'vitest'
import {
  createLineGroundingReader,
  lineKnowledgeGroundingBudgetFromEnv,
  resolveLineKnowledgeGroundingMode,
} from '@/modules/agent/line-knowledge-grounding'

// @req FR-235 — mode-gated fallback, budget and per-hop tracing.
// @spec ADR-090 D1-D4, SEC-032
// @tested tests/unit/line-knowledge-grounding.test.js

function reader(records, { delayMs = 0, throws = false } = {}) {
  return {
    query: vi.fn(async () => {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs))
      if (throws) throw new Error('boom: internal reader failure with a fake credential=xyz')
      return { records, retrievalRefs: records.map((_, index) => ({ citationId: `cit-${index}` })) }
    }),
  }
}

const INPUT = { queryId: 'product_detail', params: { productCode: 'X' }, limit: 1 }

describe('resolveLineKnowledgeGroundingMode (fail closed)', () => {
  it('defaults to BUSINESS_KNOWLEDGE for a missing or unrecognised value', () => {
    expect(resolveLineKnowledgeGroundingMode(undefined)).toBe('BUSINESS_KNOWLEDGE')
    expect(resolveLineKnowledgeGroundingMode(null)).toBe('BUSINESS_KNOWLEDGE')
    expect(resolveLineKnowledgeGroundingMode('NOT_A_MODE')).toBe('BUSINESS_KNOWLEDGE')
    expect(resolveLineKnowledgeGroundingMode('gks_corpus')).toBe('BUSINESS_KNOWLEDGE') // case-sensitive, never guessed
  })

  it('passes through a recognised mode', () => {
    expect(resolveLineKnowledgeGroundingMode('GKS_CORPUS')).toBe('GKS_CORPUS')
    expect(resolveLineKnowledgeGroundingMode('GKS_THEN_BUSINESS_KNOWLEDGE')).toBe('GKS_THEN_BUSINESS_KNOWLEDGE')
  })
})

describe('lineKnowledgeGroundingBudgetFromEnv', () => {
  it('applies safe defaults', () => {
    expect(lineKnowledgeGroundingBudgetFromEnv({})).toEqual({ budgetMs: 2500, topK: 5, maxPacketBytes: 8192 })
  })

  it('reads a configured, valid override', () => {
    expect(lineKnowledgeGroundingBudgetFromEnv({ ZURI_LINE_KNOWLEDGE_BUDGET_MS: '1000', ZURI_LINE_KNOWLEDGE_TOP_K: '3', ZURI_LINE_KNOWLEDGE_MAX_PACKET_BYTES: '4096' }))
      .toEqual({ budgetMs: 1000, topK: 3, maxPacketBytes: 4096 })
  })

  it('falls back to the default on an invalid override, never a permissive guess', () => {
    expect(lineKnowledgeGroundingBudgetFromEnv({ ZURI_LINE_KNOWLEDGE_BUDGET_MS: '-5' }).budgetMs).toBe(2500)
    expect(lineKnowledgeGroundingBudgetFromEnv({ ZURI_LINE_KNOWLEDGE_BUDGET_MS: 'nope' }).budgetMs).toBe(2500)
  })
})

describe('createLineGroundingReader (FR-235)', () => {
  it('rejects BUSINESS_KNOWLEDGE and an unknown mode — this module is never used for the default path', () => {
    expect(() => createLineGroundingReader({ mode: 'BUSINESS_KNOWLEDGE', corpusReader: reader([]) })).toThrow(/LINE_KNOWLEDGE_GROUNDING_MODE_INVALID/)
    expect(() => createLineGroundingReader({ mode: 'NOPE', corpusReader: reader([]) })).toThrow(/LINE_KNOWLEDGE_GROUNDING_MODE_INVALID/)
  })

  it('GKS_CORPUS: returns corpus evidence and traces one GKS_CORPUS hop, no fallback reader required', async () => {
    const recordEvidence = vi.fn()
    const corpusReader = reader([{ kind: 'CORPUS_CHUNK', text: 'a' }])
    const grounding = createLineGroundingReader({ mode: 'GKS_CORPUS', corpusReader, trace: { recordEvidence } })
    const result = await grounding.query(INPUT)
    expect(result.records).toHaveLength(1)
    expect(recordEvidence).toHaveBeenCalledTimes(1)
    expect(recordEvidence.mock.calls[0][2]).toMatchObject({ source: 'GKS_CORPUS', reason: null })
  })

  it('GKS_CORPUS: empty corpus evidence traces GKS_CORPUS then NONE, never touches a fallback reader', async () => {
    const recordEvidence = vi.fn()
    const businessKnowledgeReader = reader([{ product_code: 'should-never-be-read' }])
    const grounding = createLineGroundingReader({ mode: 'GKS_CORPUS', corpusReader: reader([]), businessKnowledgeReader, trace: { recordEvidence } })
    const result = await grounding.query(INPUT)
    expect(result.records).toEqual([])
    expect(businessKnowledgeReader.query).not.toHaveBeenCalled()
    expect(recordEvidence).toHaveBeenCalledTimes(2)
    expect(recordEvidence.mock.calls[0][2]).toMatchObject({ source: 'GKS_CORPUS', reason: 'NO_EVIDENCE' })
    expect(recordEvidence.mock.calls[1][2]).toMatchObject({ source: 'NONE', reason: 'NO_EVIDENCE' })
  })

  it('GKS_THEN_BUSINESS_KNOWLEDGE: falls back to business knowledge on NO_EVIDENCE, tracing the reason', async () => {
    const recordEvidence = vi.fn()
    const businessKnowledgeReader = reader([{ product_code: 'fallback-hit' }])
    const grounding = createLineGroundingReader({ mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', corpusReader: reader([]), businessKnowledgeReader, trace: { recordEvidence } })
    const result = await grounding.query(INPUT)
    expect(businessKnowledgeReader.query).toHaveBeenCalledTimes(1)
    expect(result.records).toEqual([{ product_code: 'fallback-hit' }])
    expect(recordEvidence).toHaveBeenCalledTimes(2)
    expect(recordEvidence.mock.calls[0][2]).toMatchObject({ source: 'GKS_CORPUS', reason: 'NO_EVIDENCE' })
    expect(recordEvidence.mock.calls[1][2]).toMatchObject({ source: 'BUSINESS_KNOWLEDGE', reason: 'NO_EVIDENCE' })
  })

  it('GKS_THEN_BUSINESS_KNOWLEDGE: a corpus reader error is GKS_UNAVAILABLE, never a leaked internal error, and still falls back', async () => {
    const recordEvidence = vi.fn()
    const businessKnowledgeReader = reader([{ product_code: 'fallback-hit' }])
    const grounding = createLineGroundingReader({ mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', corpusReader: reader([], { throws: true }), businessKnowledgeReader, trace: { recordEvidence } })
    const result = await grounding.query(INPUT)
    expect(result.records).toEqual([{ product_code: 'fallback-hit' }])
    expect(recordEvidence.mock.calls[0][2].reason).toBe('GKS_UNAVAILABLE')
    expect(recordEvidence.mock.calls[1][2]).toMatchObject({ source: 'BUSINESS_KNOWLEDGE', reason: 'GKS_UNAVAILABLE' })
    // No trace payload anywhere in this call carries the underlying error text.
    for (const call of recordEvidence.mock.calls) {
      expect(JSON.stringify(call)).not.toMatch(/credential|boom/i)
    }
  })

  it('GKS_THEN_BUSINESS_KNOWLEDGE: a hop over budget is GKS_UNAVAILABLE and still falls back', async () => {
    const recordEvidence = vi.fn()
    const businessKnowledgeReader = reader([{ product_code: 'fallback-hit' }])
    const slowCorpusReader = reader([{ kind: 'CORPUS_CHUNK', text: 'too-slow' }], { delayMs: 50 })
    const grounding = createLineGroundingReader({ mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', corpusReader: slowCorpusReader, businessKnowledgeReader, trace: { recordEvidence }, budgetMs: 5 })
    const result = await grounding.query(INPUT)
    expect(result.records).toEqual([{ product_code: 'fallback-hit' }])
    expect(recordEvidence.mock.calls[0][2].reason).toBe('GKS_UNAVAILABLE')
  })

  it('GKS_THEN_BUSINESS_KNOWLEDGE: no evidence from either source traces a final NONE and returns empty', async () => {
    const recordEvidence = vi.fn()
    const grounding = createLineGroundingReader({ mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', corpusReader: reader([]), businessKnowledgeReader: reader([]), trace: { recordEvidence } })
    const result = await grounding.query(INPUT)
    expect(result.records).toEqual([])
    expect(recordEvidence).toHaveBeenCalledTimes(3)
    expect(recordEvidence.mock.calls[2][2]).toMatchObject({ source: 'NONE', reason: 'NO_EVIDENCE' })
  })

  it('GKS_THEN_BUSINESS_KNOWLEDGE: corpus success never touches the fallback reader', async () => {
    const businessKnowledgeReader = reader([{ product_code: 'never-called' }])
    const grounding = createLineGroundingReader({ mode: 'GKS_THEN_BUSINESS_KNOWLEDGE', corpusReader: reader([{ kind: 'CORPUS_CHUNK', text: 'a' }]), businessKnowledgeReader })
    await grounding.query(INPUT)
    expect(businessKnowledgeReader.query).not.toHaveBeenCalled()
  })

  it('never traces when no trace observer is given', async () => {
    const grounding = createLineGroundingReader({ mode: 'GKS_CORPUS', corpusReader: reader([]) })
    await expect(grounding.query(INPUT)).resolves.toEqual({ records: [] })
  })
})
