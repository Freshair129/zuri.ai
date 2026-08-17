// @req FR-004 — list or create workstreams with execution mode, progress strategy, and weight
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-project-service-authorization.test.js
import { handle, queryParams } from '../_helpers'
import { listWorkstreams, createWorkstream } from '@/modules/project-manager/application/project-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const q = queryParams(request)
  return handle(() =>
    listWorkstreams({ projectId: q.projectId || undefined, executionMode: q.executionMode || undefined })
  )
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createWorkstream(await request.json(), { viewer })
  })
}
