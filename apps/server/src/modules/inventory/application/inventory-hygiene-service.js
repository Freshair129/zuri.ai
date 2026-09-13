import prisma from '@/lib/db'
import { stockOnHand } from '../domain/inventory'
import { DEFAULT_DORMANT_DAYS, hygieneReport, parseVariantAxes, replenishmentRow } from '../domain/inventory-governance'
import { loadBusiness } from './inventory-authority'

// @req FR-206 — the catalogue hygiene report: one read over the catalogue and
//   the ledger of a visible Business, handed to the pure `hygieneReport`, so
//   the findings a page shows are the findings a test computes. This service
//   writes nothing; every repair is a product action a person runs (ADR-083 D6).
// @req FR-207 — the replenishment suggestion: every counted, ACTIVE SKU below
//   its reorder point (or its safety stock when none is declared) with the
//   quantity to order. A suggestion, never a purchase order (ADR-066).
// @spec ADR-083 D6; SEC-001; FR-072
// @tested tests/integration/fr201-inventory-sku-governance.test.js

const PRODUCT_SELECT = {
  id: true, code: true, name: true, color: true, material: true, variantKey: true, productMasterId: true,
  stockPolicy: true, trackingMode: true, unit: true, safetyStock: true, reorderPoint: true, reorderQty: true, leadTimeDays: true,
  status: true, createdAt: true,
}

function clampDormantDays(value) {
  const n = Number.parseInt(value, 10)
  if (!Number.isFinite(n)) return DEFAULT_DORMANT_DAYS
  return Math.min(3650, Math.max(1, n))
}

async function onHandByProduct(db, businessId) {
  const groups = await db.stockMovement.groupBy({ by: ['productId'], where: { businessId }, _sum: { quantity: true } })
  return new Map(groups.map((g) => [g.productId, g._sum.quantity ?? 0]))
}

export async function catalogHygiene({ businessId, dormantDays, viewer, db = prisma, now = new Date() } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const [masters, products, sums] = await Promise.all([
    db.productMaster.findMany({ where: { businessId: business.id }, orderBy: [{ code: 'asc' }], select: { id: true, code: true, nature: true, variantAxesJson: true, status: true } }),
    db.product.findMany({
      where: { businessId: business.id },
      orderBy: [{ code: 'asc' }],
      select: {
        ...PRODUCT_SELECT,
        identifiers: { where: { status: 'ACTIVE' }, select: { id: true } },
        movements: { select: { occurredAt: true }, orderBy: { occurredAt: 'desc' }, take: 1 },
      },
    }),
    onHandByProduct(db, business.id),
  ])
  const rows = products.map(({ identifiers, movements, ...p }) => ({
    ...p,
    onHand: p.stockPolicy === 'TRACKED' ? (sums.get(p.id) ?? 0) : null,
    lastMovementAt: movements[0]?.occurredAt ?? null,
    identifierCount: identifiers.length,
  }))
  const report = hygieneReport({
    masters: masters.map((m) => ({ ...m, variantAxes: parseVariantAxes(m.variantAxesJson) })),
    products: rows,
    now,
    dormantDays: clampDormantDays(dormantDays),
  })
  return {
    businessId: business.id,
    catalogue: { masters: masters.length, products: rows.length, live: rows.filter((r) => r.status !== 'ARCHIVED').length },
    ...report,
  }
}

export async function replenishment({ businessId, viewer, db = prisma } = {}) {
  const business = await loadBusiness(db, viewer, businessId)
  const products = await db.product.findMany({
    where: { businessId: business.id, stockPolicy: 'TRACKED', status: 'ACTIVE' },
    orderBy: [{ code: 'asc' }],
    select: { ...PRODUCT_SELECT, movements: { select: { quantity: true } } },
  })
  const rows = products.map(({ movements, ...p }) => replenishmentRow(p, stockOnHand(movements))).filter(Boolean)
  return { businessId: business.id, rows, counts: { counted: products.length, suggested: rows.length } }
}
