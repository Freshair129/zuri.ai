import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyLocationAction, getLocation } from '@/modules/inventory/application/warehouse-location-service'

// @req FR-182, FR-174 — one warehouse location. GET reads it; PATCH applies one
//   versioned action — UPDATE the descriptive fields, or ARCHIVE — under
//   manager authority with the caller's `version` as the compare-and-swap.
//   Archiving a location that still holds stock is refused by the service
//   (`WAREHOUSE_LOCATION_NOT_EMPTY`), because that stock would become
//   unreachable by transfer while still counting toward on-hand. An unknown id
//   and a location in a Business the viewer may not see answer identically.
// @spec ADR-074 D1; BR-002; SEC-001; FR-072
// @tested tests/unit/scm-console-routes.test.js, tests/integration/fr182-scm-console-actions.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return getLocation(params?.id, { viewer })
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyLocationAction(params?.id, body, { viewer })
  })
}
