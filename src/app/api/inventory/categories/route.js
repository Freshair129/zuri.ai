import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createCategory, listCategories } from '@/modules/inventory/application/inventory-catalog-service'

// @req FR-154 — inventory categories (category_id) of one Business. GET lists
//   them (Business visibility plus the `inventory` domain, FR-061); POST creates
//   one under manager authority (Business OWNER or INVENTORY_MANAGER). Both
//   refuse a Business the caller may not see with the same 404 an unknown one
//   gets (FR-072). `businessId` is a selector the service validates against
//   the trusted viewer, never the scope.
// @spec BR-002; SEC-001; BR-012
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr154-inventory-catalog.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listCategories({ businessId: query?.businessId, viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createCategory(body, { viewer })
  })
}
