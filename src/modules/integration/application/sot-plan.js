import { readFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'

// @req FR-095 — the SoT pipeline plan is strict-validated data and its phase
// status is a pure derivation over FR-071 run evidence plus FR-096 pending
// decision counts; nothing here is typed in by a human.
// @spec FR-095, SEC-002
// @tested tests/unit/sot-plan-status.test.js

export const SOT_PHASE_KINDS = Object.freeze(['AUTOMATED', 'HUMAN_GATE'])
export const SOT_PHASE_STATUSES = Object.freeze(['planned', 'running', 'blocked', 'done'])

const zContextNode = z.object({
  id: z.string().min(1),
  type: z.enum(['source', 'store', 'consumer']),
  title: z.string().min(1),
}).strict()

const zContextEdge = z.object({
  id: z.string().min(1),
  source: z.string().min(1),
  target: z.string().min(1),
  label: z.string().min(1).optional(),
}).strict()

const zPhase = z.object({
  phaseId: z.string().regex(/^P\d{1,2}$/),
  title: z.string().min(1),
  titleTh: z.string().min(1),
  summaryTh: z.string().min(1),
  kind: z.enum(SOT_PHASE_KINDS),
  dependsOn: z.array(z.string().regex(/^P\d{1,2}$/)),
  pipelineDefinitionIds: z.array(z.string().min(1)),
}).strict()

export const zSotPipelinePlan = z.object({
  planId: z.literal('SOT-PIPELINE-PLAN'),
  version: z.string().min(1),
  titleTh: z.string().min(1),
  phases: z.array(zPhase).min(1),
  context: z.object({
    nodes: z.array(zContextNode),
    edges: z.array(zContextEdge),
  }).strict(),
}).strict()

export function parseSotPipelinePlan(raw) {
  const plan = zSotPipelinePlan.parse(raw)
  const ids = new Set(plan.phases.map((p) => p.phaseId))
  if (ids.size !== plan.phases.length) throw new Error('SoT plan: duplicate phaseId')
  for (const phase of plan.phases) {
    for (const dep of phase.dependsOn) {
      if (!ids.has(dep)) throw new Error(`SoT plan: ${phase.phaseId} depends on unknown phase ${dep}`)
    }
  }
  const contextIds = new Set(plan.context.nodes.map((n) => n.id))
  for (const edge of plan.context.edges) {
    const known = (id) => ids.has(id) || contextIds.has(id)
    if (!known(edge.source) || !known(edge.target)) {
      throw new Error(`SoT plan: context edge ${edge.id} references an unknown node`)
    }
  }
  // dependency cycles would make both the board order and the graph layers
  // meaningless, so a cyclic plan file is rejected at load, not rendered oddly
  topologicalPhaseOrder(plan)
  return plan
}

export function loadSotPipelinePlan() {
  const file = path.join(process.cwd(), 'contracts', 'sot-pipeline-plan.v1.json')
  return parseSotPipelinePlan(JSON.parse(readFileSync(file, 'utf8')))
}

/** Kahn topological order over dependsOn; throws on a cycle. */
export function topologicalPhaseOrder(plan) {
  const indegree = new Map(plan.phases.map((p) => [p.phaseId, p.dependsOn.length]))
  const dependents = new Map()
  for (const phase of plan.phases) {
    for (const dep of phase.dependsOn) {
      if (!dependents.has(dep)) dependents.set(dep, [])
      dependents.get(dep).push(phase.phaseId)
    }
  }
  const queue = plan.phases.filter((p) => p.dependsOn.length === 0).map((p) => p.phaseId)
  const order = []
  while (queue.length) {
    const id = queue.shift()
    order.push(id)
    for (const next of dependents.get(id) || []) {
      const left = indegree.get(next) - 1
      indegree.set(next, left)
      if (left === 0) queue.push(next)
    }
  }
  if (order.length !== plan.phases.length) throw new Error('SoT plan: dependency cycle')
  return order
}

const RUNNING_STATUSES = new Set(['QUEUED', 'RUNNING'])

/**
 * Derive one phase's status from evidence.
 * `newestRunByDefinition`: Map<dataPipelineDefinitionId, { status }> — the
 * newest run per definition, as FR-071 reports it.
 * `pendingDecisionsByPhase`: Map<phaseId, count> — FR-096 PENDING counts.
 */
export function deriveSotPhaseStatus(phase, newestRunByDefinition, pendingDecisionsByPhase) {
  const pending = pendingDecisionsByPhase.get(phase.phaseId) || 0
  const newest = phase.pipelineDefinitionIds
    .map((id) => newestRunByDefinition.get(id))
    .filter(Boolean)
  if (pending > 0) return 'blocked'
  if (newest.some((run) => run.status === 'FAILED')) return 'blocked'
  if (newest.some((run) => RUNNING_STATUSES.has(run.status))) return 'running'
  const allCovered = phase.pipelineDefinitionIds.length > 0
    && newest.length === phase.pipelineDefinitionIds.length
    && newest.every((run) => run.status === 'SUCCEEDED')
  if (allCovered) return 'done'
  return 'planned'
}

export function deriveSotPlanStatus(plan, newestRunByDefinition, pendingDecisionsByPhase) {
  const order = topologicalPhaseOrder(plan)
  const byId = new Map(plan.phases.map((p) => [p.phaseId, p]))
  return order.map((phaseId) => {
    const phase = byId.get(phaseId)
    return {
      ...phase,
      status: deriveSotPhaseStatus(phase, newestRunByDefinition, pendingDecisionsByPhase),
      pendingDecisions: pendingDecisionsByPhase.get(phaseId) || 0,
    }
  })
}
