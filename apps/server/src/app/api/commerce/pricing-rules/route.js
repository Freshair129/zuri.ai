import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listPricingRules, createPricingRuleSet } from '@/modules/commerce/application/pricing-rules-service'

// @req FR-253 — OWNER-only scoped rule drafts and internal rule inventory.
// @spec ADR-098; SEC-001
// @tested tests/unit/fr252-pricing-routes.test.js
export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => listPricingRules(queryParams(request), { viewer: await resolveRequestViewer(request) }))
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json().catch(() => ({}))
    return createPricingRuleSet(body, { viewer })
  })
}
