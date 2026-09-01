import { describe, expect, it } from 'vitest'
import {
  calculatePriceChangePercent,
  normalizeCompetitorSignalDraft,
  normalizeDemandSignalDraft,
} from '@/modules/market-intelligence/domain/market-signals'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/market-signals-domain.test.js

describe('MarketSignals domain', () => {
  it('computes competitor price change percentage correctly', () => {
    // 6000 -> 5400 = -10% drop
    expect(calculatePriceChangePercent(6000, 5400)).toBe(-10)

    // 5000 -> 5500 = +10% hike
    expect(calculatePriceChangePercent(5000, 5500)).toBe(10)
  })

  it('normalizes competitor signal draft', () => {
    const draft = {
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      competitorName: 'Competitor X',
      productTitle: 'RTX 3060 12GB',
      signalType: 'PRICE_DROP',
      previousPrice: 6000,
      currentPrice: 5400,
      currency: 'THB',
      detectedAt: new Date(),
    }

    const normalized = normalizeCompetitorSignalDraft(draft)
    expect(normalized.changePercent).toBe(-10)
    expect(normalized.competitorName).toBe('Competitor X')
  })

  it('normalizes demand signal draft', () => {
    const demand = normalizeDemandSignalDraft({
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      category: 'Graphics Cards',
      intentTrend: 'RISING',
      velocityScore: 85,
      observedListingsCount: 142,
      periodStart: new Date('2026-08-01T00:00:00Z'),
      periodEnd: new Date('2026-08-31T00:00:00Z'),
    })

    expect(demand.intentTrend).toBe('RISING')
    expect(demand.velocityScore).toBe(85)
  })
})
