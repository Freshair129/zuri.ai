import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listCustomizationWorkOrders, openCustomizationWorkOrder } from '@/modules/inventory/application/customization-work-order-service'

// @req FR-182, FR-176 — customization (branding) work orders. GET lists them, optionally
//   by `?status=` or `?salesOrderId=`; POST opens one — which also creates the
//   branded output SKU when the caller names none, dedicated to that customer
//   and that sales order (BR-028). Opening does not move stock; releasing does.
// @spec ADR-074 D4; BR-028; BR-029; SEC-001
// @tested tests/unit/scm-console-routes.test.js, tests/integration/fr182-scm-console-actions.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listCustomizationWorkOrders({
      businessId: query?.businessId,
      status: query?.status || undefined,
      salesOrderId: query?.salesOrderId || undefined,
      viewer,
    })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return openCustomizationWorkOrder(body, { viewer })
  })
}
