import { calculateSupplierScore, normalizeSupplierCandidateDraft } from '../domain/supplier-candidate'

// @req FR-092
// @spec SDD-049, ADR-038
// @tested tests/unit/market-intelligence/supplier-candidate-domain.test.js

export class SupplierIntelligenceService {
  constructor({ supplierRepo = null, priceObservationRepo = null } = {}) {
    this.supplierRepo = supplierRepo || new InMemorySupplierRepository()
    this.priceObservationRepo = priceObservationRepo || null
  }

  async recordSupplierCandidate(draft) {
    const normalized = normalizeSupplierCandidateDraft(draft)
    return this.supplierRepo.save(normalized)
  }

  async listSupplierCandidates({ tenantId, businessId = null, category = null }) {
    const candidates = await this.supplierRepo.list({ tenantId, businessId, category })
    return candidates.map((cand) => ({
      ...cand,
      score: calculateSupplierScore(cand),
    }))
  }

  async getRankedSuppliersForProduct({ tenantId, businessId = null, productQuery }) {
    const candidates = await this.supplierRepo.list({ tenantId, businessId })
    const scored = candidates.map((cand) => ({
      candidate: cand,
      score: calculateSupplierScore(cand),
    }))

    return scored.sort((a, b) => b.score - a.score)
  }
}

class InMemorySupplierRepository {
  constructor() {
    this.suppliers = []
  }

  async save(supplier) {
    const id = supplier.id || `sup-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    const stored = { ...supplier, id }
    this.suppliers.push(stored)
    return stored
  }

  async list({ tenantId, businessId, category }) {
    return this.suppliers.filter((s) => {
      if (s.tenantId !== tenantId) return false
      if (businessId && s.businessId && s.businessId !== businessId) return false
      if (category && !s.categories.includes(category)) return false
      return true
    })
  }
}
