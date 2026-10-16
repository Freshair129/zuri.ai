// @req FR-026 — authenticated same-Business OWNER decisions for Agent approvals.
// @spec root product decision TASK-ZAI-010 cycle 07; no Agent persona authority.
import { handle } from '@/app/api/_helpers'
import prisma from '@/lib/db'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { decideAgentApprovalRequest } from '@/modules/agent/approval-gateway'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    const body = await request.json()
    return decideAgentApprovalRequest(prisma, {
      requestId: params.id,
      personId: viewer.principal.id,
      decision: body?.decision,
    })
  })
}
