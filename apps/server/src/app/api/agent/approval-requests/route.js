// @req FR-026 — authenticated queue for pending Agent-owned write approvals.
// @spec root product decision TASK-ZAI-010 cycle 07; Identity owns reviewer authority.
import { handle, httpError } from '@/app/api/_helpers'
import prisma from '@/lib/db'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listAgentApprovalQueue } from '@/modules/agent/approval-gateway'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const params = new URL(request.url).searchParams
    const businessIds = params.getAll('businessId')
    if ([...params.keys()].some((key) => key !== 'businessId') || businessIds.length !== 1 ||
        !businessIds[0]?.trim() || businessIds[0] !== businessIds[0].trim()) {
      throw httpError(400, 'AGENT_APPROVAL_QUERY_INVALID')
    }
    const businessId = businessIds[0]
    try {
      return { requests: await listAgentApprovalQueue(prisma, { personId: viewer.principal.id, businessId }) }
    } catch (error) {
      if (error?.message === 'AGENT_APPROVAL_BUSINESS_NOT_FOUND') {
        throw httpError(404, 'AGENT_APPROVAL_BUSINESS_NOT_FOUND')
      }
      throw error
    }
  })
}
