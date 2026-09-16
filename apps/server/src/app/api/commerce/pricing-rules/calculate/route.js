import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { calculatePricing } from '@/modules/commerce/application/pricing-rules-service'

// @req FR-253 — scoped idempotent pricing snapshots with user-entered input provenance.
// @spec ADR-098; SEC-001
// @tested tests/unit/fr252-pricing-routes.test.js
export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return calculatePricing(body, { viewer })
  })
}
