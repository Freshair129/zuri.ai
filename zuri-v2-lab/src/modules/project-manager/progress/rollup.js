import { clampPercent } from './strategies'

// @req FR-011 — weighted project roll-up Σ(ws% × weight) / Σ(weight)
// @tested tests/unit/rollup.test.js

/**
 * Weighted project roll-up:
 *   Σ(workstream progress × weight) / Σ(weight)
 * Archived/deleted workstreams are excluded by the caller.
 */
export function rollupProject(workstreamResults) {
  const warnings = []
  const rows = (workstreamResults || []).filter((w) => w)
  const totalWeight = rows.reduce((s, w) => s + (Number(w.progressWeight) || 0), 0)
  if (rows.length === 0) {
    warnings.push('Project has no workstreams — progress is 0.')
    return { percent: 0, totalWeight: 0, workstreams: [], warnings }
  }
  if (totalWeight <= 0) {
    warnings.push('Workstream weights sum to 0 — cannot roll up; progress is 0.')
    return { percent: 0, totalWeight: 0, workstreams: rows, warnings }
  }
  const weighted = rows.reduce((s, w) => s + (Number(w.percent) || 0) * (Number(w.progressWeight) || 0), 0)
  return {
    percent: clampPercent(weighted / totalWeight),
    totalWeight,
    workstreams: rows,
    warnings,
    formula: 'Σ(workstream% × weight) / Σ(weight)',
  }
}
