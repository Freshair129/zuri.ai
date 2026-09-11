import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { previewStocktake } from '@/modules/inventory/application/inventory-stocktake-service'

// @req FR-184 — durable preview of a strict NONE/LOT physical count. The
// route only resolves the trusted viewer and delegates Business scope,
// reference joins and persistence to the Inventory service.
// @spec BR-002; BR-008; BR-012; BR-026; SEC-001
// @tested tests/unit/inventory-routes.test.js,
//   tests/integration/fr184-inventory-stocktake.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return previewStocktake(body, { viewer })
  })
}
