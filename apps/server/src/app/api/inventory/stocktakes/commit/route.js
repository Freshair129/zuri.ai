import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { commitStocktake } from '@/modules/inventory/application/inventory-stocktake-service'

// @req FR-184 — one atomic, idempotent stocktake commit. The route has no
// movement or authority logic of its own; the service derives signed
// adjustments and calls the FR-155 ledger writer.
// @spec BR-002; BR-008; BR-012; BR-026; SEC-001
// @tested tests/unit/inventory-routes.test.js,
//   tests/integration/fr184-inventory-stocktake.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return commitStocktake(body, { viewer })
  })
}
