// @req FR-083 — drag and single-pointer equivalents share one intake command.
// @spec SDD-046, ADR-035, NFR-008
// @tested tests/unit/pipeline-edge-interactions.test.js, tests/e2e/pipeline-edge-editing.spec.js
import { zHandoffContractV1 } from '../application/handoff-contract-schema'

export function edgePlan({ graph, source, target, dependencyType, contract }) {
  const endpoint = key => {
    const node = graph.nodes.find(node => node.id === key)
    if (!node) throw new Error('Select a source and target in this Project.')
    return { type: node.type, id: key.slice(node.type.length + 1) }
  }
  return projectPlan(graph.projectId, [{ op: 'dependency.create', clientRef: 'edge',
    source: endpoint(source), target: endpoint(target), dependencyType,
    contract: zHandoffContractV1.parse(contract) }])
}
export function projectPlan(projectId, commands) {
  return { schemaVersion: '1.3', kind: 'PROJECT_DELTA', projectId,
    trace: { correlationId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() },
    expectedPreviewHash: null, commands }
}
export const pointerMoved = (from, to) => Math.hypot(to.x - from.x, to.y - from.y) >= 8
const messages = {
  CYCLE: 'This dependency would create a cycle. Choose another target.',
  SELF_DEPENDENCY: 'A node cannot depend on itself. Choose another target.',
  SCOPE_UNAVAILABLE: 'This work is unavailable in your current scope. Reload the Project.',
  STALE_PREVIEW: 'The preview is out of date. Retry with a fresh preview.',
  STALE_ENTITY: 'This work changed. Reload the Project and try again.',
  INVALID_CONTRACT: 'Check the contract and the acceptance Gate’s predecessor scope.',
  IDEMPOTENCY_CONFLICT: 'This request changed. Correct the handoff and preview again.',
  UNDO_CONFLICT: 'Newer work prevents this undo. Reload the Project.',
}
export function pipelineMessage(error) {
  return messages[error?.code] || 'The handoff could not be saved. Check the contract, or retry.'
}
export async function pipelineRequest(path, plan) {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan }) })
  const result = await response.json()
  if (!response.ok || result.valid === false || result.committed === false) {
    const error = new Error('Pipeline request refused')
    error.code = result.errors?.[0]?.code || 'REFUSED'
    error.definitive = response.status < 500 && result.committed === false
    throw error
  }
  return result
}
export async function submitPipelinePlan(plan, { request = pipelineRequest, isCurrent, onPreview = () => {} }) {
  let accepted = plan
  if (plan.expectedPreviewHash === null) {
    const dry = await request('/api/import/dry-run', plan)
    if (!isCurrent()) return null
    if (dry.valid !== true || !/^[0-9a-f]{64}$/.test(dry.previewHash)) {
      const error = new Error('Preview refused'); error.code = dry.errors?.[0]?.code || 'REFUSED'; throw error
    }
    accepted = { ...plan, expectedPreviewHash: dry.previewHash }
    onPreview(accepted)
  } else onPreview(accepted)
  if (!isCurrent()) return null
  return request('/api/import/commit', accepted)
}

// The newest read owns the visible graph. A Project change/unmount invalidates
// pending reads as well as mutations; stale failures must not replace an alert.
export function createGraphReader(onGraph, request = (...args) => fetch(...args)) {
  let generation = 0
  return {
    invalidate() { generation++ },
    async refresh(projectId) {
      const current = ++generation
      try {
        const response = await request(`/api/projects/${projectId}/dependencies`)
        if (current !== generation) return false
        if (!response.ok) throw new Error('Graph refresh failed')
        const next = await response.json()
        if (current !== generation) return false
        if (next.projectId !== projectId) throw new Error('Project graph changed')
        onGraph(next)
        return true
      } catch (error) { if (current !== generation) return false; throw error }
    },
  }
}
