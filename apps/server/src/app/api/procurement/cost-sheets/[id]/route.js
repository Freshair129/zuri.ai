import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getSupplierCostSheet } from '@/modules/procurement'

// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053 —
//   a named sheet detail is visible only inside its Business.
// @tested tests/unit/supplier-cost-sheet-routes.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getSupplierCostSheet(params?.id, { viewer })
  })
}
