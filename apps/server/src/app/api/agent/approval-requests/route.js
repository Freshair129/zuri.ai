// @req FR-026 — authenticated queue for pending Agent-owned write approvals.
// @spec root product decision TASK-ZAI-010 cycle 07; Identity owns reviewer authority.
import { handle, queryParams } from '@/app/api/_helpers'
import prisma from '@/lib/db'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listAgentApprovalQueue } from '@/modules/agent/approval-gateway'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const { businessId } = queryParams(request)
    if (!businessId) throw new Error('businessId is required')
    return { requests: await listAgentApprovalQueue(prisma, { personId: viewer.principal.id, businessId }) }
  })
}
