import { handle, httpError } from '../../../../../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { decideApproval } from '@/modules/project-manager/application/approval-gateway'

// @req FR-272 — reviewer decision route with current Identity capability and
// requester/reviewer segregation-of-duties checks.
// @spec ADR-103, PMR-013, PMT-013, SEC-001, SEC-003, SEC-008
// @tested tests/integration/project-approval-gateway.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const { id: projectId, executionRunId, approvalRequestId } = await Promise.resolve(params)
    const viewer = await resolveRequestViewer(request)
    let body
    try {
      body = await request.json()
    } catch {
      throw httpError(400, 'Approval decision body must be valid JSON')
    }
    return decideApproval(approvalRequestId, body, { viewer, projectId, executionRunId })
  })
}
