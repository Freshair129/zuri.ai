// @req FR-045 - metadata-only managed FileAsset deletion.
// @spec SDD-023, SEC-007
// @tested tests/unit/fr045-api-ui-contract.test.js
import { handle } from '../../_helpers'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { deleteManagedFileAsset } from '@/modules/project-manager/application/file-asset-service'

export const dynamic = 'force-dynamic'

export async function DELETE(_request, { params }) {
  return handle(async () => {
    const viewer = await resolveViewer()
    return deleteManagedFileAsset(params.id, { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}
