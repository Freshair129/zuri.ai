import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveSotDataPlaneViewer } from '@/modules/identity/sot-data-plane-auth'
import { readKnowledgeIngestionJob } from '@/platform/integrations/core/knowledge-ingestion-executor'

// @req FR-109 — one pipeline_job_id resolves the run, its seventeen step
// identities and its §5 job state (AC-109.11).
// @req FR-110 — the read a Stage 9–17 reporter needs before it can name a step.
// @spec ADR-067 D1, ADR-067 D4, ADR-050 D3
// @tested tests/integration/fr110-knowledge-reporter-routes.test.js, tests/integration/openapi-docs.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => readKnowledgeIngestionJob(params.executionRunId, {
    viewer: (await resolveSotDataPlaneViewer(request)) ?? await resolveRequestViewer(request),
  }))
}
