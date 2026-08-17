// @req FR-010 — strategy-based progress with evidence + warnings
// @spec BR-005, BR-006, SDD-005 — no global task ratio; open required gates cap at 99
// @tested tests/unit/strategies.test.js
// Seven deterministic progress calculators.
// Pure functions: input is pre-loaded workstream data, output is
// { percent, evidence, warnings } — no I/O, no clock, no randomness.

import { SATISFIED_GATE_STATUSES } from '@/lib/validation/enums'

// DONE/CANCELLED are terminal-status filters, not enumerations of
// WORK_STATUSES: DONE means "counts as complete", CANCELLED means "excluded
// from active work" (activeItems, below). PLANNED/READY/IN_PROGRESS/REVIEW are
// all still counted — they are simply neither done nor excluded.
const DONE = new Set(['DONE', 'COMPLETED'])
const CANCELLED = new Set(['CANCELLED'])
const GATE_SATISFIED = new Set(SATISFIED_GATE_STATUSES)

export function clampPercent(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10))
}

/**
 * Would this raw percent be SHOWN as 100?
 *
 * @spec BR-006 — an open required gate caps progress below complete.
 *
 * The gate cap used to test `percent >= 100` on the raw value while the caller
 * rendered `clampPercent(percent)`. Anything in [99.95, 100) — 2499 of 2500
 * weight, say — passed the cap untouched and then rounded to **100.0%** with a
 * required gate still open and no warning: exactly the claim BR-006 exists to
 * forbid.
 *
 * A threshold has to be evaluated on the representation the reader sees. Testing
 * it on an earlier one is the same mistake as reading a per-principal label as
 * per-Business authority — the check and the thing it protects disagreed about
 * what the value meant.
 */
export function reportsAsComplete(rawPercent) {
  return clampPercent(rawPercent) >= 100
}

/**
 * Which rows count.
 *
 * Exported because the execution-mode cards were reducing over the raw item
 * list while the calculators reduced over this one, so a cancelled deal was
 * counted by the card and excluded by the calculator: the same screen showed
 * 157,000 on the tile and 125,000 in the Explain panel. The formulas agreed;
 * only the population did.
 *
 * CLAUDE.md: "Never report a number a page would disagree with." A shared
 * formula is not enough — the two sides must also agree on what they are
 * summing over.
 */
export function activeItems(items) {
  return (items || []).filter((i) => !CANCELLED.has(i.status) && !i.deletedAt)
}

function num(value, fallback = 0) {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/**
 * 1. TASK_WEIGHT — Software Sprint.
 * completed weight / planned weight. Defect count reported as evidence.
 */
export function taskWeight({ items = [], gates = [] }) {
  const warnings = []
  const scoped = activeItems(items)
  const planned = scoped.reduce((s, i) => s + num(i.weight, 1), 0)
  const completed = scoped
    .filter((i) => DONE.has(i.status))
    .reduce((s, i) => s + num(i.weight, 1), 0)
  const defects = scoped.filter((i) => i.subtype === 'BUG' && !DONE.has(i.status)).length
  let percent = 0
  if (scoped.length === 0) {
    warnings.push('No work items — progress is 0.')
  } else if (planned <= 0) {
    warnings.push('Planned weight is 0 — cannot divide; progress is 0.')
  } else {
    percent = (completed / planned) * 100
  }
  const releaseGates = (gates || []).filter((g) => g.required)
  const openReleaseGates = releaseGates.filter((g) => !GATE_SATISFIED.has(g.status))
  if (openReleaseGates.length > 0 && reportsAsComplete(percent)) {
    percent = 99
    warnings.push(`All weight complete but ${openReleaseGates.length} required gate(s) not passed — capped at 99%.`)
  }
  return {
    percent: clampPercent(percent),
    evidence: {
      strategy: 'TASK_WEIGHT',
      completedWeight: completed,
      plannedWeight: planned,
      itemCount: scoped.length,
      openDefects: defects,
      requiredGates: releaseGates.length,
      openRequiredGates: openReleaseGates.length,
      formula: 'completedWeight / plannedWeight × 100',
    },
    warnings,
  }
}

/**
 * 2. RECORD_VALIDATION — Data Migration.
 * validated records / total records, aggregated across dataset items.
 */
export function recordValidation({ items = [] }) {
  const warnings = []
  const scoped = activeItems(items)
  let total = 0
  let processed = 0
  let validated = 0
  let failed = 0
  let reconciled = 0
  let missingMetrics = 0
  for (const item of scoped) {
    const m = item.metrics || {}
    const t = num(m.recordsTotal)
    if (t <= 0) {
      missingMetrics++
      continue
    }
    total += t
    processed += num(m.processed)
    validated += num(m.validated)
    failed += num(m.failed)
    reconciled += num(m.reconciled)
  }
  if (missingMetrics > 0) warnings.push(`${missingMetrics} item(s) missing recordsTotal metric — excluded.`)
  let percent = 0
  if (scoped.length === 0) {
    warnings.push('No datasets tracked — progress is 0.')
  } else if (total <= 0) {
    warnings.push('Total record count is 0 — cannot derive validation progress.')
  } else {
    percent = (validated / total) * 100
  }
  return {
    percent: clampPercent(percent),
    evidence: {
      strategy: 'RECORD_VALIDATION',
      recordsTotal: total,
      processed,
      validated,
      failed,
      reconciled,
      datasetCount: scoped.length,
      formula: 'validated / recordsTotal × 100',
    },
    warnings,
  }
}

/**
 * 3. WEIGHTED_PIPELINE — B2B Sales.
 * (won revenue + Σ open value × probability) / target.
 */
export function weightedPipeline({ items = [], viewConfig = {} }) {
  const warnings = []
  const scoped = activeItems(items).filter((i) => i.subtype === 'DEAL' || i.numericValue != null)
  let wonRevenue = 0
  let weightedOpen = 0
  let totalValue = 0
  for (const deal of scoped) {
    const value = num(deal.numericValue)
    totalValue += value
    if (DONE.has(deal.status)) {
      wonRevenue += value
    } else {
      const p = deal.probability == null ? 0 : num(deal.probability)
      if (deal.probability == null) warnings.push(`Deal ${deal.code} has no probability — counted at 0.`)
      weightedOpen += value * p
    }
  }
  const weightedValue = wonRevenue + weightedOpen
  const target = num(viewConfig.revenueTarget)
  let percent = 0
  if (scoped.length === 0) {
    warnings.push('No deals in pipeline — progress is 0.')
  } else if (target > 0) {
    percent = (weightedValue / target) * 100
  } else if (totalValue > 0) {
    warnings.push('No revenueTarget configured — using weighted value over total pipeline value.')
    percent = (weightedValue / totalValue) * 100
  } else {
    warnings.push('No deal values recorded — cannot derive pipeline progress.')
  }
  return {
    percent: clampPercent(percent),
    evidence: {
      strategy: 'WEIGHTED_PIPELINE',
      dealCount: scoped.length,
      totalPipelineValue: totalValue,
      wonRevenue,
      weightedOpenValue: Math.round(weightedOpen * 100) / 100,
      weightedValue: Math.round(weightedValue * 100) / 100,
      revenueTarget: target || null,
      formula: '(wonRevenue + Σ openValue × probability) / revenueTarget × 100',
    },
    warnings,
  }
}

/**
 * 4. KPI_ATTAINMENT — B2C Campaign.
 * Weighted average attainment across configured KPI targets.
 * viewConfig.kpis = [{ key, label?, target, weight?, direction? ('up'|'down') }]
 * Actuals are summed from item metrics[key].
 */
export function kpiAttainment({ items = [], viewConfig = {} }) {
  const warnings = []
  const kpis = Array.isArray(viewConfig.kpis) ? viewConfig.kpis : []
  const scoped = activeItems(items)
  if (kpis.length === 0) {
    warnings.push('No KPI targets configured — progress is 0.')
    return {
      percent: 0,
      evidence: { strategy: 'KPI_ATTAINMENT', kpis: [], formula: 'Σ attainment × weight / Σ weight' },
      warnings,
    }
  }
  const rows = []
  let weightedSum = 0
  let weightTotal = 0
  for (const kpi of kpis) {
    const target = num(kpi.target)
    const weight = num(kpi.weight, 1)
    const actual = scoped.reduce((s, i) => s + num((i.metrics || {})[kpi.key]), 0)
    let attainment = 0
    if (target <= 0) {
      warnings.push(`KPI ${kpi.key} has no positive target — counted at 0.`)
    } else if (kpi.direction === 'down') {
      // Lower is better (e.g. CPA): full credit at/below target, decays linearly to 0 at 2× target.
      attainment = actual <= 0 ? 0 : Math.max(0, Math.min(1, 2 - actual / target))
      if (actual <= 0) warnings.push(`KPI ${kpi.key} has no recorded actual — counted at 0.`)
    } else {
      attainment = Math.min(1, actual / target)
    }
    rows.push({
      key: kpi.key,
      label: kpi.label || kpi.key,
      target,
      actual: Math.round(actual * 100) / 100,
      weight,
      direction: kpi.direction || 'up',
      attainment: Math.round(attainment * 1000) / 1000,
    })
    weightedSum += attainment * weight
    weightTotal += weight
  }
  const percent = weightTotal > 0 ? (weightedSum / weightTotal) * 100 : 0
  if (weightTotal <= 0) warnings.push('KPI weights sum to 0 — cannot derive attainment.')
  return {
    percent: clampPercent(percent),
    evidence: { strategy: 'KPI_ATTAINMENT', kpis: rows, formula: 'Σ attainment × weight / Σ weight × 100' },
    warnings,
  }
}

/**
 * 5. MILESTONE_READINESS — Product Launch.
 * Weighted milestone completion; open required gates cap at 99%.
 */
export function milestoneReadiness({ milestones = [], gates = [] }) {
  const warnings = []
  const totalWeight = milestones.reduce((s, m) => s + num(m.weight, 1), 0)
  const doneWeight = milestones
    .filter((m) => DONE.has(m.status))
    .reduce((s, m) => s + num(m.weight, 1), 0)
  let percent = 0
  if (milestones.length === 0) {
    warnings.push('No milestones defined — progress is 0.')
  } else if (totalWeight <= 0) {
    warnings.push('Milestone weights sum to 0 — cannot derive readiness.')
  } else {
    percent = (doneWeight / totalWeight) * 100
  }
  const requiredGates = (gates || []).filter((g) => g.required)
  const blockedGates = requiredGates.filter((g) => g.status === 'BLOCKED')
  const openGates = requiredGates.filter((g) => !GATE_SATISFIED.has(g.status))
  if (openGates.length > 0 && reportsAsComplete(percent)) {
    percent = 99
    warnings.push(`${openGates.length} required gate(s) not passed — readiness capped at 99%.`)
  }
  if (blockedGates.length > 0) {
    warnings.push(`${blockedGates.length} required gate(s) BLOCKED.`)
  }
  return {
    percent: clampPercent(percent),
    evidence: {
      strategy: 'MILESTONE_READINESS',
      milestoneCount: milestones.length,
      doneWeight,
      totalWeight,
      requiredGates: requiredGates.length,
      openRequiredGates: openGates.length,
      blockedGates: blockedGates.length,
      formula: 'Σ doneMilestoneWeight / Σ milestoneWeight × 100 (capped by open gates)',
    },
    warnings,
  }
}

/**
 * 6. SLA_SCORE — Operations.
 * Blend of checklist completion and SLA attainment metrics.
 */
export function slaScore({ items = [] }) {
  const warnings = []
  const scoped = activeItems(items)
  if (scoped.length === 0) {
    warnings.push('No operations items tracked — progress is 0.')
    return {
      percent: 0,
      evidence: { strategy: 'SLA_SCORE', signals: [], formula: 'mean(available signals)' },
      warnings,
    }
  }
  const signals = []
  // Signal A: checklist/run completion.
  const completion = scoped.filter((i) => DONE.has(i.status)).length / scoped.length
  signals.push({ key: 'completion', value: Math.round(completion * 1000) / 1000 })
  // Signal B: explicit SLA attainment (slaMet / slaTotal across items).
  let slaMet = 0
  let slaTotal = 0
  let incidents = 0
  let backlog = 0
  for (const item of scoped) {
    const m = item.metrics || {}
    slaMet += num(m.slaMet)
    slaTotal += num(m.slaTotal)
    incidents += num(m.incidents)
    backlog += num(m.backlog)
  }
  if (slaTotal > 0) {
    signals.push({ key: 'slaAttainment', value: Math.round((slaMet / slaTotal) * 1000) / 1000 })
  } else {
    warnings.push('No SLA metrics recorded — score uses completion only.')
  }
  const percent = (signals.reduce((s, x) => s + x.value, 0) / signals.length) * 100
  return {
    percent: clampPercent(percent),
    evidence: {
      strategy: 'SLA_SCORE',
      itemCount: scoped.length,
      signals,
      slaMet,
      slaTotal,
      incidents,
      backlog,
      formula: 'mean(completion, slaAttainment) × 100',
    },
    warnings,
  }
}

/**
 * 7. EXPANSION_READINESS — Business Expansion.
 * Weighted completion of readiness actions across dimensions
 * (legal, location, budget, hiring, vendors, operations), gated by go-live gates.
 */
export function expansionReadiness({ items = [], gates = [] }) {
  const warnings = []
  const scoped = activeItems(items)
  const byDimension = new Map()
  for (const item of scoped) {
    const dim = (item.metadata || {}).dimension || 'general'
    if (!byDimension.has(dim)) byDimension.set(dim, { total: 0, done: 0 })
    const bucket = byDimension.get(dim)
    const w = num(item.weight, 1)
    bucket.total += w
    if (DONE.has(item.status)) bucket.done += w
  }
  const dimensions = [...byDimension.entries()].map(([name, b]) => ({
    name,
    doneWeight: b.done,
    totalWeight: b.total,
    percent: b.total > 0 ? clampPercent((b.done / b.total) * 100) : 0,
  }))
  const totalWeight = scoped.reduce((s, i) => s + num(i.weight, 1), 0)
  const doneWeight = scoped.filter((i) => DONE.has(i.status)).reduce((s, i) => s + num(i.weight, 1), 0)
  let percent = 0
  if (scoped.length === 0) {
    warnings.push('No readiness actions tracked — progress is 0.')
  } else if (totalWeight <= 0) {
    warnings.push('Readiness weights sum to 0 — cannot derive readiness.')
  } else {
    percent = (doneWeight / totalWeight) * 100
  }
  const goLiveGates = (gates || []).filter((g) => g.required)
  const openGates = goLiveGates.filter((g) => !GATE_SATISFIED.has(g.status))
  if (openGates.length > 0 && percent >= 100) {
    percent = 99
    warnings.push(`${openGates.length} go-live gate(s) not passed — readiness capped at 99%.`)
  }
  return {
    percent: clampPercent(percent),
    evidence: {
      strategy: 'EXPANSION_READINESS',
      dimensions,
      doneWeight,
      totalWeight,
      goLiveGates: goLiveGates.length,
      openGoLiveGates: openGates.length,
      formula: 'Σ doneActionWeight / Σ actionWeight × 100 (capped by go-live gates)',
    },
    warnings,
  }
}

export const STRATEGY_CALCULATORS = {
  TASK_WEIGHT: taskWeight,
  RECORD_VALIDATION: recordValidation,
  WEIGHTED_PIPELINE: weightedPipeline,
  KPI_ATTAINMENT: kpiAttainment,
  MILESTONE_READINESS: milestoneReadiness,
  SLA_SCORE: slaScore,
  EXPANSION_READINESS: expansionReadiness,
}

/**
 * Compute progress for a hydrated workstream bundle.
 */
export function calculateWorkstreamProgress(strategy, bundle) {
  const calculator = STRATEGY_CALCULATORS[strategy]
  if (!calculator) {
    return {
      percent: 0,
      evidence: { strategy, formula: 'unknown strategy' },
      warnings: [`Unknown progress strategy: ${strategy}`],
    }
  }
  return calculator(bundle)
}
