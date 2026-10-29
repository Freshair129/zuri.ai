// @req TASK-ZAI-012 — explicitly submit one verified Agent Mission draft
// through the authenticated Project Manager write boundary.
import { handle, httpError } from '../../_helpers'
import { createSessionPort } from '@/modules/identity/session-port'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { assertApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { agentMissionIntakeService } from '@/modules/project-manager/application/agent-mission-intake-runtime'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  return handle(async () => {
    const sessionPort = createSessionPort()
    let session
    try {
      session = await sessionPort.read(request)
    } catch {
      throw httpError(503, 'SESSION_UNAVAILABLE')
    }
    const viewer = await resolveRequestViewer(request, { sessionPort: { read: async () => session } })
    assertApiWriteCsrfToken({ request, token: request.headers.get('x-csrf-token'), session })
    const input = await request.json()
    return agentMissionIntakeService.submit(input, { viewer })
  })
}
