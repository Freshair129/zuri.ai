import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { catalogHygiene } from '@/modules/inventory/application/inventory-hygiene-service'

// @req FR-206 — the read-only catalogue hygiene report of one Business: every
//   lookalike, nature mismatch, undeclared variant axis, dormant SKU, missing
//   identifier and service carrying stock fields, each with the action that
//   repairs it. `dormantDays` tunes the dormancy window (180 by default).
//   Business visibility plus the `inventory` domain; the report writes nothing.
// @spec SEC-001; ADR-083 D6
// @tested tests/unit/inventory-routes.test.js, tests/integration/fr201-inventory-sku-governance.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return catalogHygiene({ businessId: query?.businessId, dormantDays: query?.dormantDays, viewer })
  })
}
