import { topologicalPhaseOrder } from './sot-plan'

// @req FR-097 — the pipeline graph is a pure projection of the FR-095 plan and
// its derived status into the same { version, nodes, edges } shape FR-040's
// dependency map consumes, layered by topological depth.
// @spec FR-097
// @tested tests/unit/sot-pipeline-graph.test.js

/** Depth = longest dependency chain before this phase (context sources sit at -1). */
function phaseDepths(plan) {
  const order = topologicalPhaseOrder(plan)
  const byId = new Map(plan.phases.map((p) => [p.phaseId, p]))
  const depth = new Map()
  for (const id of order) {
    const phase = byId.get(id)
    depth.set(id, phase.dependsOn.length ? Math.max(...phase.dependsOn.map((d) => depth.get(d))) + 1 : 0)
  }
  return depth
}

export function buildSotPipelineGraph(plan, phasesWithStatus) {
  const statusById = new Map(phasesWithStatus.map((p) => [p.phaseId, p]))
  const depths = phaseDepths(plan)
  const maxDepth = Math.max(0, ...depths.values())

  const phaseNodes = plan.phases.map((phase) => ({
    id: phase.phaseId,
    type: phase.kind === 'HUMAN_GATE' ? 'human-gate' : 'phase',
    title: `${phase.phaseId} · ${phase.titleTh}`,
    status: statusById.get(phase.phaseId)?.status || 'planned',
    pendingDecisions: statusById.get(phase.phaseId)?.pendingDecisions || 0,
    depth: depths.get(phase.phaseId) + 1, // context sources occupy depth 0
  }))

  const contextDepth = (node) => (node.type === 'source' ? 0 : maxDepth + 2)
  const contextNodes = plan.context.nodes.map((node) => ({
    id: node.id,
    type: node.type,
    title: node.title,
    status: 'context',
    pendingDecisions: 0,
    depth: contextDepth(node),
  }))

  const dependencyEdges = plan.phases.flatMap((phase) =>
    phase.dependsOn.map((dep) => ({ id: `dep-${dep}-${phase.phaseId}`, source: dep, target: phase.phaseId }))
  )
  const contextEdges = plan.context.edges.map((e) => ({ id: e.id, source: e.source, target: e.target, ...(e.label ? { label: e.label } : {}) }))

  return { version: 1, nodes: [...contextNodes, ...phaseNodes], edges: [...dependencyEdges, ...contextEdges] }
}
