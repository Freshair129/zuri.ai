import { z } from 'zod'
import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { RUN_STATUSES } from '@/platform/integrations/core/pipeline-tracking-contract'
import {
  createPipelineRun,
  listPipelineRuns,
} from '@/platform/integrations/core/pipeline-tracking-service'

// @req FR-071 — create and list server-owned full-pipeline run evidence.
// @req FR-109 — the same surface registers a DPL-KNOWLEDGE-INGEST-V1 run; the
// envelope decides which definitions are acceptable, not this handler (SDD-066).
// @spec ADR-030 D3-D6, SDD-042, SDD-066, SEC-003, SEC-008, ADR-050
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
