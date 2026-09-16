// @req FR-237 — the knowledge gap report against a real database and real
//   EVIDENCE_SELECTED trace events (written through the same
//   createLineExecutionTrace().recordEvidence the agent lane uses, FR-235):
//   counts, product locators and last-seen times only, scoped to the
//   viewer's visible Business(es); no question text anywhere in the
//   aggregation, and one Business can never see another's counts.
// @spec ADR-090 D7; SEC-032
// @tested tests/integration/fr237-knowledge-gap-report.test.js
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { createLineExecutionTrace } from '@/modules/agent/line-execution-trace'
import { getKnowledgeGapReport } from '@/modules/knowledge/application/knowledge-gap-report-service'

let portfolio, tenant, businessA, businessB

const QUESTION_TEXT = 'มีสีแดงไหมคะ ราคาเท่าไหร่'

async function writeEvidence(business, { reason, query }) {
  const job = { id: randomUUID(), tenantId: tenant.id, businessId: business.id, executionId: randomUUID() }
  const trace = createLineExecutionTrace({ db: prisma, job })
  await trace.recordEvidence(query, { records: [] }, { source: 'GKS_CORPUS', reason })
}

describe('FR-237 knowledge gap report — real trace events', () => {
  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8)
    portfolio = await createPortfolio({ name: `GapReport portfolio ${suffix}`, code: `GR-PF-${suffix}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `GapReport tenant ${suffix}`, code: `GR-TN-${suffix}` })
    businessA = await createBusiness({ tenantId: tenant.id, name: `GapReport A ${suffix}`, code: `GR-BU-A-${suffix}` })
    businessB = await createBusiness({ tenantId: tenant.id, name: `GapReport B ${suffix}`, code: `GR-BU-B-${suffix}` })

    // Business A: two NO_EVIDENCE gaps for the same product (aggregate to
    // count 2), one with evidence (never counted), one product_search gap
    // whose only distinguishing field is the raw question (never a locator).
    await writeEvidence(businessA, { reason: 'NO_EVIDENCE', query: { queryId: 'product_detail', params: { productCode: 'SKU-RED-1' } } })
    await writeEvidence(businessA, { reason: 'NO_EVIDENCE', query: { queryId: 'product_detail', params: { productCode: 'SKU-RED-1' } } })
    await writeEvidence(businessA, { reason: undefined, query: { queryId: 'product_detail', params: { productCode: 'SKU-RED-1' } } })
    await writeEvidence(businessA, { reason: 'NO_EVIDENCE', query: { queryId: 'product_search', params: { term: QUESTION_TEXT } } })

    // Business B: one gap for a different product. Proves cross-Business
    // isolation — Business A's viewer must never see this.
    await writeEvidence(businessB, { reason: 'NO_EVIDENCE', query: { queryId: 'product_detail', params: { productCode: 'SKU-BLUE-1' } } })
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('AC-237.1 — aggregates NO_EVIDENCE gaps per Business with counts, locators and last-seen times, and never the question text', async () => {
    const viewer = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id], visibleDomains: ['knowledge'] })
    const report = await getKnowledgeGapReport({ businessId: businessA.id }, { viewer })
    expect(report.businesses).toHaveLength(1)
    const gaps = report.businesses[0].gaps
    expect(gaps).toContainEqual(expect.objectContaining({ productLocator: ['SKU-RED-1'], locatorAvailable: true, count: 2 }))
    const unspecified = gaps.find((g) => !g.locatorAvailable)
    expect(unspecified).toMatchObject({ productLocator: null, locatorAvailable: false, count: 1 })
    expect(new Date(unspecified.lastSeenAt).getTime()).not.toBeNaN()

    // The report never carries the question text, under any key or nesting.
    const serialized = JSON.stringify(report)
    expect(serialized).not.toContain(QUESTION_TEXT)
    expect(serialized).not.toContain('มีสีแดง')
    expect(serialized).not.toContain('term')
    expect(serialized).not.toContain('question')
  })

  it('AC-237.2 — never leaks another Business\'s counts: a viewer of A cannot see B\'s gap, and vice versa', async () => {
    const viewerA = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id], visibleDomains: ['knowledge'] })
    const reportA = await getKnowledgeGapReport({ businessId: businessA.id }, { viewer: viewerA })
    expect(JSON.stringify(reportA)).not.toContain('SKU-BLUE-1')

    const viewerB = makeViewer({ visibleBusinessIds: [businessB.id], ownedBusinessIds: [businessB.id], visibleDomains: ['knowledge'] })
    const reportB = await getKnowledgeGapReport({ businessId: businessB.id }, { viewer: viewerB })
    expect(reportB.businesses[0].gaps).toEqual([{ productLocator: ['SKU-BLUE-1'], locatorAvailable: true, count: 1, lastSeenAt: expect.any(String) }])
    expect(JSON.stringify(reportB)).not.toContain('SKU-RED-1')

    // A viewer denied the knowledge domain on A cannot even name it.
    const noKnowledgeAccess = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id], visibleDomains: ['projects'] })
    await expect(getKnowledgeGapReport({ businessId: businessA.id }, { viewer: noKnowledgeAccess })).rejects.toMatchObject({ status: 404 })

    // A viewer who cannot see Business A at all cannot request it either.
    const outsider = makeViewer({ visibleBusinessIds: [businessB.id], ownedBusinessIds: [businessB.id], visibleDomains: ['knowledge'] })
    await expect(getKnowledgeGapReport({ businessId: businessA.id }, { viewer: outsider })).rejects.toMatchObject({ status: 404 })
  })

  it('AC-237.3 — aggregating every visible Business at once still isolates each one\'s counts', async () => {
    const both = makeViewer({ visibleBusinessIds: [businessA.id, businessB.id], ownedBusinessIds: [businessA.id, businessB.id], visibleDomains: ['knowledge'] })
    const report = await getKnowledgeGapReport({}, { viewer: both })
    const byBusiness = Object.fromEntries(report.businesses.map((b) => [b.businessId, b.gaps]))
    expect(byBusiness[businessA.id].some((g) => g.locatorAvailable && g.productLocator.includes('SKU-BLUE-1'))).toBe(false)
    expect(byBusiness[businessB.id].some((g) => g.locatorAvailable && g.productLocator.includes('SKU-RED-1'))).toBe(false)
  })
})
