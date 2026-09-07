import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applySupplierAction, getSupplier } from '@/modules/procurement/application/supplier-service'

// @req FR-164 — one supplier. GET reads it; PATCH applies one versioned
//   action — UPDATE the fields or ARCHIVE — under Business OWNER or
//   PROCUREMENT_BUYER authority with the caller's `version` as the
//   compare-and-swap. No DELETE: an archived supplier keeps its row and its
//   orders. An unknown id and a supplier in a Business the viewer may not
//   see answer identically (FR-072).
// @spec ADR-066; BR-002; SEC-001; BR-012
// @tested tests/unit/procurement-routes.test.js, tests/integration/fr164-procurement.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getSupplier(params?.id, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applySupplierAction(params?.id, body, { viewer })
  })
}
