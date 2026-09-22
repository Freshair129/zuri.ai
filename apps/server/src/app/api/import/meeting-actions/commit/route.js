// @req FR-069 — meeting action candidates commit only after the normalized
// envelope has passed the shared dry-run/conflict boundary.
// @spec BR-009, SEC-001, SEC-003
// @tested tests/unit/meeting-action-route-contract.test.js
import { handle } from '../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveApiAccessViewer } from '@/modules/identity/api-access-auth'
import { commitMeetingActions } from '@/modules/project-manager/import/meeting-action-intake'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = (await resolveApiAccessViewer(request)) ?? await resolveRequestViewer(request)
    const body = await request.json()
    return commitMeetingActions(body.intake, {
      workspaceId: body.workspaceId,
      projectId: body.projectId,
      viewer,
    })
  })
}
