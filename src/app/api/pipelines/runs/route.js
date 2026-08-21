import { z } from 'zod'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { RUN_STATUSES } from '@/platform/integrations/core/pipeline-tracking-contract'
import {
  createPipelineRun,
  listPipelineRuns,
} from '@/platform/integrations/core/pipeline-tracking-service'

// @req FR-071 — create and list server-owned full-pipeline run evidence.
// @spec ADR-030 D3-D6, SDD-042, SEC-003, SEC-008
// @tested tests/integration/openapi-docs.test.js, tests/unit/pipeline-tracking-route.test.js

export const dynamic = 'force-dynamic'

const zListQuery = z.object({
  businessId: z.string().trim().min(1).max(200).optional(),
  status: z.enum(RUN_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
}).strict()

export async function GET(request) {
  return handle(async () => listPipelineRuns({
    ...zListQuery.parse(queryParams(request)),
    viewer: await resolveRequestViewer(request),
  }))
}

export async function POST(request) {
  return handle(async () => createPipelineRun(await request.json(), {
    viewer: await resolveRequestViewer(request),
  }))
}
