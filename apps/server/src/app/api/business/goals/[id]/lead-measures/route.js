// @req FR-270 — OWNER-scoped Business lead-measure creation.
// @spec ADR-101 D1, BR-001, SEC-003
// @tested tests/integration/fr270-business-wig-execution.test.js
import { handle } from '../../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createBusinessLeadMeasure } from '@/modules/project-manager/application/business-wig-execution-service'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createBusinessLeadMeasure(params.id, await request.json(), { viewer })
  })
}
