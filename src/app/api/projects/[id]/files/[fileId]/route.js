// @req FR-037 — Project File deletion is scoped to its owning Project and audited.
// @spec SDD-016, SEC-003, docs/features/FR-037-project-files.md
// @tested tests/unit/project-file-service.test.js
import { handle } from '../../../../_helpers'
import { deleteProjectFile } from '@/modules/project-manager/application/project-file-service'

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  return handle(() => deleteProjectFile(params.id, params.fileId))
}
