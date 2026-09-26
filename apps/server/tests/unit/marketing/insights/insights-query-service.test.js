import { describe, expect, it } from 'vitest'
import { createInsightsQueryService } from '@/modules/marketing/insights/application/insights-query-service'
import { BRAND_SLUGS } from '@/modules/marketing/insights/domain/brand-scope'
import {
  createFixtureRepository, createFixtureBindingPort, dailyRows, contentItem, FX_BUSINESS,
} from '../../../fixtures/marketing-insights/fixture-insights-repository'

const NOW = () => new Date('2026-09-21T03:00:00.000Z') // 2026-09-21 10:00 Bangkok
const ALL_BRANDS = (binding) => Object.values(FX_BUSINESS).includes(binding.businessId)
const ONLY = (businessId) => (binding) => binding.businessId === businessId
const PAGE_A = 'fx-asset-infresh-page-a'
// Default window: 2026-08-24..2026-09-20; comparison 2026-07-27..2026-08-23.
const W = { from: '2026-08-24', to: '2026-09-20', pFrom: '2026-07-27', pTo: '2026-08-23' }

function service(repoArgs = {}) {
  const repository = createFixtureRepository(repoArgs)
  return { repository, svc: createInsightsQueryService({ repository, bindingPort: createFixtureBindingPort(), now: NOW }) }
}

describe('summary', () => {
  it('keeps the contract §6 item shape and computes total/change over complete coverage', async () => {
    const observations = [
      ...dailyRows({ assetId: PAGE_A, metricKey: 'views', from: W.pFrom, to: W.pTo, base: 0 }),
      ...dailyRows({ assetId: PAGE_A, metricKey: 'views', from: W.from, to: W.to, base: 0 }),
    ]
    const { svc } = service({ observations })
    const { data, meta } = await svc.getSummary({ query: { brand: 'infresh' }, canRead: ALL_BRANDS })
    const views = data.find((item) => item.metricKey === 'views')
    expect(Object.keys(views)).toEqual(expect.arrayContaining(['metricKey', 'total', 'changePct', 'series']))
    // 0..27 per window
    expect(views).toMatchObject({ total: 378, previousTotal: 378, changePct: 0, state: 'READY' })
    expect(views.series).toHaveLength(28)
    expect(views.series[0]).toEqual({ date: W.from, value: 0 })
    expect(meta).toMatchObject({ brand: 'infresh', asset: { assetId: PAGE_A }, window: { from: W.from, to: W.to, days: 28 }, source: 'REPORTING_READ_MODEL' })
  })

  it('reports unsynced metrics as null with a reason — never 0', async () => {
    const { svc } = service()
    const { data } = await svc.getSummary({ query: { brand: 'glowcea' }, canRead: ALL_BRANDS })
    for (const item of data) {
      expect(item.total, item.metricKey).toBeNull()
      expect(item.changePct, item.metricKey).toBeNull()
      expect(item.series.every((point) => point.value === null)).toBe(true)
      expect(['NOT_SYNCED']).toContain(item.state)
    }
  })

  it('does not compute a change when the prior window is incomplete', async () => {
    const observations = dailyRows({ assetId: PAGE_A, metricKey: 'visits', from: W.from, to: W.to })
    const { svc } = service({ observations })
    const { data } = await svc.getSummary({ query: { brand: 'infresh' }, canRead: ALL_BRANDS })
    expect(data.find((item) => item.metricKey === 'visits')).toMatchObject({ changePct: null, changeReasonCode: 'PRIOR_INCOMPLETE', previousTotal: null })
  })

  it('reads a 56-day span for the one exact asset, through the server-owned binding scope', async () => {
    const { svc, repository } = service()
    await svc.getSummary({ query: { brand: 'infresh', asset: 'fx-asset-infresh-page-b' }, canRead: ALL_BRANDS })
    expect(repository.calls[0]).toMatchObject({
      method: 'readDailyObservations', assetId: 'fx-asset-infresh-page-b',
      tenantId: 'fx-tenant-1', businessId: FX_BUSINESS.infresh, from: W.pFrom, to: W.to,
    })
  })
})

describe('isolation across all three brands', () => {
  it('each brand reads only its own asset, and a viewer of one brand cannot read the others', async () => {
    const observations = [
      ...dailyRows({ assetId: PAGE_A, metricKey: 'views', from: W.from, to: W.to, base: 1000 }),
      ...dailyRows({ assetId: 'fx-asset-glowcea-page', metricKey: 'views', from: W.from, to: W.to, base: 2000 }),
      ...dailyRows({ assetId: 'fx-asset-056laos-page', metricKey: 'views', from: W.from, to: W.to, base: 3000 }),
    ]
    const { svc } = service({ observations })
    const firstViews = {}
    for (const brand of BRAND_SLUGS) {
      const { data, meta } = await svc.getSummary({ query: { brand }, canRead: ALL_BRANDS })
      firstViews[brand] = data.find((item) => item.metricKey === 'views').series[0].value
      expect(meta.brand).toBe(brand)
    }
    expect(firstViews).toEqual({ infresh: 1000, glowcea: 2000, '056laos': 3000 })

    for (const brand of ['glowcea', '056laos']) {
      await expect(svc.getSummary({ query: { brand }, canRead: ONLY(FX_BUSINESS.infresh) }))
        .rejects.toMatchObject({ code: 'SCOPE_NOT_FOUND', status: 404 })
      await expect(svc.getContent({ query: { brand }, canRead: ONLY(FX_BUSINESS.infresh) }))
        .rejects.toMatchObject({ code: 'SCOPE_NOT_FOUND', status: 404 })
    }
  })

  it('fails the whole read when the repository returns a row from another asset', async () => {
    const repository = createFixtureRepository()
    repository.readDailyObservations = async () => ({
      snapshot: { snapshotId: 's', generatedAt: '2026-09-20T19:05:00.000Z', coveredUntil: '2026-09-20', state: 'COMPLETE', partialReason: null },
      observations: dailyRows({ assetId: 'fx-asset-glowcea-page', metricKey: 'views', from: W.from, to: W.from }),
      windowAggregates: [],
    })
    const svc = createInsightsQueryService({ repository, bindingPort: createFixtureBindingPort(), now: NOW })
    await expect(svc.getSummary({ query: { brand: 'infresh' }, canRead: ALL_BRANDS }))
      .rejects.toMatchObject({ code: 'SCOPE_MISMATCH', status: 500 })
  })
})

describe('metric series and CSV export', () => {
  it('returns {date, organic, paid} rows and a CSV with the same values', async () => {
    const observations = [
      ...dailyRows({ assetId: PAGE_A, metricKey: 'views', from: W.from, to: W.to, base: 10, distribution: 'ORGANIC' }),
      ...dailyRows({ assetId: PAGE_A, metricKey: 'views', from: W.from, to: W.to, base: 5, distribution: 'PAID' }),
    ]
    const { svc } = service({ observations })
    const series = await svc.getMetricSeries({ metricKey: 'views', query: { brand: 'infresh' }, canRead: ALL_BRANDS })
    expect(series.data[0]).toEqual({ date: W.from, organic: 10, paid: 5, value: 15, quality: 'OBSERVED', unit: 'count' })

    const exported = await svc.exportMetricCsv({ metricKey: 'views', query: { brand: 'infresh', snapshot: series.meta.snapshot.snapshotId }, canRead: ALL_BRANDS })
    expect(exported.filename).toBe(`insights-infresh-views-${W.from}-${W.to}.csv`)
    const lines = exported.body.replace('﻿', '').trim().split('\r\n').slice(1)
    expect(lines).toHaveLength(series.data.length)
    lines.forEach((line, index) => {
      const [date, organic, paid, total] = line.split(',')
      const point = series.data[index]
      expect([date, Number(organic), Number(paid), Number(total)]).toEqual([point.date, point.organic, point.paid, point.value])
    })
  })

  it('refuses to export from an expired snapshot rather than silently exporting newer numbers', async () => {
    const { svc } = service()
    await expect(svc.exportMetricCsv({ metricKey: 'views', query: { brand: 'infresh', snapshot: 'fx-snap-stale' }, canRead: ALL_BRANDS }))
      .rejects.toMatchObject({ status: 409 })
  })

  it('computes net follows from its two stored inputs', async () => {
    const observations = [
      ...dailyRows({ assetId: PAGE_A, metricKey: 'follows', from: W.from, to: W.to, base: 10 }),
      ...dailyRows({ assetId: PAGE_A, metricKey: 'unfollows', from: W.from, to: W.to, base: 3 }),
    ]
    const { svc, repository } = service({ observations })
    const { data } = await svc.getMetricSeries({ metricKey: 'net_follows', query: { brand: 'infresh' }, canRead: ALL_BRANDS })
    expect(repository.calls[0].metricKeys).toEqual(['follows', 'unfollows', 'net_follows'])
    expect(data.every((point) => point.value === 7)).toBe(true)
  })

  it('validates metric, dates and unknown parameters strictly', async () => {
    const { svc } = service()
    await expect(svc.getMetricSeries({ metricKey: 'spend', query: { brand: 'infresh' }, canRead: ALL_BRANDS })).rejects.toMatchObject({ code: 'INVALID_QUERY', status: 400 })
    await expect(svc.getSummary({ query: { brand: 'infresh', from: '2026-09-01' }, canRead: ALL_BRANDS })).rejects.toMatchObject({ code: 'INVALID_QUERY' })
    await expect(svc.getSummary({ query: { brand: 'infresh', page_id: '123' }, canRead: ALL_BRANDS })).rejects.toMatchObject({ code: 'INVALID_QUERY' })
    await expect(svc.getContent({ query: { brand: 'infresh', type: 'boost' }, canRead: ALL_BRANDS })).rejects.toMatchObject({ code: 'INVALID_QUERY' })
  })
})

describe('content', () => {
  const items = [
    contentItem({ contentId: 'fx-c1', providerPostId: 'fx-p1', contentType: 'post', format: 'photo', views: 100, interactions: 10, publishedAt: '2026-09-10T05:00:00.000Z' }),
    contentItem({ contentId: 'fx-c2', providerPostId: 'fx-p2', contentType: 'reel', format: 'video', views: 500, interactions: 50, publishedAt: '2026-09-11T05:00:00.000Z' }),
    contentItem({ contentId: 'fx-c0', providerPostId: 'fx-p0', contentType: 'post', format: 'photo', views: 80, interactions: 8, publishedAt: '2026-08-10T05:00:00.000Z' }),
  ]

  it('returns the contract object and labels the cohort and metric period', async () => {
    const { svc } = service({ items })
    const { data, meta } = await svc.getContent({ query: { brand: 'infresh' }, canRead: ALL_BRANDS })
    expect(Object.keys(data)).toEqual(['summary', 'topContent', 'byFormat'])
    expect(data.summary).toMatchObject({ views: 600, interactions: 60 })
    expect(data.topContent.map((row) => row.postId)).toEqual(['fx-p2', 'fx-p1'])
    expect(meta).toMatchObject({ cohort: 'PUBLISHED_IN_WINDOW', metricPeriod: 'LIFETIME_AS_OF_SYNC', type: 'all', itemCount: 2, previousItemCount: 1 })
  })

  it('narrows summary, topContent and byFormat together with the type filter', async () => {
    const { svc } = service({ items })
    const { data } = await svc.getContent({ query: { brand: 'infresh', type: 'reel' }, canRead: ALL_BRANDS })
    expect(data.summary.views).toBe(500)
    expect(data.topContent.map((row) => row.postId)).toEqual(['fx-p2'])
    const published = data.byFormat.find((entry) => entry.metric === 'published').breakdown
    expect(published).toEqual([expect.objectContaining({ label: 'video', value: 1 })])
  })
})
