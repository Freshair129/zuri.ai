import { handle } from '../../../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { listApprovals } from '@/modules/project-manager/application/approval-gateway'

// @req FR-272 — scope-authorized reviewer projection for one PM execution run.
// @spec ADR-103, PMR-013, PMT-013, SEC-001, SEC-008
// @tested tests/integration/project-approval-gateway.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const { id: projectId, executionRunId } = await Promise.resolve(params)
    const viewer = await resolveRequestViewer(request)
    return listApprovals(projectId, executionRunId, { viewer })
  })
}
