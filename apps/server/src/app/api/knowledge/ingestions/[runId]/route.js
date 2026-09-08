import { handle } from '../../../_helpers'
import { resolveKnowledgeRequestViewer, readRouteParams } from '@/modules/knowledge/knowledge-http'
import { readKnowledgeIngestion } from '@/modules/knowledge/knowledge-admission-service'

// @req FR-172 — an opaque admission id returns safe durable status with the
// native executionRunId kept as a separate nullable identity.
// @spec ADR-072, SEC-001, SEC-006, SEC-008
// @tested tests/unit/knowledge-admission-routes.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, context) {
  return handle(async () => {
    const { runId } = await readRouteParams(context)
    const viewer = await resolveKnowledgeRequestViewer(request)
    return readKnowledgeIngestion(runId, { viewer })
  })
}
