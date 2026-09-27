// Marketing Insights (S6) — daily series, window totals and period change.
// Pure functions: the rules below are the measurement contract, not display.
//
// @spec docs/migrations/service-extraction/INSIGHTS-CONTRACT-RECONCILIATION.md
//   (R-01 views/viewers, R-09 unknown values, R-11 coverage, prompt §6 rules 1–10)
// @tested tests/unit/marketing/insights/metric-series.test.js

import { AGGREGATION } from './metric-catalog'

/** Why a value is not a number. Observed zero is `OBSERVED` with value 0. */
export const QUALITY = Object.freeze({
  OBSERVED: 'OBSERVED',
  NOT_SYNCED: 'NOT_SYNCED',
  UNSUPPORTED: 'UNSUPPORTED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  PROVIDER_ERROR: 'PROVIDER_ERROR',
  PRECISION_UNSAFE: 'PRECISION_UNSAFE',
  PARTIAL_DAY: 'PARTIAL_DAY',
  UNIQUE_DISTRIBUTION_NOT_ADDITIVE: 'UNIQUE_DISTRIBUTION_NOT_ADDITIVE',
  DERIVED_INPUT_MISSING: 'DERIVED_INPUT_MISSING',
})

export const METRIC_STATE = Object.freeze({
  READY: 'READY',
  PARTIAL: 'PARTIAL',
  NOT_SYNCED: 'NOT_SYNCED',
  UNSUPPORTED: 'UNSUPPORTED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  ERROR: 'ERROR',
})

const QUALITY_TO_STATE = {
  [QUALITY.NOT_SYNCED]: METRIC_STATE.NOT_SYNCED,
  [QUALITY.UNSUPPORTED]: METRIC_STATE.UNSUPPORTED,
  [QUALITY.PERMISSION_DENIED]: METRIC_STATE.PERMISSION_DENIED,
  [QUALITY.PROVIDER_ERROR]: METRIC_STATE.ERROR,
  [QUALITY.PRECISION_UNSAFE]: METRIC_STATE.ERROR,
}

/** Sum that refuses to lose precision rather than round silently. */
export function safeSum(values) {
  let total = 0
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null
    total += value
    if (Math.abs(total) > Number.MAX_SAFE_INTEGER) return null
  }
  return total
}

function grainKey(metricKey, date, distribution) {
  return `${metricKey}|${date}|${distribution}`
}

/**
 * A later sync that corrects a day is a revision of the same grain, never an
 * addition to it. Highest revision wins; equal revisions fall back to the
 * later fetch, then to input order.
 */
export function latestRevisions(observations = []) {
  const byGrain = new Map()
  for (const row of observations) {
    const key = grainKey(row.metricKey, row.date, row.distribution)
    const held = byGrain.get(key)
    if (!held) { byGrain.set(key, row); continue }
    const newer = (row.revision ?? 0) > (held.revision ?? 0)
      || ((row.revision ?? 0) === (held.revision ?? 0) && String(row.fetchedAt ?? '') > String(held.fetchedAt ?? ''))
    if (newer) byGrain.set(key, row)
  }
  return byGrain
}

function observedValue(row) {
  return row && row.quality === QUALITY.OBSERVED && typeof row.value === 'number' ? row.value : null
}

function firstGap(rows) {
  const gap = rows.find((row) => row && row.quality !== QUALITY.OBSERVED)
  return gap ? gap.quality : QUALITY.NOT_SYNCED
}

function storedPoint(definition, byGrain, date) {
  const all = byGrain.get(grainKey(definition.metricKey, date, 'ALL'))
  const organicRow = byGrain.get(grainKey(definition.metricKey, date, 'ORGANIC'))
  const paidRow = byGrain.get(grainKey(definition.metricKey, date, 'PAID'))
  const organic = observedValue(organicRow)
  const paid = observedValue(paidRow)
  const allValue = observedValue(all)

  if (allValue !== null) {
    return { date, value: allValue, organic, paid, quality: QUALITY.OBSERVED, unit: all.unit ?? null }
  }
  if (organic !== null && paid !== null) {
    if (definition.aggregation === AGGREGATION.NON_ADDITIVE_UNIQUE) {
      // The same person can be reached organically and by an ad on the same
      // day; organic + paid unique is not the unique total.
      return { date, value: null, organic, paid, quality: QUALITY.UNIQUE_DISTRIBUTION_NOT_ADDITIVE, unit: organicRow.unit ?? null }
    }
    if (organicRow.unit !== paidRow.unit) {
      return { date, value: null, organic, paid, quality: QUALITY.PRECISION_UNSAFE, unit: null }
    }
    const value = safeSum([organic, paid])
    return {
      date, value, organic, paid,
      quality: value === null ? QUALITY.PRECISION_UNSAFE : QUALITY.OBSERVED,
      unit: organicRow.unit ?? null,
    }
  }
  return {
    date, value: null, organic, paid,
    quality: firstGap([all, organicRow, paidRow].filter(Boolean)),
    unit: (all || organicRow || paidRow)?.unit ?? null,
  }
}

/**
 * One point per requested day. Missing days are explicit NOT_SYNCED points,
 * never zeros. `partialDates` marks days that are still accumulating: the
 * value is shown, but no window total may claim it as complete.
 */
export function buildDailySeries(definition, observations, days, { partialDates = [], inputs = null } = {}) {
  const partial = new Set(partialDates)
  let points
  if (definition.aggregation === AGGREGATION.DERIVED_DIFFERENCE) {
    const [plusKey, minusKey] = definition.derivedFrom
    const plus = inputs?.[plusKey]
    const minus = inputs?.[minusKey]
    if (!plus || !minus) throw new Error(`derived metric ${definition.metricKey} needs ${plusKey} and ${minusKey} series`)
    points = days.map((date, index) => {
      const a = plus[index]
      const b = minus[index]
      if (a?.value === null || b?.value === null || a?.value === undefined || b?.value === undefined) {
        const gap = [a, b].find((point) => point && point.quality !== QUALITY.OBSERVED && point.quality !== QUALITY.PARTIAL_DAY)
        return { date, value: null, organic: null, paid: null, quality: gap?.quality ?? QUALITY.DERIVED_INPUT_MISSING, unit: null }
      }
      if (a.unit !== b.unit) return { date, value: null, organic: null, paid: null, quality: QUALITY.PRECISION_UNSAFE, unit: null }
      return { date, value: a.value - b.value, organic: null, paid: null, quality: QUALITY.OBSERVED, unit: a.unit }
    })
  } else {
    const byGrain = latestRevisions(observations.filter((row) => row.metricKey === definition.metricKey))
    points = days.map((date) => storedPoint(definition, byGrain, date))
  }
  return points.map((point) => (partial.has(point.date) && point.value !== null
    ? { ...point, quality: QUALITY.PARTIAL_DAY }
    : point))
}

function stateFor(points, completeDays) {
  if (points.length > 0 && completeDays === points.length) return METRIC_STATE.READY
  if (points.some((point) => point.value !== null)) return METRIC_STATE.PARTIAL
  const gap = points.find((point) => point.quality !== QUALITY.OBSERVED && point.quality !== QUALITY.PARTIAL_DAY)
  return QUALITY_TO_STATE[gap?.quality] ?? METRIC_STATE.NOT_SYNCED
}

/**
 * Window total with its coverage. A total is a number only when every day is
 * complete, the units agree and the metric is additive (or the provider gave
 * an aggregate for exactly this window, for unique metrics).
 */
export function summarizeSeries(definition, points, { windowAggregate = null } = {}) {
  const completeDays = points.filter((point) => point.quality === QUALITY.OBSERVED).length
  const observedDays = points.filter((point) => point.value !== null).length
  const units = new Set(points.filter((point) => point.value !== null).map((point) => point.unit ?? null))
  const coverage = {
    expectedDays: points.length,
    observedDays,
    completeDays,
    firstDate: points[0]?.date ?? null,
    lastDate: points[points.length - 1]?.date ?? null,
  }
  const state = stateFor(points, completeDays)
  const unit = units.size === 1 ? [...units][0] : null

  if (units.size > 1) {
    return { total: null, unit: null, state: METRIC_STATE.ERROR, reasonCode: 'UNIT_MISMATCH', coverage }
  }

  if (definition.aggregation === AGGREGATION.NON_ADDITIVE_UNIQUE) {
    if (windowAggregate && windowAggregate.quality === QUALITY.OBSERVED && typeof windowAggregate.value === 'number') {
      return { total: windowAggregate.value, unit: windowAggregate.unit ?? unit, state, reasonCode: null, coverage }
    }
    return { total: null, unit, state, reasonCode: 'NON_ADDITIVE_UNIQUE', coverage }
  }

  if (completeDays !== points.length || points.length === 0) {
    return { total: null, unit, state, reasonCode: 'INCOMPLETE_COVERAGE', coverage }
  }
  const total = safeSum(points.map((point) => point.value))
  if (total === null) {
    return { total: null, unit, state: METRIC_STATE.ERROR, reasonCode: 'PRECISION_UNSAFE', coverage }
  }
  return { total, unit, state, reasonCode: null, coverage }
}

/**
 * Percent change versus the comparison window. Never Infinity, NaN or an
 * invented 100%: a missing or zero prior is a reason, not a number.
 */
export function periodChange(current, previous) {
  if (current?.total === null || current?.total === undefined) {
    return { changePct: null, changeReasonCode: 'CURRENT_INCOMPLETE' }
  }
  if (previous?.total === null || previous?.total === undefined) {
    return { changePct: null, changeReasonCode: 'PRIOR_INCOMPLETE' }
  }
  if (current.unit !== previous.unit) return { changePct: null, changeReasonCode: 'UNIT_MISMATCH' }
  if (previous.total === 0) return { changePct: null, changeReasonCode: 'PRIOR_ZERO' }
  const changePct = ((current.total - previous.total) / Math.abs(previous.total)) * 100
  return Number.isFinite(changePct)
    ? { changePct, changeReasonCode: null }
    : { changePct: null, changeReasonCode: 'PRECISION_UNSAFE' }
}
