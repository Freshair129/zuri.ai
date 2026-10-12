// @req FR-270 — idempotent OWNER step state for one Business/week session.
// @spec ADR-101 D1, BR-001, SEC-003
// @tested tests/integration/fr270-business-wig-execution.test.js
import { handle } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { setBusinessWigSessionStep } from '@/modules/project-manager/application/business-wig-execution-service'

export const dynamic = 'force-dynamic'

export async function PUT(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return setBusinessWigSessionStep(await request.json(), { viewer })
  })
}
