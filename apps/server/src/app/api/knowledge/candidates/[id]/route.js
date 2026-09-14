import { handle } from '../../../_helpers'
import { resolveKnowledgeRequestViewer as resolveRequestViewer, readRouteParams } from '@/modules/knowledge/knowledge-http'
import { getKnowledgeCandidate, updateKnowledgeCandidate } from '@/modules/knowledge/application/knowledge-candidate-service'

// @req FR-236 — read and edit one LINE FAQ knowledge candidate while it is
//   still PENDING_REVIEW.
// @spec ADR-090 D6, SEC-001, SEC-008
// @tested tests/integration/fr236-knowledge-candidate.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, context) {
  return handle(async () => {
    const { id } = await readRouteParams(context)
    const viewer = await resolveRequestViewer(request)
    return getKnowledgeCandidate(id, { viewer })
  })
}

export async function PATCH(request, context) {
  return handle(async () => {
    const { id } = await readRouteParams(context)
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    return updateKnowledgeCandidate(id, body, { viewer })
  })
}
