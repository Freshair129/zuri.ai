// @req FR-236 — an OWNER turns LINE FAQ knowledge candidate drafting on or off
//   for one Business (ADR-090 D6, TASK-ZAI-099). PATCH only, same shape as
//   /api/businesses/[id]/capabilities (FR-169): the flag is read wherever a
//   Business row already is, so there is no separate GET here.
// @spec ADR-090 D6; BR-001; SEC-003
// @tested tests/integration/fr236-knowledge-candidates-business-toggle.test.js
import { handle } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { setKnowledgeCandidatesEnabled } from '@/modules/business/application/business-knowledge-candidates-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return setKnowledgeCandidatesEnabled(params.id, await request.json(), { viewer })
  })
}
