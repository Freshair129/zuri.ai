import { z } from 'zod'

import prisma from '@/lib/db'
import { isInstallationOperator, seesBusiness } from '@/modules/identity/viewer-authority'
import { countPendingSotDecisionsByPhase } from './sot-decision-service'
import { deriveSotPlanStatus, loadSotPipelinePlan } from './sot-plan'
import { buildSotPipelineGraph } from './sot-pipeline-graph'

// @req FR-095 — one viewer-scoped payload feeds both the board and the FR-097
// graph: plan phases with derived status, plus the projected node/edge graph.
// @spec FR-095, FR-097
// @tested tests/unit/sot-plan-service.test.js

function serviceError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

const zQuery = z.object({ businessId: z.string().uuid() }).strict()

/** Newest run per pipeline definition id, within one tenant. */
async function newestRunsByDefinition(db, tenantId, definitionIds) {
  if (!definitionIds.length) return new Map()
  const rows = await db.pipelineRun.findMany({
    where: { tenantId, dataPipelineDefinitionId: { in: definitionIds } },
    orderBy: [{ createdAt: 'desc' }],
  })
  const newest = new Map()
  for (const row of rows) {
    if (!newest.has(row.dataPipelineDefinitionId)) newest.set(row.dataPipelineDefinitionId, row)
  }
  return newest
}

export async function getSotPlanStatus(query, { viewer, db = prisma } = {}) {
  const parsed = zQuery.parse(query)
  if (!isInstallationOperator(viewer) && !seesBusiness(viewer, parsed.businessId)) {
    throw serviceError(404, 'SoT plan is outside your visible Business scope')
  }
  const business = await db.business.findUnique({ where: { id: parsed.businessId } })
  if (!business) throw serviceError(404, 'Business not found')

  const plan = loadSotPipelinePlan()
  const definitionIds = plan.phases.flatMap((p) => p.pipelineDefinitionIds)
  const [newest, pending] = await Promise.all([
    newestRunsByDefinition(db, business.tenantId, definitionIds),
    countPendingSotDecisionsByPhase(business.tenantId, { db }),
  ])
  const phases = deriveSotPlanStatus(plan, newest, pending)
  return {
    planId: plan.planId,
    version: plan.version,
    titleTh: plan.titleTh,
    tenantId: business.tenantId,
    businessId: business.id,
    phases: phases.map((phase) => ({
      ...phase,
      runs: phase.pipelineDefinitionIds.map((id) => {
        const run = newest.get(id)
        return run
          ? { dataPipelineDefinitionId: id, executionRunId: run.executionRunId, status: run.status, finishedAt: run.finishedAt }
          : { dataPipelineDefinitionId: id, executionRunId: null, status: null, finishedAt: null }
      }),
    })),
    graph: buildSotPipelineGraph(plan, phases),
  }
}
