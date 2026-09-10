import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { checkoutPosSale } from '@/modules/commerce/application/pos-cashier-service'

// @req FR-183 — atomically creates a WALK_IN SalesOrder, records a PENDING
// Payment and issues tracked stock through Inventory. A separate FR-163
// verifier is required before money is counted as verified revenue.
// @spec ADR-065; BR-001; BR-002; SEC-001
// @tested tests/e2e/fr186-billing-pos.spec.js, tests/integration/fr183-pos.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return checkoutPosSale(body?.businessId, body, { viewer })
  })
}
