// @req FR-012 — transactional commit leg of PlanEnvelope import pipeline
// @req FR-065 — the target Workspace is authorized against a resolved viewer,
// never against the `workspaceId` the request body happens to name.
// @spec SDD-037, SEC-001, SEC-008
import { handle } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { commitPlan, resolveImportWorkspaceId } from '@/modules/project-manager/import/plan-import-service'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    return commitPlan(body.plan, { workspaceId: await resolveImportWorkspaceId(body), viewer })
  })
}
