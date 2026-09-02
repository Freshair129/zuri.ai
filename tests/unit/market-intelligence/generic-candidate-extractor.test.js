import { describe, expect, it } from 'vitest'

import { extractGenericMarketCandidate } from '@/modules/market-intelligence/application/generic-candidate-extractor'

// @req FR-092 — the default `extractCandidate` port the production translation
// trigger wires in. Covers both raw shapes the existing acquisition adapters
// produce (marketplace-listing-adapter.js, retail-price-adapter.js) plus the
// no-recognized-field fallback.
// @spec BR-019, SDD-049, ADR-038
// @tested tests/unit/market-intelligence/generic-candidate-extractor.test.js

describe('extractGenericMarketCandidate (FR-092)', () => {
  it('maps a marketplace listing payload to an EXTERNAL_OFFER candidate', async () => {
    const result = await extractGenericMarketCandidate({
      payload: { title: 'RTX 3060 มือสอง', price: 4900, currency: 'THB', condition: 'USED', sellerName: 'ร้านเอบี' },
      source: { entityType: 'listing' },
    })

    expect(result).toEqual({
      observationType: 'EXTERNAL_OFFER',
      candidate: {
        title: 'RTX 3060 มือสอง',
        price: 4900,
        currency: 'THB',
        sellerName: 'ร้านเอบี',
        condition: 'USED',
      },
    })
  })

  it('maps a retail price payload to a PRICE_OBSERVATION candidate', async () => {
    const result = await extractGenericMarketCandidate({
      payload: { sku: 'SKU-1', productName: 'น้ำมันพืช 1L', price: 55, currency: 'THB', unit: 'BOTTLE', inStock: true },
      source: { entityType: 'retail_price' },
    })

    expect(result).toEqual({
      observationType: 'PRICE_OBSERVATION',
      candidate: {
        title: 'น้ำมันพืช 1L',
        productCode: 'SKU-1',
        price: 55,
        currency: 'THB',
        unit: 'BOTTLE',
        inStock: true,
      },
    })
  })

  it('falls back to EXTERNAL_OFFER for an unrecognized entityType, without inventing field values', async () => {
    const result = await extractGenericMarketCandidate({
      payload: { name: 'สินค้าที่ไม่รู้จักประเภท' },
      source: { entityType: 'something_else' },
    })

    expect(result.observationType).toBe('EXTERNAL_OFFER')
    expect(result.candidate).toEqual({
      title: 'สินค้าที่ไม่รู้จักประเภท',
      price: null,
      currency: null,
      sellerName: null,
      condition: null,
    })
  })

  it('never throws on a missing or malformed payload', async () => {
    await expect(extractGenericMarketCandidate({ payload: null, source: {} })).resolves.toMatchObject({
      observationType: 'EXTERNAL_OFFER',
    })
    await expect(extractGenericMarketCandidate({})).resolves.toMatchObject({
      observationType: 'EXTERNAL_OFFER',
    })
  })
})
