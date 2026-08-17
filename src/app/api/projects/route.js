// @req FR-003 — project CRUD: list and create
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-project-service-authorization.test.js
import { handle, queryParams } from '../_helpers'
import { listProjects, createProject } from '@/modules/project-manager/application/project-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const q = queryParams(request)
  return handle(() =>
    listProjects({
      workspaceId: q.workspaceId || undefined,
      businessId: q.businessId || undefined,
      tenantId: q.tenantId || undefined,
      status: q.status || undefined,
      q: q.q || undefined,
    })
  )
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return createProject(await request.json(), { viewer })
  })
}
