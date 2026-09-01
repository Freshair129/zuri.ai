import { normalizeMarketResearchRunDraft } from '../domain/market-research'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/market-research-domain.test.js

export class MarketResearchService {
  constructor({ priceService = null, researchRepo = null } = {}) {
    this.priceService = priceService
    this.researchRepo = researchRepo || new InMemoryMarketResearchRepository()
  }

  async runMarketResearch({
    tenantId,
    businessId = null,
    researchQuestion,
    productQuery,
    categoryScope = null,
  }) {
    let summary = { count: 0, minPrice: null, maxPrice: null, avgPrice: null, latestPrice: null, currency: 'THB' }
    if (this.priceService) {
      summary = await this.priceService.getPriceSummary({
        tenantId,
        businessId,
        query: productQuery,
      })
    }

    const findingsSummary =
      summary.count > 0
        ? `Observed ${summary.count} data point(s) for "${productQuery}". Price ranges between ${summary.minPrice} - ${summary.maxPrice} ${summary.currency} (avg: ${summary.avgPrice}).`
        : `No external market observations found for "${productQuery}".`

    const draft = normalizeMarketResearchRunDraft({
      tenantId,
      businessId,
      researchQuestion,
      productScope: productQuery,
      categoryScope,
      findingsSummary,
      minObservedPrice: summary.minPrice,
      maxObservedPrice: summary.maxPrice,
      avgObservedPrice: summary.avgPrice,
      currency: summary.currency || 'THB',
      evidenceCount: summary.count,
      confidenceScore: summary.count > 5 ? 0.95 : summary.count > 0 ? 0.8 : 0.4,
      executedAt: new Date(),
    })

    return this.researchRepo.save(draft)
  }

  async listResearchRuns({ tenantId, businessId = null }) {
    return this.researchRepo.list({ tenantId, businessId })
  }
}

class InMemoryMarketResearchRepository {
  constructor() {
    this.runs = []
  }

  async save(record) {
    const id = record.id || `res-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const stored = { ...record, id }
    this.runs.push(stored)
    return stored
  }

  async list({ tenantId, businessId }) {
    return this.runs.filter((r) => {
      if (r.tenantId !== tenantId) return false
      if (businessId && r.businessId !== businessId) return false
      return true
    })
  }
}
