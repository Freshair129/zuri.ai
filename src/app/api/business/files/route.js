// @req FR-045 - Business-wide File Manager aggregation.
// @spec SDD-023, SEC-007
// @tested tests/unit/fr045-api-ui-contract.test.js
import { handle, queryParams } from '../../_helpers'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { listManagedFileAssets } from '@/modules/project-manager/application/file-asset-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const { businessId } = queryParams(request)
    const viewer = await resolveViewer()
    return listManagedFileAssets({ businessId }, { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}
