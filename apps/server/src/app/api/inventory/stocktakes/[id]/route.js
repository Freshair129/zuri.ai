import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getStocktake } from '@/modules/inventory/application/inventory-stocktake-service'

// @req FR-184 — reload one durable preview/commit result in the authorized
// Business scope. This is the read path for browser refresh and recovery.
// @spec BR-002; BR-012; SEC-001
// @tested tests/unit/inventory-routes.test.js,
//   tests/integration/fr184-inventory-stocktake.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return getStocktake(params.id, { businessId: query?.businessId, viewer })
  })
}
