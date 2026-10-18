// @req FR-026, TASK-ZAI-011 — authenticated recipient-only approval notification inbox.
import { handle, httpError } from '@/app/api/_helpers'
import prisma from '@/lib/db'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listAgentApprovalNotifications, countAgentApprovalUnreadNotifications } from '@/modules/agent/approval-notifications'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const response = await handle(async () => {
    const params = new URL(request.url).searchParams
    if ([...params.keys()].length) throw httpError(400, 'AGENT_APPROVAL_NOTIFICATION_QUERY_INVALID')
    const viewer = await resolveRequestViewer(request)
    const [notifications, unreadCount] = await Promise.all([
      listAgentApprovalNotifications(prisma, { personId: viewer.principal.id }),
      countAgentApprovalUnreadNotifications(prisma, { personId: viewer.principal.id }),
    ])
    return { notifications, unreadCount }
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
