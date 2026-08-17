// @req FR-003 — project CRUD: get, update, and archive
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-project-service-authorization.test.js
import { handle } from '../../_helpers'
import { getProject, updateProject, archiveProject } from '@/modules/project-manager/application/project-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const project = await getProject(params.id)
    if (!project) throw new Error('Project not found')
    return project
  })
}

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return updateProject(params.id, await request.json(), { viewer })
  })
}

export async function DELETE(request, { params }) {
  return handle(async () => archiveProject(params.id, { viewer: await resolveRequestViewer(request) }))
}
