// @req FR-237 — pure aggregation behaviour of the knowledge gap report: only
//   `reason === 'NO_EVIDENCE'` events count, a locator comes only from
//   `product_detail`/`product_compare` queries and never from
//   `product_search`'s `params.term` (the raw question text), counts and
//   last-seen times are correct, and a malformed payload is skipped rather
//   than thrown. Business scoping and viewer authority are covered by
//   tests/integration/fr237-knowledge-gap-report.test.js against a real
//   database and real `makeViewer()` fixtures.
// @spec ADR-090 D7; SEC-032
// @tested tests/unit/knowledge-gap-report-service.test.js
import { describe, expect, it } from 'vitest'
import { getKnowledgeGapReport } from '@/modules/knowledge/application/knowledge-gap-report-service'
import { makeViewer } from '../factories/viewer'

function event({ businessId, reason, query, occurredAt }) {
  return {
    businessId,
    occurredAt: new Date(occurredAt),
    payloadJson: JSON.stringify({ source: 'GKS_CORPUS', reason, query, evidence: { records: [] } }),
  }
}

function fakeDb(rows) {
  return { agentTraceEvent: { findMany: async () => rows } }
}

const KNOWLEDGE_VIEWER = (businessIds) => makeViewer({ visibleBusinessIds: businessIds, ownedBusinessIds: businessIds, visibleDomains: ['knowledge'] })

describe('FR-237 knowledge gap report — aggregation', () => {
  it('counts only NO_EVIDENCE events, ignores everything else, and never reads the raw question', async () => {
    const viewer = KNOWLEDGE_VIEWER(['biz-1'])
    const db = fakeDb([
      event({ businessId: 'biz-1', reason: 'NO_EVIDENCE', query: { queryId: 'product_detail', params: { productCode: 'SKU-1' } }, occurredAt: '2026-09-14T10:00:00Z' }),
      // Has evidence: never counted.
      event({ businessId: 'biz-1', reason: undefined, query: { queryId: 'product_detail', params: { productCode: 'SKU-1' } }, occurredAt: '2026-09-14T10:05:00Z' }),
      // GKS_UNAVAILABLE: a real reason, but not NO_EVIDENCE — never counted.
      event({ businessId: 'biz-1', reason: 'GKS_UNAVAILABLE', query: { queryId: 'product_detail', params: { productCode: 'SKU-1' } }, occurredAt: '2026-09-14T10:06:00Z' }),
    ])
    const report = await getKnowledgeGapReport({ businessId: 'biz-1' }, { viewer, db })
    expect(report.businesses).toHaveLength(1)
    expect(report.businesses[0].gaps).toEqual([
      { productLocator: ['SKU-1'], locatorAvailable: true, count: 1, lastSeenAt: '2026-09-14T10:00:00.000Z' },
    ])
  })

  it('extracts a locator from product_detail and product_compare, never from product_search (the raw question lives in params.term)', async () => {
    const viewer = KNOWLEDGE_VIEWER(['biz-1'])
    const db = fakeDb([
      event({ businessId: 'biz-1', reason: 'NO_EVIDENCE', query: { queryId: 'product_compare', params: { productCodes: ['SKU-A', 'SKU-B'] } }, occurredAt: '2026-09-14T09:00:00Z' }),
      event({ businessId: 'biz-1', reason: 'NO_EVIDENCE', query: { queryId: 'product_search', params: { term: 'มีสีแดงไหม สอบถามราคาด่วน' } }, occurredAt: '2026-09-14T09:30:00Z' }),
    ])
    const report = await getKnowledgeGapReport({ businessId: 'biz-1' }, { viewer, db })
    const gaps = report.businesses[0].gaps
    expect(gaps).toContainEqual({ productLocator: ['SKU-A', 'SKU-B'], locatorAvailable: true, count: 1, lastSeenAt: '2026-09-14T09:00:00.000Z' })
    const unspecified = gaps.find((g) => !g.locatorAvailable)
    expect(unspecified).toEqual({ productLocator: null, locatorAvailable: false, count: 1, lastSeenAt: '2026-09-14T09:30:00.000Z' })
    // The full serialized report must never contain the question text.
    expect(JSON.stringify(report)).not.toContain('มีสีแดงไหม')
    expect(JSON.stringify(report)).not.toContain('สอบถามราคาด่วน')
    expect(JSON.stringify(report)).not.toContain('term')
  })

  it('aggregates repeated gaps for the same locator into one row with an incremented count and the latest lastSeenAt', async () => {
    const viewer = KNOWLEDGE_VIEWER(['biz-1'])
    const db = fakeDb([
      event({ businessId: 'biz-1', reason: 'NO_EVIDENCE', query: { queryId: 'product_detail', params: { productCode: 'SKU-1' } }, occurredAt: '2026-09-14T08:00:00Z' }),
      event({ businessId: 'biz-1', reason: 'NO_EVIDENCE', query: { queryId: 'product_detail', params: { productCode: 'SKU-1' } }, occurredAt: '2026-09-14T11:00:00Z' }),
      event({ businessId: 'biz-1', reason: 'NO_EVIDENCE', query: { queryId: 'product_detail', params: { productCode: 'SKU-1' } }, occurredAt: '2026-09-14T09:00:00Z' }),
    ])
    const report = await getKnowledgeGapReport({ businessId: 'biz-1' }, { viewer, db })
    expect(report.businesses[0].gaps).toEqual([
      { productLocator: ['SKU-1'], locatorAvailable: true, count: 3, lastSeenAt: '2026-09-14T11:00:00.000Z' },
    ])
  })

  it('never leaks another Business\'s counts when aggregating every visible Business', async () => {
    const viewer = KNOWLEDGE_VIEWER(['biz-1', 'biz-2'])
    const db = fakeDb([
      event({ businessId: 'biz-1', reason: 'NO_EVIDENCE', query: { queryId: 'product_detail', params: { productCode: 'SKU-1' } }, occurredAt: '2026-09-14T08:00:00Z' }),
      event({ businessId: 'biz-2', reason: 'NO_EVIDENCE', query: { queryId: 'product_detail', params: { productCode: 'SKU-2' } }, occurredAt: '2026-09-14T08:00:00Z' }),
      event({ businessId: 'biz-2', reason: 'NO_EVIDENCE', query: { queryId: 'product_detail', params: { productCode: 'SKU-2' } }, occurredAt: '2026-09-14T09:00:00Z' }),
    ])
    const report = await getKnowledgeGapReport({}, { viewer, db })
    const byBusiness = Object.fromEntries(report.businesses.map((b) => [b.businessId, b.gaps]))
    expect(byBusiness['biz-1']).toEqual([{ productLocator: ['SKU-1'], locatorAvailable: true, count: 1, lastSeenAt: '2026-09-14T08:00:00.000Z' }])
    expect(byBusiness['biz-2']).toEqual([{ productLocator: ['SKU-2'], locatorAvailable: true, count: 2, lastSeenAt: '2026-09-14T09:00:00.000Z' }])
  })

  it('skips a malformed payload rather than throwing', async () => {
    const viewer = KNOWLEDGE_VIEWER(['biz-1'])
    const malformedRow = { businessId: 'biz-1', occurredAt: new Date(), payloadJson: '{not json' }
    const db = fakeDb([malformedRow])
    await expect(getKnowledgeGapReport({ businessId: 'biz-1' }, { viewer, db })).resolves.toEqual({ businesses: [{ businessId: 'biz-1', gaps: [] }], truncated: false })
  })

  it('refuses a businessId the viewer cannot see under the knowledge domain, 404-shaped', async () => {
    const viewer = KNOWLEDGE_VIEWER(['biz-1'])
    const db = fakeDb([])
    await expect(getKnowledgeGapReport({ businessId: 'biz-9' }, { viewer, db })).rejects.toMatchObject({ status: 404 })
  })

  it('returns no businesses for a viewer with no knowledge-domain grant anywhere, without querying the database', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['biz-1'], ownedBusinessIds: ['biz-1'], visibleDomains: ['projects'] })
    let called = false
    const db = { agentTraceEvent: { findMany: async () => { called = true; return [] } } }
    const report = await getKnowledgeGapReport({}, { viewer, db })
    expect(report).toEqual({ businesses: [], truncated: false })
    expect(called).toBe(false)
  })
})
