// @req FR-253 — explicit sell-side allowlist keeps private costing evidence out of Knowledge.
// @spec ADR-098; ADR-075; BR-002
// @tested tests/integration/fr252-pricing-catalog.test.js
export function buildPricingCatalogProjection(product, quantity, unitPriceSatang, now) {
  const fileName = `commerce-price-${product.id}.json`
  const externalId = `commerce-sku:${product.id}`
  const priceId = `commerce-price:${product.id}:${quantity}`
  const catalogVersionDate = now.toISOString().slice(0, 10)
  return {
    fileName,
    productRecord: {
      entityType: 'ProductMaster', externalId, code: externalId,
      nameTh: `${product.code} — ${product.name || product.productMaster.nameTh}`,
      nameEn: product.productMaster.nameEn || null,
      priceTiersThb: [], catalogVersionDate,
      provenance: { upstreamFile: fileName, upstreamRecordId: externalId },
    },
    priceRecord: {
      entityType: 'PriceListEntry', externalId: priceId, productExternalId: externalId,
      qty: quantity, srpUnitPriceThb: unitPriceSatang / 100,
      srpSource: 'COMMERCE_APPROVED_COMPUTED', catalogVersionDate,
      provenance: { upstreamFile: fileName, upstreamRecordId: priceId },
    },
  }
}
