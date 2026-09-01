import { describe, expect, it } from 'vitest'
import {
  calculateSupplierScore,
  normalizeSupplierCandidateDraft,
} from '@/modules/market-intelligence/domain/supplier-candidate'
import { SupplierIntelligenceService } from '@/modules/market-intelligence/application/supplier-intelligence-service'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/supplier-candidate-domain.test.js

describe('SupplierCandidate domain', () => {
  it('normalizes valid supplier candidate draft', () => {
    const draft = {
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      name: 'Lotus Wholesale Supplies',
      sourceProvider: 'retail_lotus',
      rating: 4.8,
      reviewCount: 150,
      categories: ['Groceries', 'Beverages'],
      verified: true,
      observedAt: new Date('2026-08-31T10:00:00Z'),
    }

    const normalized = normalizeSupplierCandidateDraft(draft)
    expect(normalized.name).toBe('Lotus Wholesale Supplies')
    expect(normalized.verified).toBe(true)
    expect(normalized.rating).toBe(4.8)
  })

  it('calculates evidence-backed supplier score accurately', () => {
    const candidateHigh = {
      rating: 4.9,
      reviewCount: 200,
      verified: true,
    }
    const scoreHigh = calculateSupplierScore(candidateHigh)
    expect(scoreHigh).toBeGreaterThan(80)

    const candidateLow = {
      rating: 2.0,
      reviewCount: 2,
      verified: false,
    }
    const scoreLow = calculateSupplierScore(candidateLow)
    expect(scoreLow).toBeLessThan(70)
  })
})

describe('SupplierIntelligenceService', () => {
  it('records and ranks suppliers by score', async () => {
    const service = new SupplierIntelligenceService()

    await service.recordSupplierCandidate({
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      name: 'Top Supplier A',
      sourceProvider: 'shopee',
      rating: 4.9,
      reviewCount: 500,
      categories: ['Electronics'],
      verified: true,
      observedAt: new Date(),
    })

    await service.recordSupplierCandidate({
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      name: 'Unverified Seller B',
      sourceProvider: 'facebook',
      rating: 3.2,
      reviewCount: 5,
      categories: ['Electronics'],
      verified: false,
      observedAt: new Date(),
    })

    const ranked = await service.getRankedSuppliersForProduct({
      tenantId: 'tenant-1',
      businessId: 'biz-1',
      productQuery: 'GPU',
    })

    expect(ranked).toHaveLength(2)
    expect(ranked[0].candidate.name).toBe('Top Supplier A')
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score)
  })
})
