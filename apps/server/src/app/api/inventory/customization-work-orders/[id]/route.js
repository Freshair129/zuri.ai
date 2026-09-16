import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyCustomizationWorkOrderAction, getCustomizationWorkOrder } from '@/modules/inventory/application/customization-work-order-service'

// @req FR-182, FR-176 — one customization work order. GET reads it with its gross issue
//   and reconciliation; PATCH applies one versioned action from the declared
//   vocabulary — RELEASE (stage the gross quantity at the workshop), COMPLETE
//   (consume, scrap, produce the branded SKU, return the unused buffer) or
//   CANCEL — with the caller's `version` as the compare-and-swap. The verbs are
//   validated by `zWorkOrderAction` in the domain, so this handler dispatches
//   rather than branches, and COMPLETE is the only one that carries counts.
//   No DELETE: a work order that issued stock is history.
// @spec ADR-074 D4; BR-028; BR-029; SEC-001; FR-072
// @tested tests/unit/scm-console-routes.test.js, tests/integration/fr182-scm-console-actions.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getCustomizationWorkOrder(params?.id, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyCustomizationWorkOrderAction(params?.id, body, { viewer })
  })
}
