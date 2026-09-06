// @req FR-012 — validate PlanEnvelope import via dry-run semantic contract check
// @req FR-065 — the dry run is authorized identically to the commit: previewing
// a scope you were not given is the same leak as writing to it.
// @req FR-106 — the FR-019 Enterprise API surface accepts a Tenant-bound
// `Authorization: Bearer apik_...` key, checked ahead of the session seam; an
// invalid, revoked or missing key falls through to session resolution and ends
// at the identical generic refusal, so the route is not an enumeration oracle.
// @spec SDD-037, SEC-001, SEC-006, SEC-008
import { handle } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveApiAccessViewer } from '@/modules/identity/api-access-auth'
import { dryRunPlan, resolveImportWorkspaceId } from '@/modules/project-manager/import/plan-import-service'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = (await resolveApiAccessViewer(request)) ?? await resolveRequestViewer(request)
    const body = await request.json()
    return dryRunPlan(body.plan, { workspaceId: await resolveImportWorkspaceId(body), viewer })
  })
}
