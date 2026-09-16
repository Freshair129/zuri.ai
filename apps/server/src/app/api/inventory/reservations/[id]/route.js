import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyReservationAction } from '@/modules/inventory/application/inventory-atp-service'

// @req FR-182, FR-180 — one reservation. PATCH applies RELEASE or CONVERT, versioned —
//   CONVERT ends the quote hold as CONVERTED and creates the committed one in
//   the same transaction, so the stock is never briefly free between the two.
//   There is no DELETE and no GET of a single row: a reservation is never
//   deleted (it ends RELEASED, CONVERTED or EXPIRED, BR-031) and the list route
//   already reads it with the `live` flag a single-row read would have to
//   compute identically.
// @spec ADR-074 D8; BR-031; SEC-001; FR-072
// @tested tests/unit/scm-console-routes.test.js, tests/integration/fr182-scm-console-actions.test.js

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyReservationAction(params?.id, body, { viewer })
  })
}
