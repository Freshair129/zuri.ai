import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getPipelineMonitor } from '@/platform/integrations/core/pipeline-tracking-service'

// @req FR-071 — the run monitor is server-filtered by Tenant/Business scope.
// @spec ADR-030 D3-D6, SDD-042, SEC-003, SEC-008
// @tested tests/integration/openapi-docs.test.js, tests/unit/pipeline-tracking-route.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => getPipelineMonitor(params.executionRunId, {
    viewer: await resolveRequestViewer(request),
  }))
}
