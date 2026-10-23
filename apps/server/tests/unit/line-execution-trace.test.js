import { describe, expect, it, vi } from 'vitest'
import { createLineExecutionTrace } from '@/modules/agent/line-execution-trace'

// @req FR-171, FR-235 — recordEvidence's per-hop meta (source, reason,
// retrievalRefs, budgetMs), backward compatible with the pre-FR-235 shape.
// @tested tests/unit/line-execution-trace.test.js

const appendTraceEvent = vi.hoisted(() => vi.fn(async (_db, event) => event))
vi.mock('@/modules/agent/execution-trace', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, appendTraceEvent: (...args) => appendTraceEvent(...args) }
})

const job = { id: 'job-1', tenantId: 'tenant-1', businessId: 'business-1', executionId: 'exec-1' }

describe('createLineExecutionTrace().recordEvidence (FR-235)', () => {
  it('keeps selected RAG evidence content-free while retaining the exact sanitized model request under FR-171', async () => {
    appendTraceEvent.mockClear()
    const trace = createLineExecutionTrace({ db: {}, job })
    const evidence = { records: [{ product_code: 'TEST-ONLY-001', name: 'TEST ONLY cup' }] }
    await trace.recordEvidence({ params: { term: 'private-query' } }, evidence,
      { contentFree: true, source: 'GKS_CORPUS', retrievalRefs: [{ citationId: 'cit-1', sourceId: 'src-1' }] })
    const event = appendTraceEvent.mock.calls[0][1]
    expect(event.payload).toMatchObject({ recordCount: 1, retrievalRefs: [{ citationId: 'cit-1', sourceId: 'src-1' }] })
    expect(event.payload).not.toHaveProperty('evidence')
    expect(event.payload).not.toHaveProperty('query')
    expect(JSON.stringify(event.payload)).not.toMatch(/TEST ONLY cup|TEST-ONLY-001|private-query/)
    const requestBody = { messages: [{ role: 'user', content: JSON.stringify(evidence) }] }
    await trace.beforeModelCall({ provider: 'ollama', model: 'test', requestBody })
    expect(appendTraceEvent.mock.calls[1][1].payload.requestBody).toEqual(requestBody)
  })
  it('defaults to the pre-FR-235 shape when no meta is given', async () => {
    appendTraceEvent.mockClear()
    const trace = createLineExecutionTrace({ db: {}, job })
    await trace.recordEvidence({ queryId: 'product_detail' }, { records: [] })
    const [, event] = appendTraceEvent.mock.calls[0]
    expect(event.kind).toBe('EVIDENCE_SELECTED')
    expect(event.payload.source).toBe('BUSINESS_QUERY')
    expect(event.payload).not.toHaveProperty('reason')
    expect(event.payload).not.toHaveProperty('retrievalRefs')
    expect(event.payload).not.toHaveProperty('budgetMs')
  })

  it('carries the caller-supplied source, reason, retrievalRefs and budgetMs', async () => {
    appendTraceEvent.mockClear()
    const trace = createLineExecutionTrace({ db: {}, job })
    const refs = [{ citationId: 'cit-1', sourceId: 'src-1', snapshotId: 'snap-1', generation: 1, corpusGeneration: 2, manifestHash: 'h'.repeat(64) }]
    await trace.recordEvidence({ queryId: 'product_detail' }, { records: [] }, { source: 'GKS_CORPUS', reason: 'NO_EVIDENCE', retrievalRefs: refs, budgetMs: 42 })
    const [, event] = appendTraceEvent.mock.calls[0]
    expect(event.payload).toMatchObject({ source: 'GKS_CORPUS', reason: 'NO_EVIDENCE', retrievalRefs: refs, budgetMs: 42 })
  })

  it('records one distinct EVIDENCE_SELECTED event per hop, each keyed by its own retrievalRunId', async () => {
    appendTraceEvent.mockClear()
    const trace = createLineExecutionTrace({ db: {}, job })
    await trace.recordEvidence({}, { records: [] }, { source: 'GKS_CORPUS', reason: 'GKS_UNAVAILABLE' })
    await trace.recordEvidence({}, { records: [{ product_code: 'A' }] }, { source: 'BUSINESS_KNOWLEDGE', reason: 'GKS_UNAVAILABLE' })
    expect(appendTraceEvent).toHaveBeenCalledTimes(2)
    const [firstKey] = [appendTraceEvent.mock.calls[0][1].idempotencyKey]
    const [secondKey] = [appendTraceEvent.mock.calls[1][1].idempotencyKey]
    expect(firstKey).not.toBe(secondKey)
  })
})
