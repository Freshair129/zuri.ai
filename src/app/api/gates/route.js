// @req FR-006 — create a weighted gate with required flag and evidence
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-milestone-gate-authorization.test.js
import { handle } from '../_helpers'
import { createGate } from '@/modules/project-manager/application/milestone-gate-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createGate(await request.json(), { viewer })
  })
}
