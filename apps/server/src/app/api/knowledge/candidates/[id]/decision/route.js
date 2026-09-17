import { handle } from '../../../../_helpers'
import { resolveKnowledgeRequestViewer as resolveRequestViewer, readRouteParams } from '@/modules/knowledge/knowledge-http'
import { decideKnowledgeCandidate } from '@/modules/knowledge/application/knowledge-candidate-service'

// @req FR-236 — the audited APPROVE/REJECT decision. APPROVE admits the
//   candidate through the existing ADR-072 admission service as one
//   immutable LINE_FAQ_CANDIDATE TEXT source; REJECT never calls it.
// @spec ADR-090 D6, ADR-072, SEC-001, SEC-008
// @tested tests/integration/fr236-knowledge-candidate.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, context) {
  return handle(async () => {
    const { id } = await readRouteParams(context)
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    return decideKnowledgeCandidate(id, body, { viewer })
  })
}
