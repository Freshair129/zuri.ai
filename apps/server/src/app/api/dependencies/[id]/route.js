// @req FR-007 — delete a dependency
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-dependency-authorization.test.js
import { handle } from '../../_helpers'
import { deleteDependency } from '@/modules/project-manager/application/dependency-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  return handle(async () => deleteDependency(params.id, { viewer: await resolveRequestViewer(request) }))
}
