// @req FR-045 - device-specific Business remount metadata.
// @spec SDD-023, ADR-016 D5
// @tested tests/unit/fr045-file-asset-service.test.js
import { handle, queryParams } from '../../_helpers'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { listLocalWorkspaceMounts, upsertLocalWorkspaceMount } from '@/modules/project-manager/application/file-asset-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveViewer()
    return listLocalWorkspaceMounts(queryParams(request).businessId, { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveViewer()
    return upsertLocalWorkspaceMount(await request.json(), { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}
