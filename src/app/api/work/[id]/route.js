// @req FR-005 — update or delete work items in the neutral WorkContainer/WorkItem model
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-work-service-authorization.test.js
import { handle } from '../../_helpers'
import { updateItem, deleteItem } from '@/modules/project-manager/application/work-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function PATCH(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return updateItem(params.id, await request.json(), { viewer })
  })
}

export async function DELETE(request, { params }) {
  return handle(async () => deleteItem(params.id, { viewer: await resolveRequestViewer(request) }))
}
