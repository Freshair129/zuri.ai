import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { admitPricingCatalog } from '@/modules/commerce/application/pricing-catalog-service'

// @req FR-253 — deliberate owner approval of ledger-backed sell-side prices.
// @spec ADR-098; ADR-075; SEC-001
// @tested tests/integration/fr253-pricing-catalog.test.js
export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return admitPricingCatalog(body, { viewer })
  })
}
