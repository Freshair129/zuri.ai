import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createLocation, listLocations } from '@/modules/inventory/application/warehouse-location-service'

// @req FR-182, FR-174 — warehouse locations of one Business. GET lists them (Business
//   visibility plus the `inventory` domain), optionally narrowed by `?type=`
//   and including archived ones with `?includeArchived=true`; POST creates one
//   under manager authority. A location is never deleted — ledger rows point at
//   it — so there is no DELETE here and never will be. Refusals are the FR-072 404.
// @spec ADR-074 D1; BR-002; BR-026; SEC-001
// @tested tests/unit/scm-console-routes.test.js, tests/integration/fr182-scm-console-actions.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listLocations({
      businessId: query?.businessId,
      type: query?.type || undefined,
      includeArchived: query?.includeArchived === 'true',
      viewer,
    })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createLocation(body, { viewer })
  })
}
