import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { commitMarketingPlanHandoff, marketingHandoffInputSchema, previewMarketingPlanHandoff } from '@/modules/marketing/application/marketing-pm-handoff-service'

// @req FR-154 — expose the reviewed Marketing-to-PM preview/commit boundary.
// @spec SDD-086, SEC-001, SEC-003 — the service owns scope, approval, CAS,
// receipt idempotency and one transaction; this route only binds the request.
// @tested tests/integration/marketing-pm-handoff.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    const input = marketingHandoffInputSchema.parse({ ...body, planId: params.id })
    if (input.action === 'preview') return previewMarketingPlanHandoff(input, { viewer })
    return commitMarketingPlanHandoff(input, { viewer })
  })
}
