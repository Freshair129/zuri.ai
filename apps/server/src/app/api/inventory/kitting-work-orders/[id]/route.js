import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyKittingWorkOrderAction, getKittingWorkOrder } from '@/modules/inventory/application/kitting-work-order-service'

// @req FR-182, FR-177 — one kitting work order. GET reads it with its frozen bill of
//   materials; PATCH applies RELEASE, COMPLETE or CANCEL from the same declared
//   vocabulary the customization route uses, versioned the same way. COMPLETE
//   consumes what the attempts used, receives the assembled sets at their
//   blended landed cost (FR-175) and returns the unused buffer. No DELETE.
// @spec ADR-074 D5; BR-027; BR-029; SEC-001; FR-072
// @tested tests/unit/scm-console-routes.test.js, tests/integration/fr182-scm-console-actions.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getKittingWorkOrder(params?.id, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyKittingWorkOrderAction(params?.id, body, { viewer })
  })
}
