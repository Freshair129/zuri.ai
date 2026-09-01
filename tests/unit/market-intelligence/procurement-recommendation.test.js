import { describe, expect, it } from 'vitest'
import { ProcurementRecommendationService } from '@/modules/market-intelligence/application/procurement-recommendation-service'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/procurement-recommendation.test.js

describe('ProcurementRecommendationService', () => {
  const mockPriceService = {
    getPriceSummary: async () => ({
      count: 5,
      minPrice: 5000,
      maxPrice: 5500,
      avgPrice: 5200,
      currency: 'THB',
    }),
  }

  const mockSupplierService = {
    getRankedSuppliersForProduct: async () => [
      {
        candidate: { name: 'Supplier Verified Tech', verified: true },
        score: 92,
      },
    ],
  }

  it('recommends BUY_NOW when stock is low and market price is favorable', async () => {
    const service = new ProcurementRecommendationService({
      priceService: mockPriceService,
      supplierService: mockSupplierService,
    })

    const recommendation = await service.evaluateProcurementRecommendation({
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      sku: 'GPU-3060',
      productName: 'RTX 3060',
      currentStock: 2,
      reorderThreshold: 5,
      targetUnitCost: 5500, // market avg is 5200 <= 5500
    })

    expect(recommendation.recommendationType).toBe('BUY_NOW')
    expect(recommendation.marketEvidence.avgMarketPrice).toBe(5200)
    expect(recommendation.marketEvidence.suggestedSuppliers[0].name).toBe('Supplier Verified Tech')
  })

  it('recommends HOLD when stock is above reorder threshold', async () => {
    const service = new ProcurementRecommendationService({
      priceService: mockPriceService,
      supplierService: mockSupplierService,
    })

    const recommendation = await service.evaluateProcurementRecommendation({
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      sku: 'GPU-3060',
      productName: 'RTX 3060',
      currentStock: 10,
      reorderThreshold: 5,
      targetUnitCost: 5500,
    })

    expect(recommendation.recommendationType).toBe('HOLD')
  })
})
