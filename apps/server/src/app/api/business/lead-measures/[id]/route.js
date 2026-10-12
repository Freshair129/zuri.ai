// @req FR-270 — OWNER-scoped lead-measure update/archive.
// @spec ADR-101 D1, BR-001, SEC-003
// @tested tests/integration/fr270-business-wig-execution.test.js
import { handle } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { updateBusinessLeadMeasure } from '@/modules/project-manager/application/business-wig-execution-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return updateBusinessLeadMeasure(params.id, await request.json(), { viewer })
  })
}
