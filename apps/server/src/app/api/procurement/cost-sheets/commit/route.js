import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { commitSupplierCostSheet } from '@/modules/procurement'

// @req FR-164, FR-154 — TASK-ZAI-053 commits only person-confirmed mappings
//   and delegates Product carton writes to Inventory's authority ladder.
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
