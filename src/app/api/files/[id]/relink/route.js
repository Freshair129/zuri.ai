// @req FR-045 - explicit operator-confirmed relink for missing local files.
// @spec SDD-023, ADR-016 D6, SEC-007
// @tested tests/unit/fr045-api-ui-contract.test.js
import { handle } from '../../../_helpers'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { relinkFileAsset } from '@/modules/project-manager/application/file-asset-service'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveViewer()
    return relinkFileAsset(params.id, await request.json(), { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}
