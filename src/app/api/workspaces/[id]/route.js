// @req FR-001 — update and archive workspace
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-workspace-mutation-authorization.test.js
import { handle } from '../../_helpers'
import { updateWorkspace, archiveWorkspace } from '@/modules/project-manager/application/scope-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return updateWorkspace(params.id, await request.json(), { viewer })
  })
}

export async function DELETE(request, { params }) {
  return handle(async () => archiveWorkspace(params.id, { viewer: await resolveRequestViewer(request) }))
}
