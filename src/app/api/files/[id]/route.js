// @req FR-045 - metadata-only managed FileAsset deletion.
// @spec SDD-023, SEC-007
// @tested tests/unit/fr045-api-ui-contract.test.js
import { handle } from '../../_helpers'
// @req FR-046 — protected API identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { deleteManagedFileAsset } from '@/modules/project-manager/application/file-asset-service'

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return deleteManagedFileAsset(params.id, { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}
