import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { updatePricingRuleSet } from '@/modules/commerce/application/pricing-rules-service'

// @req FR-253 — draft-only OWNER writes with optimistic revision checks.
// @spec ADR-098; SEC-001
// @tested tests/unit/fr252-pricing-routes.test.js
export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return updatePricingRuleSet(params?.id, body, { viewer })
  })
}
