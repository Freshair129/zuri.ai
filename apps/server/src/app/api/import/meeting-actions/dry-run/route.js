// @req FR-069 — normalized meeting action candidates preview through the same
// PM PlanEnvelope dry-run as every other intake surface.
// @spec BR-009, SEC-001, SEC-003
// @tested tests/unit/meeting-action-route-contract.test.js
import { handle } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveApiAccessViewer } from '@/modules/identity/api-access-auth'
import { dryRunMeetingActions } from '@/modules/project-manager/import/meeting-action-intake'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = (await resolveApiAccessViewer(request)) ?? await resolveRequestViewer(request)
    const body = await request.json()
    return dryRunMeetingActions(body.intake, {
      workspaceId: body.workspaceId,
      projectId: body.projectId,
      viewer,
    })
  })
}
