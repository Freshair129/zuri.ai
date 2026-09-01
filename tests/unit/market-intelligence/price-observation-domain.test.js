import { describe, expect, it } from 'vitest'
import {
  calculateNormalizedUnitPrice,
  normalizePriceObservationDraft,
} from '@/modules/market-intelligence/domain/price-observation'
import {
  evaluateWatchRule,
  normalizeWatchRuleDraft,
} from '@/modules/market-intelligence/domain/watch-rule'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/price-observation-domain.test.js

describe('PriceObservation domain', () => {
  it('correctly calculates normalized unit price for bundles', () => {
    // 156 / 6 = 26 THB/unit
    const unitPrice = calculateNormalizedUnitPrice(156, 6)
    expect(unitPrice).toBe(26)

    // Single item
    expect(calculateNormalizedUnitPrice(5500, 1)).toBe(5500)
  })

  it('validates and normalizes valid price observation draft', () => {
    const draft = {
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      rawRecordId: 'raw-123',
      sourceProvider: 'facebook_marketplace',
      productTitle: 'ASUS ROG RTX 3060 12GB Used',
      rawPrice: 5000,
      currency: 'THB',
      bundleQuantity: 1,
      condition: 'USED',
      intent: 'SELL',
      observedAt: new Date('2026-08-31T10:00:00Z'),
    }

    const normalized = normalizePriceObservationDraft(draft)
    expect(normalized.unitPrice).toBe(5000)
    expect(normalized.currency).toBe('THB')
    expect(normalized.condition).toBe('USED')
  })

  it('rejects negative prices or invalid bundle quantities', () => {
    expect(() => calculateNormalizedUnitPrice(-100, 1)).toThrow()
    expect(() => calculateNormalizedUnitPrice(100, 0)).toThrow()
    expect(() => calculateNormalizedUnitPrice(100, -2)).toThrow()
  })
})

describe('WatchRule domain & evaluation', () => {
  const rule = normalizeWatchRuleDraft({
    id: 'rule-rtx3060',
    tenantId: 'tenant-1',
    businessId: 'biz-1',
    name: 'RTX 3060 budget watch',
    query: 'RTX 3060',
    excludeKeywords: ['3060 Ti', 'Ti'],
    maxPrice: 5500,
    condition: 'USED',
    intent: 'SELL',
    active: true,
  })

  it('matches eligible listing below max price', () => {
    const observation = {
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      productTitle: 'Gigabyte RTX 3060 12GB Gaming OCสภาพดี',
      unitPrice: 5000,
      rawPrice: 5000,
      currency: 'THB',
      condition: 'USED',
      intent: 'SELL',
    }

    const result = evaluateWatchRule(rule, observation)
    expect(result.matched).toBe(true)
    expect(result.effectivePrice).toBe(5000)
  })

  it('rejects listing that contains excluded keyword (3060 Ti)', () => {
    const observation = {
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      productTitle: 'Gigabyte RTX 3060 Ti 8GB Gaming OC',
      unitPrice: 5200,
      rawPrice: 5200,
      currency: 'THB',
      condition: 'USED',
      intent: 'SELL',
    }

    const result = evaluateWatchRule(rule, observation)
    expect(result.matched).toBe(false)
    expect(result.reason).toContain('EXCLUDED_BY_KEYWORD')
  })

  it('rejects listing exceeding max price threshold', () => {
    const observation = {
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      productTitle: 'MSI RTX 3060 Ventus 2X',
      unitPrice: 6500,
      rawPrice: 6500,
      currency: 'THB',
      condition: 'USED',
      intent: 'SELL',
    }

    const result = evaluateWatchRule(rule, observation)
    expect(result.matched).toBe(false)
    expect(result.reason).toContain('PRICE_ABOVE_MAX')
  })

  it('enforces tenant boundary check', () => {
    const observation = {
      tenantId: 'other-tenant',
      businessId: 'biz-1',
      productTitle: 'MSI RTX 3060',
      unitPrice: 4500,
      rawPrice: 4500,
      condition: 'USED',
      intent: 'SELL',
    }

    const result = evaluateWatchRule(rule, observation)
    expect(result.matched).toBe(false)
    expect(result.reason).toBe('TENANT_MISMATCH')
  })
})
