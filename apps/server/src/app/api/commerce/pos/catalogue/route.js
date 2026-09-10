import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getPosTerminalCatalogue } from '@/modules/commerce/application/pos-cashier-service'

// @req FR-183 — returns active product identity, recomputed on-hand and active
// Branch/WarehouseLocation choices. Sale prices are always entered by the
// cashier; the catalogue never derives a price from Inventory cost.
// @spec ADR-065; BR-001; SEC-001
// @tested tests/e2e/fr186-billing-pos.spec.js, tests/integration/fr183-pos.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const query = queryParams(request)
    return getPosTerminalCatalogue(query?.businessId, { viewer })
  })
}
