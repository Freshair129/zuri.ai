import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { decideSotDecision } from '@/modules/integration/application/sot-decision-service'

// @req FR-100 — a human decision is audited, immutable and owner-gated.
// @spec FR-100
// @tested tests/unit/sot-decision-service.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => decideSotDecision(params.decisionId, await request.json(), {
    viewer: await resolveRequestViewer(request),
  }))
}
