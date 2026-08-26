// @req FR-012 — transactional commit leg of PlanEnvelope import pipeline
// @req FR-065 — the target Workspace is authorized against a resolved viewer,
// never against the `workspaceId` the request body happens to name.
// @req FR-106 — the FR-019 Enterprise API surface accepts a Tenant-bound
// `Authorization: Bearer apik_...` key, checked ahead of the session seam; an
// invalid, revoked or missing key falls through to session resolution and ends
// at the identical generic refusal, so the route is not an enumeration oracle.
// @spec SDD-037, SEC-001, SEC-006, SEC-008
import { handle } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveApiAccessViewer } from '@/modules/identity/api-access-auth'
import { commitPlan, resolveImportWorkspaceId } from '@/modules/project-manager/import/plan-import-service'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = (await resolveApiAccessViewer(request)) ?? await resolveRequestViewer(request)
    const body = await request.json()
    return commitPlan(body.plan, { workspaceId: await resolveImportWorkspaceId(body), viewer })
  })
}
