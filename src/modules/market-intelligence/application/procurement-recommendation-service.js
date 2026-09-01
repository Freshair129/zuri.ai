// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/procurement-recommendation.test.js

/**
 * Service that combines Commerce inventory status with Market Intelligence signals
 * to generate evidence-backed procurement recommendations.
 */
export class ProcurementRecommendationService {
  constructor({ priceService = null, supplierService = null } = {}) {
    this.priceService = priceService
    this.supplierService = supplierService
  }

  /**
   * Evaluate whether to purchase or replenish based on inventory level and market price trend.
   */
  async evaluateProcurementRecommendation({
    tenantId,
    businessId,
    sku,
    productName,
    currentStock,
    reorderThreshold,
    targetUnitCost,
  }) {
    if (currentStock == null || reorderThreshold == null) {
      throw new Error('currentStock and reorderThreshold are required')
    }

    const needsReorder = currentStock <= reorderThreshold

    let marketPriceSummary = null
    if (this.priceService) {
      marketPriceSummary = await this.priceService.getPriceSummary({
        tenantId,
        businessId,
        query: productName,
      })
    }

    let topSuppliers = []
    if (this.supplierService) {
      topSuppliers = await this.supplierService.getRankedSuppliersForProduct({
        tenantId,
        businessId,
        productQuery: productName,
      })
    }

    const avgMarketPrice = marketPriceSummary?.avgPrice ?? null
    const priceFavorable = targetUnitCost && avgMarketPrice ? avgMarketPrice <= targetUnitCost : true

    let recommendationType = 'HOLD'
    let reason = 'Stock is above reorder threshold.'

    if (needsReorder) {
      if (priceFavorable) {
        recommendationType = 'BUY_NOW'
        reason = `Stock (${currentStock}) is at/below reorder threshold (${reorderThreshold}) and market price (${avgMarketPrice ?? 'N/A'}) is favorable.`
      } else {
        recommendationType = 'BUY_MINIMUM'
        reason = `Stock (${currentStock}) is low, but market price (${avgMarketPrice}) exceeds target cost (${targetUnitCost}). Recommend minimum replenishment.`
      }
    }

    return {
      sku,
      productName,
      currentStock,
      reorderThreshold,
      recommendationType,
      reason,
      marketEvidence: {
        avgMarketPrice,
        currency: marketPriceSummary?.currency || 'THB',
        observationCount: marketPriceSummary?.count || 0,
        suggestedSuppliers: topSuppliers.slice(0, 3).map((s) => ({
          name: s.candidate.name,
          score: s.score,
          verified: s.candidate.verified,
        })),
      },
      evaluatedAt: new Date(),
    }
  }
}
