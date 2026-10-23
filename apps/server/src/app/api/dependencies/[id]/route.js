import { NextResponse } from 'next/server'
import { dryRunPlanDelta, commitPlanDelta, pipelineFailure, pipelineResponseStatus } from '@/modules/project-manager/import/plan-delta-service'
import { pipelineError } from '@/modules/project-manager/application/pipeline-transaction'
// @req FR-007 — delete a dependency
// @req FR-046 — every mutating request resolves one trusted viewer and fails closed.
// @req FR-072 — the service refuses this write unless the viewer owns the governing Business.
// @spec SEC-001, SEC-008
// @tested tests/integration/fr072-dependency-authorization.test.js
import { handle } from '../../_helpers'
import { deleteDependency } from '@/modules/project-manager/application/dependency-service'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

export const dynamic = 'force-dynamic'

export async function DELETE(request, { params }) {
  return handle(async () => {
    const viewer = await resolveRequestViewer(request)
    let body
    try { body = await request.json() } catch { body = {} }
    try {
      if (!body.plan) return await deleteDependency(params.id, { viewer })
      if (body.plan.commands?.length !== 1 || body.plan.commands[0].op !== 'dependency.remove' || body.plan.commands[0].id !== params.id) throw pipelineError('INVALID_ENVELOPE', 400)
      const options = { viewer, register: true }
      const result = body.plan.expectedPreviewHash === null ? await dryRunPlanDelta(body.plan, options) : await commitPlanDelta(body.plan, options)
      return NextResponse.json(result, { status: pipelineResponseStatus(result) })
    } catch (error) {
      if (error?.name !== 'PipelineError') throw error
      return NextResponse.json(pipelineFailure(error), { status: error.status })
    }
  })
}
