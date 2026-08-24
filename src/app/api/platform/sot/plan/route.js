import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getSotPlanStatus } from '@/modules/integration/application/sot-plan-service'

// @req FR-095 — one viewer-scoped payload for the board and the FR-097 graph.
// @spec FR-095, FR-097
// @tested tests/unit/sot-plan-service.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => getSotPlanStatus(queryParams(request), {
    viewer: await resolveRequestViewer(request),
  }))
}
