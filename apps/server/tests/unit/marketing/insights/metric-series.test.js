import { describe, expect, it } from 'vitest'
import { getMetricDefinition } from '@/modules/marketing/insights/domain/metric-catalog'
import {
  QUALITY, METRIC_STATE, buildDailySeries, latestRevisions, periodChange, safeSum, summarizeSeries,
} from '@/modules/marketing/insights/domain/metric-series'
import { enumerateDays } from '@/modules/marketing/insights/domain/report-window'
import { dailyRows } from '../../../fixtures/marketing-insights/fixture-insights-repository'

const views = getMetricDefinition('views')
const viewers = getMetricDefinition('viewers')
const watchTime = getMetricDefinition('watch_time')
const days = enumerateDays('2026-09-01', '2026-09-03')
const A = 'fx-asset'

describe('daily series', () => {
  it('uses the ALL distribution and keeps organic/paid alongside it', () => {
    const rows = [
      ...dailyRows({ assetId: A, metricKey: 'views', from: '2026-09-01', to: '2026-09-03', base: 10 }),
      ...dailyRows({ assetId: A, metricKey: 'views', from: '2026-09-01', to: '2026-09-03', base: 7, distribution: 'ORGANIC' }),
      ...dailyRows({ assetId: A, metricKey: 'views', from: '2026-09-01', to: '2026-09-03', base: 3, distribution: 'PAID' }),
    ]
    const points = buildDailySeries(views, rows, days)
    expect(points[0]).toMatchObject({ date: '2026-09-01', value: 10, organic: 7, paid: 3, quality: QUALITY.OBSERVED })
  })

  it('adds organic + paid for an additive metric when ALL is absent', () => {
    const rows = [
      ...dailyRows({ assetId: A, metricKey: 'views', from: '2026-09-01', to: '2026-09-03', base: 7, distribution: 'ORGANIC' }),
      ...dailyRows({ assetId: A, metricKey: 'views', from: '2026-09-01', to: '2026-09-03', base: 3, distribution: 'PAID' }),
    ]
    expect(buildDailySeries(views, rows, days).map((point) => point.value)).toEqual([10, 12, 14])
  })

  it('never adds organic + paid unique viewers (the same person can be in both)', () => {
    const rows = [
      ...dailyRows({ assetId: A, metricKey: 'viewers', from: '2026-09-01', to: '2026-09-03', base: 7, distribution: 'ORGANIC', unit: 'people' }),
      ...dailyRows({ assetId: A, metricKey: 'viewers', from: '2026-09-01', to: '2026-09-03', base: 3, distribution: 'PAID', unit: 'people' }),
    ]
    const [point] = buildDailySeries(viewers, rows, days)
    expect(point).toMatchObject({ value: null, organic: 7, paid: 3, quality: QUALITY.UNIQUE_DISTRIBUTION_NOT_ADDITIVE })
  })

  it('renders a missing day as NOT_SYNCED, not zero, and keeps an observed zero as zero', () => {
    const rows = dailyRows({ assetId: A, metricKey: 'views', from: '2026-09-01', to: '2026-09-03', base: 0, skip: ['2026-09-02'] })
    const points = buildDailySeries(views, rows, days)
    expect(points.map((point) => [point.value, point.quality])).toEqual([
      [0, QUALITY.OBSERVED], [null, QUALITY.NOT_SYNCED], [2, QUALITY.OBSERVED],
    ])
  })

  it('keeps a provider refusal distinct from unsynced', () => {
    const rows = [{ assetId: A, metricKey: 'views', date: '2026-09-01', distribution: 'ALL', value: null, unit: 'count', quality: QUALITY.PERMISSION_DENIED, fetchedAt: '2026-09-02T00:00:00.000Z', revision: 1 }]
    expect(buildDailySeries(views, rows, days)[0].quality).toBe(QUALITY.PERMISSION_DENIED)
  })

  it('treats a correction as a revision of the same grain, never an addition', () => {
    const rows = [
      ...dailyRows({ assetId: A, metricKey: 'views', from: '2026-09-01', to: '2026-09-01', base: 50, revision: 1 }),
      ...dailyRows({ assetId: A, metricKey: 'views', from: '2026-09-01', to: '2026-09-01', base: 55, revision: 2 }),
    ]
    expect(latestRevisions(rows).size).toBe(1)
    expect(buildDailySeries(views, rows, ['2026-09-01'])[0].value).toBe(55)
  })

  it('derives net follows only where both inputs are observed for the same day', () => {
    const follows = getMetricDefinition('follows')
    const unfollows = getMetricDefinition('unfollows')
    const net = getMetricDefinition('net_follows')
    const rows = [
      ...dailyRows({ assetId: A, metricKey: 'follows', from: '2026-09-01', to: '2026-09-03', base: 10 }),
      ...dailyRows({ assetId: A, metricKey: 'unfollows', from: '2026-09-01', to: '2026-09-03', base: 4, skip: ['2026-09-03'] }),
    ]
    const inputs = { follows: buildDailySeries(follows, rows, days), unfollows: buildDailySeries(unfollows, rows, days) }
    const points = buildDailySeries(net, rows, days, { inputs })
    expect(points.map((point) => point.value)).toEqual([6, 6, null])
    expect(points[2].quality).toBe(QUALITY.NOT_SYNCED)
  })

  it('marks today as a partial day that keeps its value', () => {
    const rows = dailyRows({ assetId: A, metricKey: 'views', from: '2026-09-01', to: '2026-09-03' })
    const points = buildDailySeries(views, rows, days, { partialDates: ['2026-09-03'] })
    expect(points[2]).toMatchObject({ value: 102, quality: QUALITY.PARTIAL_DAY })
  })
})

describe('window totals', () => {
  it('sums an additive metric only with complete coverage', () => {
    const complete = buildDailySeries(views, dailyRows({ assetId: A, metricKey: 'views', from: '2026-09-01', to: '2026-09-03' }), days)
    expect(summarizeSeries(views, complete)).toMatchObject({ total: 303, state: METRIC_STATE.READY, reasonCode: null })

    const gappy = buildDailySeries(views, dailyRows({ assetId: A, metricKey: 'views', from: '2026-09-01', to: '2026-09-03', skip: ['2026-09-02'] }), days)
    expect(summarizeSeries(views, gappy)).toMatchObject({
      total: null, state: METRIC_STATE.PARTIAL, reasonCode: 'INCOMPLETE_COVERAGE',
      coverage: { expectedDays: 3, observedDays: 2, completeDays: 2 },
    })
  })

  it('does not count a partial day as complete', () => {
    const points = buildDailySeries(views, dailyRows({ assetId: A, metricKey: 'views', from: '2026-09-01', to: '2026-09-03' }), days, { partialDates: ['2026-09-03'] })
    expect(summarizeSeries(views, points)).toMatchObject({ total: null, reasonCode: 'INCOMPLETE_COVERAGE' })
  })

  it('never sums unique viewers across days; uses an exact-window provider aggregate when present', () => {
    const points = buildDailySeries(viewers, dailyRows({ assetId: A, metricKey: 'viewers', from: '2026-09-01', to: '2026-09-03', unit: 'people' }), days)
    expect(summarizeSeries(viewers, points)).toMatchObject({ total: null, reasonCode: 'NON_ADDITIVE_UNIQUE' })
    const aggregate = { value: 180, unit: 'people', quality: QUALITY.OBSERVED }
    expect(summarizeSeries(viewers, points, { windowAggregate: aggregate })).toMatchObject({ total: 180, reasonCode: null })
  })

  it('refuses a window whose watch-time units disagree instead of converting by guess', () => {
    const rows = [
      ...dailyRows({ assetId: A, metricKey: 'watch_time', from: '2026-09-01', to: '2026-09-02', unit: 'ms' }),
      ...dailyRows({ assetId: A, metricKey: 'watch_time', from: '2026-09-03', to: '2026-09-03', unit: 's' }),
    ]
    const points = buildDailySeries(watchTime, rows, days)
    expect(summarizeSeries(watchTime, points)).toMatchObject({ total: null, state: METRIC_STATE.ERROR, reasonCode: 'UNIT_MISMATCH' })
  })

  it('refuses a sum that would lose integer precision', () => {
    expect(safeSum([Number.MAX_SAFE_INTEGER, 1])).toBeNull()
    expect(safeSum([1, 2, 3])).toBe(6)
    expect(safeSum([1, Number.NaN])).toBeNull()
  })
})

describe('period change', () => {
  it('computes a signed percent against a complete, non-zero prior', () => {
    expect(periodChange({ total: 150, unit: 'count' }, { total: 100, unit: 'count' })).toEqual({ changePct: 50, changeReasonCode: null })
    expect(periodChange({ total: 50, unit: 'count' }, { total: 100, unit: 'count' })).toEqual({ changePct: -50, changeReasonCode: null })
  })

  it('returns a reason, never Infinity/NaN/100%, for zero or missing priors', () => {
    expect(periodChange({ total: 10, unit: 'count' }, { total: 0, unit: 'count' })).toEqual({ changePct: null, changeReasonCode: 'PRIOR_ZERO' })
    expect(periodChange({ total: 10, unit: 'count' }, { total: null, unit: 'count' })).toEqual({ changePct: null, changeReasonCode: 'PRIOR_INCOMPLETE' })
    expect(periodChange({ total: null, unit: 'count' }, { total: 10, unit: 'count' })).toEqual({ changePct: null, changeReasonCode: 'CURRENT_INCOMPLETE' })
    expect(periodChange({ total: 0, unit: 'count' }, { total: 0, unit: 'count' })).toEqual({ changePct: null, changeReasonCode: 'PRIOR_ZERO' })
  })
})
