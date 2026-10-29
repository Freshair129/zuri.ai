// @req TASK-ZAI-012 — explicitly submit one verified Agent Mission draft
// through the authenticated Project Manager write boundary.
import { handle } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { agentMissionIntakeService } from '@/modules/project-manager/application/agent-mission-intake-runtime'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const input = await request.json()
    return agentMissionIntakeService.submit(input, { viewer })
  })
}
