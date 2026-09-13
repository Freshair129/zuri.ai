import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyCatalogIntakeAction, getCatalogIntake } from '@/modules/inventory/application/catalog-intake-service'

// @req FR-208 — one catalogue intake. GET reads its plan (and result once
//   committed) for a visible Business; PATCH `{ action: CANCEL, version }`
//   cancels a preview under Inventory write authority with compare-and-swap.
//   A committed intake cannot be cancelled. No DELETE: the row is evidence.
// @spec ADR-084 D2; SEC-001
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr208-inventory-catalog-intake.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getCatalogIntake(params?.id, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyCatalogIntakeAction(params?.id, body, { viewer })
  })
}
