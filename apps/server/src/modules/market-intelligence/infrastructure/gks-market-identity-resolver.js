import { MARKET_RESOLUTION_STATUS } from '../application/translate-raw-record'

// Market's only door to canonical identity. A payload-derived candidate in, a
// resolution verdict out; this adapter writes nothing and mints no knowledge. The
// candidate may supply the search *term* and nothing else — the Business scope is
// taken from the trusted caller, never from the payload, and a missing Business
// returns UNRESOLVED rather than widening into a cross-Business read. Knowledge is
// reached only through the governed BusinessKnowledgeReadPort's registered
// `product_search` query, so this file cannot invent a query the Knowledge contract
// has not sanctioned. That contract exposes canonical approved PRODUCT records but
// no canonical category-id registry, so `canonicalCategoryRef` is always null here.
// Ambiguity is reported, not resolved: exactly one exact match is RESOLVED, while
// zero or several matches stay PARTIAL so a review can settle identity later.
// @req FR-092
// @spec SDD-049, SEC-017, ADR-038
// @tested tests/unit/market-intelligence/gks-market-identity-resolver.test.js

function unresolved() {
  return {
    status: MARKET_RESOLUTION_STATUS.UNRESOLVED,
    canonicalProductRef: null,
    canonicalCategoryRef: null,
    confidence: null,
  }
}

function normalizeText(value) {
  return typeof value === 'string'
    ? value.trim().toLocaleLowerCase('th-TH')
    : ''
}

function candidateTerm(candidate) {
  return [candidate?.productCode, candidate?.title, candidate?.name]
    .find((value) => typeof value === 'string' && value.trim().length > 0)
    ?.trim() ?? null
}

function exactProductMatch(candidate, record) {
  const productCode = normalizeText(candidate?.productCode)
  if (productCode && productCode === normalizeText(record.product_code)) return true

  const title = normalizeText(candidate?.title ?? candidate?.name)
  return Boolean(title && title === normalizeText(record.name))
}

export function createGksMarketIdentityResolver({ reader, businessId } = {}) {
  if (!reader || typeof reader.query !== 'function') {
    throw new Error('BusinessKnowledgeReadPort reader is required')
  }

  return async function resolveMarketIdentity({ candidate } = {}) {
    if (!businessId) return unresolved()

    const term = candidateTerm(candidate)
    if (!term) return unresolved()

    const packet = await reader.query({
      businessId,
      queryId: 'product_search',
      params: { term },
      limit: 5,
    })

    const records = Array.isArray(packet?.records) ? packet.records : []
    if (records.length === 0) return unresolved()

    const exact = records.filter((record) => exactProductMatch(candidate, record))
    if (exact.length === 1) {
      return {
        status: MARKET_RESOLUTION_STATUS.RESOLVED,
        canonicalProductRef: `gks:business-knowledge:${exact[0].knowledge_id}`,
        canonicalCategoryRef: null,
        confidence: 1,
      }
    }

    // Search evidence exists, but zero or multiple exact matches cannot safely mint
    // one canonical identity. Keep it explicitly partial for later review/resolution.
    return {
      status: MARKET_RESOLUTION_STATUS.PARTIAL,
      canonicalProductRef: null,
      canonicalCategoryRef: null,
      confidence: null,
    }
  }
}
