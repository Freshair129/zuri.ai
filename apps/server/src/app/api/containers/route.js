// @req FR-005 — create a work container in the neutral WorkContainer/WorkItem model
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-work-service-authorization.test.js
import { handle } from '../_helpers'
import { createContainer } from '@/modules/project-manager/application/work-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createContainer(await request.json(), { viewer })
  })
}
