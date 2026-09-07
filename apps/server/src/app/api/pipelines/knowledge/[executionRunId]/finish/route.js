import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveSotDataPlaneViewer } from '@/modules/identity/sot-data-plane-auth'
import { finishKnowledgeIngestionRun } from '@/platform/integrations/core/knowledge-ingestion-executor'

// @req FR-110 — a knowledge ingestion run closes only from what Stages 2–17
// reported: the terminal status is derived from the ledger, never declared
// by the caller, and a run still owed evidence is refused with the list.
// @spec ADR-067 D1, ADR-067 D3
// @tested tests/integration/fr110-knowledge-reporter-routes.test.js, tests/integration/openapi-docs.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const payload = await request.json()
    if (payload?.executionRunId !== params.executionRunId) {
      throw httpError(400, 'executionRunId does not match route')
    }
    return finishKnowledgeIngestionRun(payload, {
      viewer: (await resolveSotDataPlaneViewer(request)) ?? await resolveRequestViewer(request),
    })
  })
}
