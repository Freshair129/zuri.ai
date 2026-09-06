import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createBundle, listBundles } from '@/modules/inventory/application/inventory-catalog-service'

// @req FR-154 — bundles (bundle_id) of one Business: a named pack of SKUs
//   with quantities. GET lists them with `availableSets`, the number of
//   complete sets the ledger currently allows (Business visibility plus the
//   `inventory` domain); POST creates one under manager authority, refusing
//   an item whose product is not in the Business. Refusals are the FR-072 404.
// @spec BR-002; SEC-001; BR-012
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr154-inventory-catalog.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listBundles({ businessId: query?.businessId, viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createBundle(body, { viewer })
  })
}
