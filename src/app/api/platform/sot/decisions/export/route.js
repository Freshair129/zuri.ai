import { handle, queryParams } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { exportSotDecisions } from '@/modules/integration/application/sot-decision-service'

// @req FR-100 — the pull half of the loop: decided rows in stable cursor
// order for the data plane to apply to its own stores (ADR-043 interim).
// @spec FR-100
// @tested tests/unit/sot-decision-service.test.js

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => exportSotDecisions(queryParams(request), {
    viewer: await resolveRequestViewer(request),
  }))
}
