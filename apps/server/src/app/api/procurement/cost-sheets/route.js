import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listSupplierCostSheets } from '@/modules/procurement'

// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053 —
//   bounded Business-scoped list of source-sheet versions; detail lines are
//   returned only by the named sheet route.
// @tested tests/unit/supplier-cost-sheet-routes.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listSupplierCostSheets({ businessId: query?.businessId, supplierId: query?.supplierId, status: query?.status, limit: query?.limit, viewer })
  })
}
