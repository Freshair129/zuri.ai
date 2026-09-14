import prisma from '@/lib/db'
import { isDomainVisible } from '@/config/domains'
import { assertDomainVisible, domainsForBusiness } from '@/modules/identity/viewer-domains'

// @req FR-237 — a Business-scoped report over EVIDENCE_SELECTED trace events
//   (agent lane, execution-trace.js/line-execution-trace.js) with
//   `reason === 'NO_EVIDENCE'`: counts, product locators (where the traced
//   query names one) and last-seen times only. The question text never
//   leaves CRM and never appears here — this service reads only `reason` and
//   `query.queryId`/`query.params.productCode`/`params.productCodes` from the
//   trace payload, and deliberately never reads `query.params.term` (the
//   `product_search` shape carries the raw customer question there —
//   `selectRegisteredQuery`, grounded-business-answer.js). Computed on read:
//   no new Prisma model, per the knowledge charter's "owns no models except
//   KnowledgeCandidate" boundary (ADR-090 D6) — AgentTraceEvent is agent's.
// @spec ADR-090 D7; SEC-032; BR-002
// @tested tests/integration/fr237-knowledge-gap-report.test.js, tests/unit/knowledge-gap-report-service.test.js

const KNOWLEDGE_DOMAIN = 'knowledge'
const NO_EVIDENCE = 'NO_EVIDENCE'
const EVIDENCE_SELECTED = 'EVIDENCE_SELECTED'
// A generous but bounded read: this is a computed-on-read report, not a paged
// list, and a business running far past this volume of gaps needs a
// persisted aggregate — a decision for a later task, not a silent unbounded
// query here.
const MAX_EVENTS = 5000

/** Every Business id this viewer may see under the `knowledge` domain — never a caller-supplied list. */
function visibleKnowledgeBusinessIds(viewer) {
  const ids = Array.isArray(viewer?.visibleBusinessIds) ? viewer.visibleBusinessIds : []
  return ids.filter((id) => isDomainVisible(KNOWLEDGE_DOMAIN, domainsForBusiness(viewer, id)))
}

function resolveBusinessIds(viewer, businessId) {
  const requested = typeof businessId === 'string' ? businessId.trim() : ''
  if (requested) {
    assertDomainVisible(viewer, requested, KNOWLEDGE_DOMAIN)
    return [requested]
  }
  return visibleKnowledgeBusinessIds(viewer)
}

function safeParsePayload(json) {
  try {
    const value = JSON.parse(json)
    return value && typeof value === 'object' ? value : null
  } catch {
    return null
  }
}

/**
 * A product locator, and only a product locator — never the raw question.
 * `product_detail`/`product_compare` name one or more `Product.code` values
 * the caller's own query already resolved from the question; `product_search`
 * (and anything unrecognised) carries no locator, because its only
 * distinguishing field, `params.term`, is the question text itself.
 */
function locatorFromQuery(query) {
  const params = query && typeof query === 'object' ? query.params : null
  if (!params || typeof params !== 'object') return null
  if (query.queryId === 'product_detail' && typeof params.productCode === 'string' && params.productCode) {
    return { codes: [params.productCode] }
  }
  if (query.queryId === 'product_compare' && Array.isArray(params.productCodes) && params.productCodes.length) {
    const codes = params.productCodes.filter((code) => typeof code === 'string' && code)
    if (codes.length) return { codes }
  }
  return null
}

function locatorKey(locator) {
  return locator ? `codes:${[...locator.codes].sort().join(',')}` : 'UNSPECIFIED'
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/**
 * @param {{businessId?: string}} input  omit businessId to aggregate every
 *   Business the viewer may see under the `knowledge` domain.
 */
export async function getKnowledgeGapReport({ businessId } = {}, { viewer, db = prisma } = {}) {
  const businessIds = resolveBusinessIds(viewer, businessId)
  if (!businessIds.length) return { businesses: [], truncated: false }

  const rows = await db.agentTraceEvent.findMany({
    where: { businessId: { in: businessIds }, kind: EVIDENCE_SELECTED },
    select: { businessId: true, payloadJson: true, occurredAt: true },
    orderBy: { occurredAt: 'asc' },
    take: MAX_EVENTS + 1,
  })
  const truncated = rows.length > MAX_EVENTS
  const considered = truncated ? rows.slice(0, MAX_EVENTS) : rows

  const byBusiness = new Map(businessIds.map((id) => [id, new Map()]))
  for (const row of considered) {
    const payload = safeParsePayload(row.payloadJson)
    if (!payload || payload.reason !== NO_EVIDENCE) continue
    const bucket = byBusiness.get(row.businessId)
    if (!bucket) continue // defence in depth: the WHERE clause already scoped this
    const locator = locatorFromQuery(payload.query)
    const key = locatorKey(locator)
    const occurredAt = row.occurredAt instanceof Date ? row.occurredAt : new Date(row.occurredAt)
    const existing = bucket.get(key)
    if (existing) {
      existing.count += 1
      if (occurredAt > existing.lastSeenAt) existing.lastSeenAt = occurredAt
    } else {
      bucket.set(key, { locator, count: 1, lastSeenAt: occurredAt })
    }
  }

  return {
    businesses: businessIds.map((id) => ({
      businessId: id,
      gaps: [...byBusiness.get(id).values()]
        .sort((a, b) => b.count - a.count || (a.lastSeenAt < b.lastSeenAt ? 1 : -1))
        .map((gap) => ({
          productLocator: gap.locator ? gap.locator.codes : null,
          locatorAvailable: Boolean(gap.locator),
          count: gap.count,
          lastSeenAt: toIso(gap.lastSeenAt),
        })),
    })),
    truncated,
  }
}

export const KNOWLEDGE_GAP_REPORT_MAX_EVENTS = MAX_EVENTS
