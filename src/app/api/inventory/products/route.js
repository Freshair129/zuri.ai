import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createProduct, listProducts } from '@/modules/inventory/application/inventory-catalog-service'

// @req FR-154 — products / SKUs (product_id) of one Business. GET lists them,
//   optionally by `productMasterId`, archived rows on request only (Business
//   visibility plus the `inventory` domain); POST creates one under manager
//   authority with its `stockPolicy` (TRACKED / UNTRACKED) and `trackingMode`
//   fixed from then on. Refusals are the FR-072 404.
// @spec BR-002; SEC-001; BR-012
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr154-inventory-catalog.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listProducts({ businessId: query?.businessId, productMasterId: query?.productMasterId || undefined, includeArchived: query?.includeArchived === 'true', viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createProduct(body, { viewer })
  })
}
