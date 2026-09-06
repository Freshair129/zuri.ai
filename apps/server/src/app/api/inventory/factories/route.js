import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createFactory, listFactories } from '@/modules/inventory/application/inventory-catalog-service'

// @req FR-154 — factories (factory_id) of one Business: the manufacturers a
//   product master or a lot came from. GET lists (Business visibility plus the
//   `inventory` domain); POST creates under manager authority. Refusals are
//   the FR-072 404.
// @spec BR-002; SEC-001; BR-012
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr154-inventory-catalog.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listFactories({ businessId: query?.businessId, viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createFactory(body, { viewer })
  })
}
