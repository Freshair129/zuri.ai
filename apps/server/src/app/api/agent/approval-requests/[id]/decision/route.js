// @req FR-026 — authenticated same-Business OWNER decisions for Agent approvals.
// @spec root product decision TASK-ZAI-010 cycle 07; no Agent persona authority.
import { handle, httpError } from '@/app/api/_helpers'
import prisma from '@/lib/db'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createSessionPort } from '@/modules/identity/session-port'
import { assertApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { decideAgentApprovalRequest } from '@/modules/agent/approval-gateway'

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const sessionPort = createSessionPort()
    let session
    try {
      session = await sessionPort.read(request)
    } catch {
      throw httpError(503, 'SESSION_UNAVAILABLE')
    }
    const viewer = await resolveRequestViewer(request, { sessionPort: { read: async () => session } })
    assertApiWriteCsrfToken({
      request,
      token: request.headers.get('x-csrf-token'),
      session,
    })
    const requestId = typeof params?.id === 'string' ? params.id.trim() : ''
    if (!requestId) throw httpError(400, 'AGENT_APPROVAL_REQUEST_ID_REQUIRED')
    let body
    try {
      body = await request.json()
    } catch {
      throw httpError(400, 'AGENT_APPROVAL_BODY_INVALID')
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 1 ||
        Object.keys(body)[0] !== 'decision' || !['APPROVE', 'REJECT'].includes(body.decision)) {
      throw httpError(400, 'AGENT_APPROVAL_DECISION_INVALID')
    }
    const result = await decideAgentApprovalRequest(prisma, {
      requestId,
      personId: viewer.principal.id,
      decision: body?.decision,
    })
    if (!result.decision) throw httpError(409, `AGENT_APPROVAL_REQUEST_${result.request.status}`)
    return result
  })
}
