import crypto from 'node:crypto'

// @req FR-081, FR-092
// @spec BR-019, SDD-049, ADR-038
// @tested tests/unit/integration/retail-price-adapter.test.js

function computeSha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Adapter to normalize structured retail price feeds into Integration RawRecord inputs.
 */
export function formatRetailPriceRawRecord({
  tenantId,
  businessId = null,
  connectionId,
  provider = 'retail_lotus',
  sku,
  productName,
  price,
  currency = 'THB',
  bundleQuantity = 1,
  unit = 'PIECE',
  inStock = true,
  sourceUri = null,
  rawPayload = {},
}) {
  if (!tenantId || !connectionId || !sku || !productName) {
    throw new Error('tenantId, connectionId, sku, and productName are required')
  }

  const payloadObj = {
    sku,
    productName,
    price: Number(price),
    currency,
    bundleQuantity: Number(bundleQuantity) || 1,
    unit,
    inStock: Boolean(inStock),
    sourceUri,
    ...rawPayload,
  }

  const rawPayloadString = JSON.stringify(payloadObj)
  const payloadHash = computeSha256(rawPayloadString)
  const idempotencyKey = computeSha256(`${tenantId}:${connectionId}:${provider}:${sku}:${payloadHash}`)

  return {
    tenantId,
    businessId,
    connectionId,
    provider,
    entityType: 'retail_price',
    externalId: sku,
    payloadHash,
    idempotencyKey,
    rawPayload: rawPayloadString,
    sourceUri,
  }
}
