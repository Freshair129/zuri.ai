import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listKittingWorkOrders, openKittingWorkOrder } from '@/modules/inventory/application/kitting-work-order-service'

// @req FR-182, FR-177 — kitting (assembly) work orders. GET lists them, optionally by
//   `?status=` or `?salesOrderId=`; POST opens one, which explodes the recipe
//   with its declared scrap allowance, checks availability against ATP rather
//   than raw on-hand (FR-180) and FREEZES the exploded lines on the order so a
//   later recipe edit cannot change what the run is reconciled against.
// @spec ADR-074 D5; BR-029; BR-032; SEC-001
// @tested tests/unit/scm-console-routes.test.js, tests/integration/fr182-scm-console-actions.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listKittingWorkOrders({
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
    return openKittingWorkOrder(body, { viewer })
  })
}
