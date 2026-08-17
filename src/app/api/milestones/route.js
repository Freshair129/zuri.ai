// @req FR-006 — list or create weighted milestones with gates
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-milestone-gate-authorization.test.js
import { handle, queryParams } from '../_helpers'
import { listMilestonesAndGates, createMilestone } from '@/modules/project-manager/application/milestone-gate-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const q = queryParams(request)
  return handle(() =>
    listMilestonesAndGates({ projectId: q.projectId || undefined, workstreamId: q.workstreamId || undefined })
  )
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createMilestone(await request.json(), { viewer })
  })
}
