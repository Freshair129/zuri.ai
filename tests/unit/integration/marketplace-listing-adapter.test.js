import { describe, expect, it } from 'vitest'
import { formatMarketplaceListingRawRecord } from '@/modules/integration/adapters/marketplace-listing-adapter'

// @req FR-081, FR-092
// @spec BR-019, SDD-049, ADR-038
// @tested tests/unit/integration/marketplace-listing-adapter.test.js

describe('formatMarketplaceListingRawRecord', () => {
  it('constructs a deterministic raw record with valid SHA-256 payload hash', () => {
    const raw = formatMarketplaceListingRawRecord({
      tenantId: 'tenant-100',
      businessId: 'biz-100',
      connectionId: 'conn-fb-01',
      provider: 'facebook_marketplace',
      externalId: 'listing-998877',
      title: 'MSI RTX 3060 Ventus 2X 12GB',
      price: 5400,
      currency: 'THB',
      condition: 'USED',
      sellerName: 'Somchai G.',
      sourceUri: 'https://facebook.com/marketplace/item/998877',
    })

    expect(raw.tenantId).toBe('tenant-100')
    expect(raw.businessId).toBe('biz-100')
    expect(raw.provider).toBe('facebook_marketplace')
    expect(raw.entityType).toBe('listing')
    expect(raw.payloadHash).toMatch(/^[a-f0-9]{64}$/)
    expect(raw.idempotencyKey).toMatch(/^[a-f0-9]{64}$/)
    expect(raw.rawPayload).toContain('MSI RTX 3060')
  })

  it('fails when required fields are missing', () => {
    expect(() =>
      formatMarketplaceListingRawRecord({
        tenantId: 'tenant-100',
        connectionId: 'conn-1',
        // missing externalId and title
      }),
    ).toThrow()
  })
})
