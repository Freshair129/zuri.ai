import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { applyPricingRuleAction } from '@/modules/commerce/application/pricing-rules-service'

// @req FR-253 — OWNER approval and revocation with immutable rule content.
// @spec ADR-098; SEC-001
// @tested tests/unit/fr252-pricing-routes.test.js
export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return applyPricingRuleAction(params?.id, body, { viewer })
  })
}
