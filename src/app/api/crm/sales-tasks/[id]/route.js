import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applySalesTaskAction, getSalesTask } from '@/modules/crm/sales-task-service'

// @req FR-157 — one sales task. GET reads it with its due state recomputed
//   against today; PATCH applies one versioned action — UPDATE, ASSIGN,
//   START, COMPLETE (with an outcome), CANCEL (with a reason) or REOPEN —
//   under Business OWNER or SALES_REP authority with the caller's `version`
//   as the compare-and-swap. No DELETE: a cancelled task keeps its row. An
//   unknown id and a task in a Business the viewer may not see answer
//   identically (FR-072).
// @spec ADR-064; BR-001; SEC-001; BR-012
// @tested tests/unit/sales-task-routes.test.js, tests/integration/fr157-sales-task.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getSalesTask(params?.id, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applySalesTaskAction(params?.id, body, { viewer })
  })
}
