import { calculateWorkstreamProgress } from '../../progress/strategies'

function parseJson(value) {
  try { return JSON.parse(value || '{}') } catch { return {} }
}

function earliestRecordedTargetAt(workstream, items) {
  const targets = [
    ...items.map((item) => item.targetAt),
    ...(workstream.containers || []).map((container) => container.targetAt),
    ...(workstream.milestones || []).map((milestone) => milestone.targetAt),
    ...(workstream.gates || []).map((gate) => gate.targetAt),
  ].filter(Boolean).map((value) => new Date(value)).filter((date) => Number.isFinite(date.getTime()))
  targets.sort((a, b) => a - b)
  return targets[0] || null
}

/** Pure PM read model. It does not call the progress cache-refresh endpoint. */
export function buildOperationsWorkstreamViewModel(workstream) {
  const items = (workstream.items || []).map((item) => ({
    ...item,
    metrics: parseJson(item.metricDataJson),
    metadata: parseJson(item.metadataJson),
  }))
  const progress = calculateWorkstreamProgress(workstream.progressStrategy, {
    viewConfig: parseJson(workstream.viewConfigJson),
    items,
    containers: workstream.containers || [],
    milestones: workstream.milestones || [],
    gates: workstream.gates || [],
  })
  return {
    progress,
    items,
    earliestRecordedTargetAt: earliestRecordedTargetAt(workstream, items),
    project: workstream.project || null,
  }
}
