import { normalizePriceObservationDraft } from '../domain/price-observation'
import { evaluateWatchRule, normalizeWatchRuleDraft } from '../domain/watch-rule'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/price-intelligence-service.test.js

export class PriceIntelligenceService {
  constructor({ priceObservationRepo = null, watchRuleRepo = null } = {}) {
    this.priceObservationRepo = priceObservationRepo || new InMemoryPriceObservationRepository()
    this.watchRuleRepo = watchRuleRepo || new InMemoryWatchRuleRepository()
  }

  async recordPriceObservation(draft) {
    const normalized = normalizePriceObservationDraft(draft)
    const saved = await this.priceObservationRepo.save(normalized)
    
    // Evaluate active watch rules for the tenant/business
    const watchRules = await this.watchRuleRepo.findActiveRules({
      tenantId: normalized.tenantId,
      businessId: normalized.businessId,
    })

    const alerts = []
    for (const rule of watchRules) {
      const match = evaluateWatchRule(rule, saved)
      if (match.matched) {
        alerts.push({
          ruleId: rule.id,
          ruleName: rule.name,
          observationId: saved.id || saved.rawRecordId,
          matchedAt: new Date(),
          details: match,
        })
      }
    }

    return {
      observation: saved,
      matchedAlerts: alerts,
    }
  }

  async createWatchRule(draft) {
    const normalized = normalizeWatchRuleDraft(draft)
    return this.watchRuleRepo.save(normalized)
  }

  async listWatchRules({ tenantId, businessId = null }) {
    return this.watchRuleRepo.list({ tenantId, businessId })
  }

  async getPriceHistory({ tenantId, businessId = null, query = null, canonicalProductRef = null }) {
    return this.priceObservationRepo.findHistory({
      tenantId,
      businessId,
      query,
      canonicalProductRef,
    })
  }

  async getPriceSummary({ tenantId, businessId = null, query = null, canonicalProductRef = null }) {
    const history = await this.getPriceHistory({ tenantId, businessId, query, canonicalProductRef })
    if (!history || history.length === 0) {
      return { count: 0, minPrice: null, maxPrice: null, avgPrice: null, latestPrice: null }
    }

    const prices = history.map((item) => item.unitPrice ?? item.rawPrice)
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const sum = prices.reduce((acc, p) => acc + p, 0)
    const avg = Math.round((sum / prices.length) * 100) / 100

    return {
      count: history.length,
      minPrice: min,
      maxPrice: max,
      avgPrice: avg,
      latestPrice: prices[0],
      currency: history[0].currency,
    }
  }
}

class InMemoryPriceObservationRepository {
  constructor() {
    this.observations = []
  }

  async save(record) {
    const id = record.id || `po-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const stored = { ...record, id }
    this.observations.push(stored)
    return stored
  }

  async findHistory({ tenantId, businessId, query, canonicalProductRef }) {
    return this.observations
      .filter((o) => {
        if (o.tenantId !== tenantId) return false
        if (businessId && o.businessId !== businessId) return false
        if (canonicalProductRef && o.canonicalProductRef !== canonicalProductRef) return false
        if (query && !o.productTitle.toLowerCase().includes(query.toLowerCase())) return false
        return true
      })
      .sort((a, b) => new Date(b.observedAt) - new Date(a.observedAt))
  }
}

class InMemoryWatchRuleRepository {
  constructor() {
    this.rules = []
  }

  async save(rule) {
    const id = rule.id || `wr-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const stored = { ...rule, id }
    this.rules.push(stored)
    return stored
  }

  async findActiveRules({ tenantId, businessId }) {
    return this.rules.filter((r) => {
      if (!r.active) return false
      if (r.tenantId !== tenantId) return false
      if (businessId && r.businessId && r.businessId !== businessId) return false
      return true
    })
  }

  async list({ tenantId, businessId }) {
    return this.rules.filter((r) => {
      if (r.tenantId !== tenantId) return false
      if (businessId && r.businessId !== businessId) return false
      return true
    })
  }
}
