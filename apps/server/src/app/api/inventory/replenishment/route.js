import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { replenishment } from '@/modules/inventory/application/inventory-hygiene-service'

// @req FR-207 — the replenishment suggestion of one Business: every counted,
//   ACTIVE SKU below its reorder point (or its safety stock when none is
//   declared) with the quantity to order and its lead time. A suggestion the
//   Procurement lane may act on; Inventory never creates a purchase order.
// @spec SEC-001; ADR-083 D6; ADR-066
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr201-inventory-sku-governance.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return replenishment({ businessId: query?.businessId, viewer })
  })
}
