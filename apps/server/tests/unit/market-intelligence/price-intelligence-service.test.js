import { describe, expect, it } from 'vitest'
import { PriceIntelligenceService } from '@/modules/market-intelligence/application/price-intelligence-service'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/price-intelligence-service.test.js

describe('PriceIntelligenceService', () => {
  it('records price observations and triggers matching watch rule alerts', async () => {
    const service = new PriceIntelligenceService()

    // 1. Setup Watch Rule: RTX 3060 <= 5,500 THB, USED, SELL, exclude 3060 Ti
    await service.createWatchRule({
      id: 'rule-1',
      tenantId: 'tenant-001',
      businessId: 'biz-001',
      name: 'GPU Deal Watch',
      query: 'RTX 3060',
      excludeKeywords: ['3060 Ti'],
      maxPrice: 5500,
      condition: 'USED',
      intent: 'SELL',
      active: true,
    })

    // 2. Ingest first observation that matches
    const res1 = await service.recordPriceObservation({
      tenantId: 'tenant-001',
      businessId: 'biz-001',
      rawRecordId: 'raw-rec-001',
      sourceProvider: 'fb_group',
      productTitle: 'Zotac RTX 3060 Twin Edge 12GB มือสอง',
      rawPrice: 5000,
      currency: 'THB',
      bundleQuantity: 1,
      condition: 'USED',
      intent: 'SELL',
      observedAt: new Date('2026-08-31T12:00:00Z'),
    })

    expect(res1.matchedAlerts).toHaveLength(1)
    expect(res1.matchedAlerts[0].ruleId).toBe('rule-1')
    expect(res1.matchedAlerts[0].details.effectivePrice).toBe(5000)

    // 3. Ingest observation that exceeds price threshold (6,000 THB)
    const res2 = await service.recordPriceObservation({
      tenantId: 'tenant-001',
      businessId: 'biz-001',
      rawRecordId: 'raw-rec-002',
      sourceProvider: 'fb_group',
      productTitle: 'Colorful RTX 3060 12GB มือสอง',
      rawPrice: 6000,
      currency: 'THB',
      condition: 'USED',
      intent: 'SELL',
      observedAt: new Date('2026-08-31T12:10:00Z'),
    })

    expect(res2.matchedAlerts).toHaveLength(0)

    // 4. Ingest observation that matches title query but is excluded by '3060 Ti'
    const res3 = await service.recordPriceObservation({
      tenantId: 'tenant-001',
      businessId: 'biz-001',
      rawRecordId: 'raw-rec-003',
      sourceProvider: 'fb_group',
      productTitle: 'Palit RTX 3060 Ti Dual 8GB มือสอง',
      rawPrice: 5200,
      currency: 'THB',
      condition: 'USED',
      intent: 'SELL',
      observedAt: new Date('2026-08-31T12:20:00Z'),
    })

    expect(res3.matchedAlerts).toHaveLength(0)

    // 5. Query historical price timeline and summary
    const summary = await service.getPriceSummary({
      tenantId: 'tenant-001',
      businessId: 'biz-001',
      query: 'RTX 3060',
    })

    expect(summary.count).toBe(3)
    expect(summary.minPrice).toBe(5000)
    expect(summary.maxPrice).toBe(6000)
    expect(summary.latestPrice).toBe(5200) // latest observed
  })
})
