// @req FR-037 — Project File deletion is scoped to its owning Project and audited.
// @spec SDD-016, SEC-003, docs/features/FR-037-project-files.md
// @tested tests/unit/project-file-service.test.js
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-project-file-authorization.test.js
import { handle } from '../../../../_helpers'
import { deleteProjectFile } from '@/modules/project-manager/application/project-file-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  return handle(async () => deleteProjectFile(params.id, params.fileId, { viewer: await resolveRequestViewer(request) }))
}
