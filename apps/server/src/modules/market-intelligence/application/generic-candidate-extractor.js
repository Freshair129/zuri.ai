// The default `extractCandidate` port for the FR-092 production translation trigger
// (`POST /api/market/translations`). Acquisition adapters
// (`marketplace-listing-adapter.js`, `retail-price-adapter.js`) format *raw* ingestion
// payloads; nothing before this slice turned those payloads back into a translation
// candidate, so `loadTranslateAndPersistRawMarketRecord` had no caller outside tests.
//
// This extractor is intentionally provider-neutral rather than provider-specific: it
// reads the two raw shapes those adapters already produce (`entityType: 'listing'`
// and `entityType: 'retail_price'`) and any other payload that happens to carry the
// same field names, and it invents nothing the translator's own scope rules already
// forbid — it never touches tenantId/businessId/connectionId, only `payload`. A
// payload missing every recognized field still returns an object (all fields `null`);
// the translator's own domain schema is what would reject a truly empty candidate, not
// this file guessing a value to avoid that.
// @req FR-092
// @spec BR-019, SDD-049, ADR-038
// @tested tests/unit/market-intelligence/generic-candidate-extractor.test.js

const OBSERVATION_TYPE_BY_ENTITY_TYPE = {
  listing: 'EXTERNAL_OFFER',
  retail_price: 'PRICE_OBSERVATION',
}

const DEFAULT_OBSERVATION_TYPE = 'EXTERNAL_OFFER'

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null) return value
  }
  return null
}

function retailPriceCandidate(payload) {
  return {
    title: firstDefined(payload.productName, payload.title, payload.name),
    productCode: firstDefined(payload.sku, payload.productCode),
    price: firstDefined(payload.price, payload.unitPrice),
    currency: firstDefined(payload.currency),
    unit: firstDefined(payload.unit),
    inStock: firstDefined(payload.inStock),
  }
}

function listingCandidate(payload) {
  return {
    title: firstDefined(payload.title, payload.name, payload.productTitle),
    price: firstDefined(payload.price, payload.unitPrice),
    currency: firstDefined(payload.currency),
    sellerName: firstDefined(payload.sellerName, payload.seller),
    condition: firstDefined(payload.condition),
  }
}

/**
 * @param {object} args
 * @param {object} args.payload  the parsed `RawExternalRecord.payloadJson` body
 * @param {object} args.source   `{ provider, entityType, externalId, sourceType, sourceUri, schemaVersion }`
 * @returns {Promise<{observationType: string, candidate: object}>}
 */
export async function extractGenericMarketCandidate({ payload, source } = {}) {
  const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {}
  const entityType = typeof source?.entityType === 'string' ? source.entityType : null
  const observationType = OBSERVATION_TYPE_BY_ENTITY_TYPE[entityType] ?? DEFAULT_OBSERVATION_TYPE

  const candidate = entityType === 'retail_price'
    ? retailPriceCandidate(safePayload)
    : listingCandidate(safePayload)

  return { observationType, candidate }
}
