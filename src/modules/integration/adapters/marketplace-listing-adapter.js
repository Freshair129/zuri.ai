import crypto from 'node:crypto'

// @req FR-081, FR-092
// @spec BR-019, SDD-049, ADR-038
// @tested tests/unit/integration/marketplace-listing-adapter.test.js

function computeSha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Adapter to normalize external marketplace listings into Integration RawRecord inputs.
 */
export function formatMarketplaceListingRawRecord({
  tenantId,
  businessId = null,
  connectionId,
  provider = 'facebook_marketplace',
  externalId,
  title,
  price,
  currency = 'THB',
  condition = 'USED',
  sellerName = null,
  sourceUri = null,
  rawPayload = {},
}) {
  if (!tenantId || !connectionId || !externalId || !title) {
    throw new Error('tenantId, connectionId, externalId, and title are required')
  }

  const payloadObj = {
    title,
    price: Number(price),
    currency,
    condition,
    sellerName,
    sourceUri,
    ...rawPayload,
  }

  const rawPayloadString = JSON.stringify(payloadObj)
  const payloadHash = computeSha256(rawPayloadString)
  const idempotencyKey = computeSha256(`${tenantId}:${connectionId}:${provider}:${externalId}:${payloadHash}`)

  return {
    tenantId,
    businessId,
    connectionId,
    provider,
    entityType: 'listing',
    externalId,
    payloadHash,
    idempotencyKey,
    rawPayload: rawPayloadString,
    sourceUri,
  }
}
