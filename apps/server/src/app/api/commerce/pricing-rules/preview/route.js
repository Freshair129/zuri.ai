import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { previewPricingRules } from '@/modules/commerce/application/pricing-rules-service'

// @req FR-253 — OWNER preview and comparison share the authoritative evaluator.
// @spec ADR-098; SEC-001
// @tested tests/unit/fr252-pricing-routes.test.js
export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return previewPricingRules(body, { viewer })
  })
}
