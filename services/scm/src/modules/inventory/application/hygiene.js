import { DEFAULT_DORMANT_DAYS, hygieneReport, parseVariantAxes, replenishmentRow } from '../../../kernel/inventory/inventory-governance.js'
import { inventoryAuthority } from '../../../infrastructure/delegation.js'
import * as reports from '../adapters/report-repo.js'

// Catalogue hygiene (FR-206) and replenishment (FR-207) inside SCM — port of
// apps/server inventory-hygiene-service. Both are reads: one snapshot of the
// catalogue and the ledger handed to the pure kernel rules, so the findings a
// page shows are the findings a test computes. Every repair is a product action a
// person runs (ADR-083 D6); a replenishment row is a suggestion, never a purchase
// order (ADR-066).

const reader = (scope, businessId) => inventoryAuthority.require(scope, typeof businessId === 'string' ? businessId.trim() : '')

function clampDormantDays(value) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return DEFAULT_DORMANT_DAYS
  return Math.min(3650, Math.max(1, n))
}

export function catalogHygiene(sql, scope, { businessId, dormantDays, now }) {
  const business = reader(scope, businessId)
  const masters = reports.mastersOf(sql, business.id)
  const products = reports.hygieneProducts(sql, business.id).map((p) => ({ ...p, onHand: p.stockPolicy === 'TRACKED' ? p.onHand : null }))
  const report = hygieneReport({
    masters: masters.map((m) => ({ ...m, variantAxes: parseVariantAxes(m.variantAxesJson) })),
    products,
    now: new Date(now),
    dormantDays: clampDormantDays(dormantDays),
  })
  return {
    businessId: business.id,
    catalogue: { masters: masters.length, products: products.length, live: products.filter((r) => r.status !== 'ARCHIVED').length },
    ...report,
  }
}

export function replenishment(sql, scope, { businessId }) {
  const business = reader(scope, businessId)
  const products = reports.replenishmentProducts(sql, business.id)
  const rows = products.map(({ onHand, ...p }) => replenishmentRow(p, onHand)).filter(Boolean)
  return { businessId: business.id, rows, counts: { counted: products.length, suggested: rows.length } }
}
