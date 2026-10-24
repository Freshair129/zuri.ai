import { handle } from '../../../../_helpers'
import { resolveKnowledgeRequestViewer as resolveRequestViewer, readRouteParams } from '@/modules/knowledge/knowledge-http'
import { retryKnowledgeIngestion } from '@/modules/knowledge/knowledge-replay-service'

// @req FR-173, FR-071 — Business owners may retry only an eligible immutable
// Knowledge admission through a new full-run child while preserving its source.
// @spec ADR-072, ADR-030 D4-D6, SEC-001, SEC-003, SEC-008
// @tested tests/unit/knowledge-admission-routes.test.js, tests/unit/knowledge-replay-service.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, context) {
  return handle(async () => {
    const { runId } = await readRouteParams(context)
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    return retryKnowledgeIngestion(runId, body, { viewer })
  })
}
