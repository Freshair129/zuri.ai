import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { commitSupplierCostSheet } from '@/modules/procurement'

// @spec ZAI:PROPOSAL-SMARTGIFT-COST-QUOTE-ENGINE-20260913; TASK-ZAI-053 —
//   commit requires the preview hash and explicit confirmed mappings; the
//   service writes the sheet lines and Product carton facts atomically.
// @tested tests/unit/supplier-cost-sheet-routes.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return commitSupplierCostSheet(body, { viewer })
  })
}
