import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listCatalogIntakes } from '@/modules/inventory/application/catalog-intake-service'

// @req FR-208 — the Business's recent catalogue intakes, newest first, as
//   summaries (status, counts, channel, expiry) without their plans. Business
//   visibility plus the `inventory` domain; refusals are the FR-072 404.
// @spec ADR-084 D2; SEC-001
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr208-inventory-catalog-intake.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return listCatalogIntakes({ businessId: query?.businessId, limit: query?.limit, viewer })
  })
}
