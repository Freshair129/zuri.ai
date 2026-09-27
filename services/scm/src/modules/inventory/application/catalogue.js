import * as repo from '../adapters/inventory-repo.js'

// Inventory's read port for the POS terminal catalogue (FR-183): identity and
// recomputed on-hand only — Inventory holds no sale price. The caller (Commerce)
// has already checked that the viewer sees the inventory domain.
export function catalogueFacts(sql, businessId) {
  return {
    products: repo.activeProductsWithMaster(sql, businessId).map((p) => ({ ...p })),
    onHand: repo.onHandByProduct(sql, businessId),
    categories: repo.activeCategories(sql, businessId).map((c) => ({ ...c })),
    // Legacy returns isVirtual as a boolean; the store keeps it as 0/1 on both engines.
    locations: repo.sellingLocations(sql, businessId).map((l) => ({ ...l, isVirtual: Boolean(l.isVirtual) })),
  }
}
