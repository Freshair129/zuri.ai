// @req FR-026, TASK-ZAI-011 — recipient-bound, idempotent notification acknowledgement.
import { handle, httpError } from '@/app/api/_helpers'
import prisma from '@/lib/db'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createSessionPort } from '@/modules/identity/session-port'
import { assertApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { markAgentApprovalNotificationRead } from '@/modules/agent/approval-notifications'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  const response = await handle(async () => {
    const sessionPort = createSessionPort()
    let session
    try {
      session = await sessionPort.read(request)
    } catch {
      throw httpError(503, 'SESSION_UNAVAILABLE')
    }
    const viewer = await resolveRequestViewer(request, { sessionPort: { read: async () => session } })
    assertApiWriteCsrfToken({ request, token: request.headers.get('x-csrf-token'), session })

    const notificationId = typeof params?.id === 'string' ? params.id.trim() : ''
    if (!notificationId || notificationId.length > 128 || notificationId !== params.id) {
      throw httpError(400, 'AGENT_APPROVAL_NOTIFICATION_ID_INVALID')
    }
    return {
      notification: await markAgentApprovalNotificationRead(prisma, {
        notificationId,
        personId: viewer.principal.id,
      }),
    }
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
