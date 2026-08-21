import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { recordPipelineEvent } from '@/platform/integrations/core/pipeline-tracking-service'

// @req FR-071 — trusted workers submit validated stage/record/heartbeat/gate
// evidence with exact idempotency through the server boundary.
// @spec ADR-030 D3-D5, SDD-042, SEC-003, SEC-008
// @tested tests/integration/openapi-docs.test.js, tests/unit/pipeline-tracking-route.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const payload = await request.json()
    if (payload?.executionRunId !== params.executionRunId) {
      throw httpError(400, 'executionRunId does not match route')
    }
    return recordPipelineEvent(payload, {
      viewer: await resolveRequestViewer(request),
    })
  })
}
