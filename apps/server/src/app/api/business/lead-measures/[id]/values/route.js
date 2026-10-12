// @req FR-270 — append-only, OWNER-scoped weekly lead-measure snapshot.
// @spec ADR-101 D1, BR-001, SEC-003
// @tested tests/integration/fr270-business-wig-execution.test.js
import { handle } from '../../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { recordBusinessLeadMeasureValue } from '@/modules/project-manager/application/business-wig-execution-service'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return recordBusinessLeadMeasureValue(params.id, await request.json(), { viewer })
  })
}
