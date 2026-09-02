// @req FR-045 - device-specific Business remount metadata.
// @spec SDD-023, ADR-016 D5
// @tested tests/unit/fr045-file-asset-service.test.js
import { handle, queryParams } from '../../_helpers'
// @req FR-046 — protected API identity comes from the trusted request session.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listLocalWorkspaceMounts, upsertLocalWorkspaceMount } from '@/modules/project-manager/application/file-asset-service'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return listLocalWorkspaceMounts(queryParams(request).businessId, { visibleBusinessIds: viewer.visibleBusinessIds })
  })
}

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    return upsertLocalWorkspaceMount(await request.json(), { viewer })
  })
}
