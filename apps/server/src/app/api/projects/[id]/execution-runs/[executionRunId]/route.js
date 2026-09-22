import { handle } from '../../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { getProjectExecutionTrace } from '@/modules/project-manager/application/project-execution-trace-service'

// @req FR-069, FR-070 — scope-authorized PM execution trace read and replay.
// @spec ADR-102, SDD-041, SEC-001, SEC-003, SEC-008
// @tested tests/integration/project-execution-trace.test.js

export const dynamic = 'force-dynamic'

export async function GET(request, { params }) {
  return handle(async () => {
    const { id: projectId, executionRunId } = await Promise.resolve(params)
    const viewer = await resolveRequestViewer(request)
    return getProjectExecutionTrace(projectId, executionRunId, { viewer })
  })
}
