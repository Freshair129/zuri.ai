import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveSotDataPlaneViewer } from '@/modules/identity/sot-data-plane-auth'
import { recordKnowledgeStageReport } from '@/platform/integrations/core/knowledge-ingestion-executor'

// @req FR-110 — GKS and GenesisBlockDB report a Stage 9–16 occurrence as
// control metadata plus aggregate counters; the ledger records it and
// executes none of it (ADR-050 D3).
// @spec ADR-067 D1, ADR-067 D2, ADR-047 D3
// @tested tests/integration/fr110-knowledge-reporter-routes.test.js, tests/integration/openapi-docs.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const payload = await request.json()
    if (payload?.executionRunId !== params.executionRunId) {
      throw httpError(400, 'executionRunId does not match route')
    }
    return recordKnowledgeStageReport(payload, {
      viewer: (await resolveSotDataPlaneViewer(request)) ?? await resolveRequestViewer(request),
    })
  })
}
