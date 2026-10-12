// @req FR-270, BR-043 — set one goal's WIG flag and lag Key Result atomically.
// @spec ADR-101 D1/D5, SEC-003
// @tested tests/integration/fr270-business-wig-execution.test.js
import { handle } from '../../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { setGoalWig } from '@/modules/project-manager/application/business-strategy-mutation-service'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return setGoalWig(params.id, await request.json(), { viewer })
  })
}
