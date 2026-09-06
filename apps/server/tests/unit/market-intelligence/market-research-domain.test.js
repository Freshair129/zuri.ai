import { describe, expect, it } from 'vitest'
import { normalizeMarketResearchRunDraft } from '@/modules/market-intelligence/domain/market-research'
import { MarketResearchService } from '@/modules/market-intelligence/application/market-research-service'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/market-research-domain.test.js

describe('MarketResearch domain & service', () => {
  it('normalizes valid market research run draft', () => {
    const draft = {
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      researchQuestion: 'What is the going price for RTX 3060?',
      productScope: 'RTX 3060',
      findingsSummary: 'Prices cluster between 5,000 and 5,500 THB',
      minObservedPrice: 5000,
      maxObservedPrice: 5500,
      avgObservedPrice: 5250,
      currency: 'THB',
      evidenceCount: 12,
      confidenceScore: 0.95,
      executedAt: new Date(),
    }

    const normalized = normalizeMarketResearchRunDraft(draft)
    expect(normalized.productScope).toBe('RTX 3060')
    expect(normalized.minObservedPrice).toBe(5000)
    expect(normalized.evidenceCount).toBe(12)
  })

  it('runs market research and generates structured findings summary', async () => {
    const mockPriceService = {
      getPriceSummary: async () => ({
        count: 4,
        minPrice: 5000,
        maxPrice: 6000,
        avgPrice: 5350,
        latestPrice: 5200,
        currency: 'THB',
      }),
    }

    const service = new MarketResearchService({ priceService: mockPriceService })
    const run = await service.runMarketResearch({
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      researchQuestion: 'Analyze RTX 3060 market price',
      productQuery: 'RTX 3060',
    })

    expect(run.evidenceCount).toBe(4)
    expect(run.minObservedPrice).toBe(5000)
    expect(run.maxObservedPrice).toBe(6000)
    expect(run.findingsSummary).toContain('Observed 4 data point(s)')
  })
})
