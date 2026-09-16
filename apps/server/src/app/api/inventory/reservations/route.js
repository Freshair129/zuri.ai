import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createReservation, listReservations } from '@/modules/inventory/application/inventory-atp-service'

// @req FR-182, FR-180 — stock reservations. GET lists them, optionally by `?productId=`
//   or `?status=`, each row carrying a computed `live` — a hold whose clock ran
//   out is already spent even though its stored status is still ACTIVE. POST
//   places one: a soft QUOTE hold (7 days by default) or a committed ORDER
//   hold, refused when the quantity exceeds what is still available, which is
//   the whole point (BR-031). A reservation never writes the stock ledger.
// @spec ADR-074 D8; BR-031; SEC-001
// @tested tests/unit/scm-console-routes.test.js, tests/integration/fr182-scm-console-actions.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listReservations({
      businessId: query?.businessId,
      productId: query?.productId || undefined,
      status: query?.status || undefined,
      viewer,
    })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createReservation(body, { viewer })
  })
}
