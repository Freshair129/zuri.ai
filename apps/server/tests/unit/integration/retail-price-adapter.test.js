import { describe, expect, it } from 'vitest'
import { formatRetailPriceRawRecord } from '@/modules/integration/adapters/retail-price-adapter'

// @req FR-081, FR-092
// @spec BR-019, SDD-049, ADR-038
// @tested tests/unit/integration/retail-price-adapter.test.js

describe('formatRetailPriceRawRecord', () => {
  it('constructs deterministic raw record for retail item and bundle pricing', () => {
    const raw = formatRetailPriceRawRecord({
      tenantId: 'tenant-100',
      businessId: 'biz-100',
      connectionId: 'conn-lotus-01',
      provider: 'retail_lotus',
      sku: 'SKU-DRINK-PACK-6',
      productName: 'Fresh Orange Juice 250ml Pack 6',
      price: 156,
      currency: 'THB',
      bundleQuantity: 6,
      unit: 'PACK',
      inStock: true,
      sourceUri: 'https://lotuss.com/product/juice-pack-6',
    })

    expect(raw.tenantId).toBe('tenant-100')
    expect(raw.provider).toBe('retail_lotus')
    expect(raw.entityType).toBe('retail_price')
    expect(raw.payloadHash).toMatch(/^[a-f0-9]{64}$/)
    expect(raw.idempotencyKey).toMatch(/^[a-f0-9]{64}$/)
    expect(raw.rawPayload).toContain('"bundleQuantity":6')
  })

  it('fails when sku or productName is missing', () => {
    expect(() =>
      formatRetailPriceRawRecord({
        tenantId: 'tenant-100',
        connectionId: 'conn-1',
        sku: '',
      }),
    ).toThrow()
  })
})
