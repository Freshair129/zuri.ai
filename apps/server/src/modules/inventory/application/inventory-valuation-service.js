import prisma from '@/lib/db'
import { movingAverageValuation } from '../domain/inventory-costing'

// @req FR-175 — one Business-wide, per-product reader for every valuation
//   consumer. All callers use the same movement projection so replayed cost
//   evidence cannot drift by lane.
// @spec ADR-074 D2, D3; BR-027
// @tested tests/integration/fr154-inventory-catalog.test.js,
//   tests/integration/fr253-pricing-catalog.test.js

export const INVENTORY_VALUATION_MOVEMENT_SELECT = Object.freeze({
  id: true,
  kind: true,
  quantity: true,
  costSatang: true,
  occurredAt: true,
  createdAt: true,
  reference: true,
  reason: true,
  sourceLocationId: true,
  targetLocationId: true,
  workOrderId: true,
})

/** Read and replay every movement for one product on this db or transaction client. */
export async function readInventoryValuation(productId, { db = prisma, businessId, tenantId } = {}) {
  const id = typeof productId === 'string' ? productId.trim() : ''
  if (!id) return movingAverageValuation([])
  const rows = await db.stockMovement.findMany({
    where: {
      productId: id,
      ...(businessId ? { businessId } : {}),
      ...(tenantId ? { tenantId } : {}),
    },
    select: INVENTORY_VALUATION_MOVEMENT_SELECT,
    orderBy: { id: 'asc' },
  })
  return movingAverageValuation(rows)
}
