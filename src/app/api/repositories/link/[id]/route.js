// @req FR-008 — unlink repository from project (many-to-many relationship)
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-repository-link-authorization.test.js
import { handle } from '../../../_helpers'
import { unlinkRepository } from '@/modules/project-manager/application/repository-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  return handle(async () => unlinkRepository(params.id, { viewer: await resolveRequestViewer(request) }))
}
