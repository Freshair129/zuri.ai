// @req FR-005 — list or create work items in the neutral WorkContainer/WorkItem model
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-work-service-authorization.test.js
import { handle, queryParams } from '../_helpers'
import { listWork, createItem } from '@/modules/project-manager/application/work-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const q = queryParams(request)
  return handle(() =>
    listWork({
      workstreamId: q.workstreamId || undefined,
      projectId: q.projectId || undefined,
      executionMode: q.executionMode || undefined,
      subtype: q.subtype || undefined,
      status: q.status || undefined,
      q: q.q || undefined,
    })
  )
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createItem(await request.json(), { viewer })
  })
}
