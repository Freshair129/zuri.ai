import { handle, queryParams } from '../../_helpers'
import { resolveKnowledgeRequestViewer as resolveRequestViewer } from '@/modules/knowledge/knowledge-http'
import { draftKnowledgeCandidate, listKnowledgeCandidates } from '@/modules/knowledge/application/knowledge-candidate-service'

// @req FR-236 — draft and list LINE FAQ knowledge candidates.
// @spec ADR-090 D6, ADR-072, SEC-001, SEC-008
// @tested tests/integration/fr236-knowledge-candidate.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const params = queryParams(request)
    const viewer = await resolveRequestViewer(request)
    return listKnowledgeCandidates({ businessId: params.businessId, status: params.status || undefined }, { viewer })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    return draftKnowledgeCandidate(body, { viewer })
  })
}
