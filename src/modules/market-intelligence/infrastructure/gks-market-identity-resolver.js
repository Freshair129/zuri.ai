import { MARKET_RESOLUTION_STATUS } from '../application/translate-raw-record'

// Market-facing adapter over the existing governed BusinessKnowledgeReadPort.
// The current Knowledge contract exposes canonical approved PRODUCT records via
// registered queries but does not expose a canonical category-id registry, so this
// adapter deliberately resolves only canonical product refs for now.
// @spec ADR-038

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
