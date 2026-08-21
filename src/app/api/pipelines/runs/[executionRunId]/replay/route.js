import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { requestPipelineReplay } from '@/platform/integrations/core/pipeline-tracking-service'

// @req FR-071 — authorized replay creates immutable queued lineage and never
// claims that the Codex worker or Supabase apply already executed.
// @spec ADR-030 D4-D6, SDD-042, SEC-003, SEC-008
// @tested tests/integration/openapi-docs.test.js, tests/unit/pipeline-tracking-route.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => requestPipelineReplay(params.executionRunId, await request.json(), {
    viewer: await resolveRequestViewer(request),
  }))
}
