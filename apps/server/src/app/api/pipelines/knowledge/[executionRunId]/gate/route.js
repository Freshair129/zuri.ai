import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveSotDataPlaneViewer } from '@/modules/identity/sot-data-plane-auth'
import { recordKnowledgeStage17Decision } from '@/platform/integrations/core/knowledge-ingestion-executor'

// @req FR-110 — the Stage 17 quality-gate decision is recorded as a
// PipelineGateDecision whose evidence carries the §23 verdict, the snapshot
// and the five dimensions (AC-110.4); its status stays FR-071's vocabulary.
// @spec ADR-067 D1, ADR-067 D2, ADR-050 D3
// @tested tests/integration/fr110-knowledge-reporter-routes.test.js, tests/integration/openapi-docs.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const payload = await request.json()
    if (payload?.executionRunId !== params.executionRunId) {
      throw httpError(400, 'executionRunId does not match route')
    }
    return recordKnowledgeStage17Decision(payload, {
      viewer: (await resolveSotDataPlaneViewer(request)) ?? await resolveRequestViewer(request),
    })
  })
}
