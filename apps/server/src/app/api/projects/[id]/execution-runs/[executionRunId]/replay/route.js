import { handle } from '../../../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { replayProjectExecutionTrace } from '@/modules/project-manager/application/project-execution-trace-service'

// @req FR-069, FR-070 — scope-authorized PM execution trace replay command.
// @spec ADR-102, SDD-041, SEC-001, SEC-003, SEC-008
// @tested tests/integration/project-execution-trace.test.js

export const dynamic = 'force-dynamic'

export async function POST(request, { params }) {
  return handle(async () => {
    const { id: projectId, executionRunId } = await Promise.resolve(params)
    const viewer = await resolveRequestViewer(request)
    let body
    try {
      body = await request.json()
    } catch {
      const error = new Error('Replay request body must be valid JSON')
      error.status = 400
      throw error
    }
    return replayProjectExecutionTrace(projectId, executionRunId, {
      viewer,
      mode: body?.mode,
      stepKeys: body?.stepKeys,
    })
  })
}
