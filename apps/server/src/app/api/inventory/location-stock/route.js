import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { locationStock } from '@/modules/inventory/application/warehouse-location-service'

// @req FR-182, FR-174 — on-hand per location, recomputed from the located ledger —
//   for one SKU with `?productId=`, otherwise one entry per product that has
//   any located movement. The response always carries `unlocated` beside
//   `total`: every movement written before ADR-074 names no location, and
//   folding that remainder into a location would invent a fact (BR-026).
// @spec ADR-074 D1; BR-026; SEC-001
// @tested tests/unit/scm-console-routes.test.js, tests/integration/fr182-scm-console-actions.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return locationStock({ businessId: query?.businessId, productId: query?.productId || undefined, viewer })
  })
}
