import { z } from 'zod'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getLivePipelineHealth } from '@/modules/knowledge/pipeline-map/pipeline-health-service'

// @req FR-215 — API route for live pipeline health overlay.
// @spec ADR-085 D5, SEC-001, SEC-008
// @tested tests/unit/pipeline-health-route.test.js

export const dynamic = 'force-dynamic'

const zQuery = z.object({
  businessId: z.string().trim().min(1).max(200),
}).strict()

export async function GET(request) {
  return handle(async () => {
    const { businessId } = zQuery.parse(queryParams(request))
    const viewer = await resolveRequestViewer(request)
    return getLivePipelineHealth({ businessId, viewer })
  })
}
