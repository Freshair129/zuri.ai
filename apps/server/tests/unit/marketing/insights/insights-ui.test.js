import React, { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createInsightsQueryService } from '@/modules/marketing/insights/application/insights-query-service'
import { InsightsOverview, InsightsResults, InsightsContent, MetricCard } from '@/modules/marketing/insights/ui/InsightsViews'
import { MetricChart, Sparkline } from '@/modules/marketing/insights/ui/InsightsCharts'
import InsightsLayout, { InsightsBody } from '@/modules/marketing/insights/ui/InsightsLayout'
import { loadInsightsTab, acceptsResponse } from '@/modules/marketing/insights/ui/insights-loader'
import {
  readInsightsSelection, insightsSearch, insightsApiPath, formatDuration, formatChange, formatCount, lineSegments, reasonText,
} from '@/modules/marketing/insights/ui/insights-format'
import {
  createFixtureRepository, createFixtureBindingPort, dailyRows, contentItem, FX_BUSINESS,
} from '../../../fixtures/marketing-insights/fixture-insights-repository'

// The vitest config uses the classic JSX runtime (same as error-events-view.test.js).
globalThis.React = React

const NOW = () => new Date('2026-09-21T03:00:00.000Z')
const ALL = (binding) => Object.values(FX_BUSINESS).includes(binding.businessId)
const PAGE_A = 'fx-asset-infresh-page-a'
// Test-only base; the real namespace is decided when routes land (R-11).
const API = '/api/insights'
const html = (component, props) => renderToStaticMarkup(createElement(component, props))

function svc(repo = {}) {
  return createInsightsQueryService({ repository: createFixtureRepository(repo), bindingPort: createFixtureBindingPort(), now: NOW })
}

describe('format helpers', () => {
  it('formats Thai numbers, signed change and known duration units only', () => {
    expect(formatCount(1234567)).toBe('1,234,567')
    expect(formatCount(null)).toBeNull()
    expect(formatChange(12.345)).toBe('+12.3%')
    expect(formatChange(-5)).toBe('−5%')
    expect(formatChange(null)).toBeNull()
    expect(formatDuration(5_400_000, 'ms')).toBe('1 ชม. 30 นาที')
    expect(formatDuration(90, 's')).toBe('1 นาที')
    expect(formatDuration(90, 'duration')).toBeNull()
  })

  it('breaks lines at missing days instead of drawing zero', () => {
    expect(lineSegments([1, 2, null, 4, 5], { width: 40, height: 10 })).toHaveLength(2)
    expect(lineSegments([null, null], { width: 40, height: 10 })).toEqual([])
  })

  it('reads URL selection defensively and writes shareable state', () => {
    expect(readInsightsSelection(new URLSearchParams('brand=evil&tab=boost&type=x&from=2026-09-01'))).toEqual({
      brand: null, asset: null, from: null, to: null, tab: 'overview', type: 'all',
    })
    const selection = readInsightsSelection(new URLSearchParams('brand=056laos&tab=content&type=reel&from=2026-09-01&to=2026-09-07'))
    expect(selection).toMatchObject({ brand: '056laos', tab: 'content', type: 'reel', from: '2026-09-01', to: '2026-09-07' })
    expect(insightsSearch(selection)).toBe('brand=056laos&from=2026-09-01&to=2026-09-07&tab=content&type=reel')
    expect(insightsApiPath('export', selection, { apiBase: API, metricKey: 'views', snapshot: 's1' }))
      .toBe('/api/insights/metric/views/export?brand=056laos&from=2026-09-01&to=2026-09-07&snapshot=s1')
    expect(() => insightsApiPath('summary', selection)).toThrow(/apiBase/)
  })

  it('has Thai copy for every reason the service emits', () => {
    for (const code of ['NOT_SYNCED', 'INCOMPLETE_COVERAGE', 'NON_ADDITIVE_UNIQUE', 'PRIOR_ZERO', 'PRIOR_INCOMPLETE', 'CURRENT_INCOMPLETE', 'UNIT_MISMATCH', 'ITEM_METRIC_MISSING', 'SCOPE_NOT_FOUND', 'SNAPSHOT_EXPIRED']) {
      expect(reasonText(code), code).not.toBe('ไม่มีข้อมูล')
    }
  })
})

describe('Overview', () => {
  it('renders unsynced cards as reasons, never zeros, and Conversions as a labelled placeholder', async () => {
    const { data } = await svc().getSummary({ query: { brand: 'glowcea' }, canRead: ALL })
    const markup = html(InsightsOverview, { summary: data, resultsHref: (key) => `/r#${key}` })
    expect(markup).toContain('ยังไม่มีข้อมูลที่ซิงก์')
    expect(markup).toContain('ยังไม่เชื่อมข้อมูล')
    expect(markup).not.toMatch(/>0</)
    expect(markup).toContain('ไม่มีข้อมูลสำหรับกราฟ')
  })

  it('shows a formatted total, the change and a sparkline when coverage is complete', async () => {
    const observations = [
      ...dailyRows({ assetId: PAGE_A, metricKey: 'views', from: '2026-07-27', to: '2026-08-23', base: 1000 }),
      ...dailyRows({ assetId: PAGE_A, metricKey: 'views', from: '2026-08-24', to: '2026-09-20', base: 2000 }),
    ]
    const { data } = await svc({ observations }).getSummary({ query: { brand: 'infresh' }, canRead: ALL })
    const views = data.find((item) => item.metricKey === 'views')
    const markup = html(MetricCard, { cardKey: 'views', items: [views], resultsHref: () => '/r' })
    expect(markup).toContain('56,378') // 2000..2027 summed
    expect(markup).toMatch(/\+\d+(\.\d)?% เทียบช่วงก่อนหน้า/)
    expect(markup).toContain('<polyline')
  })
})

describe('Results', () => {
  it('draws one chart per metric with an export link pinned to the snapshot', async () => {
    const service = svc({ observations: dailyRows({ assetId: PAGE_A, metricKey: 'visits', from: '2026-08-24', to: '2026-09-20' }) })
    const visits = await service.getMetricSeries({ metricKey: 'visits', query: { brand: 'infresh' }, canRead: ALL })
    const markup = html(InsightsResults, { series: { visits }, exportHref: (key, snap) => `/x/${key}?snapshot=${snap}` })
    expect(markup).toContain('การเข้าชมเพจ')
    expect(markup).toContain(`/x/visits?snapshot=${visits.meta.snapshot.snapshotId}`)
    expect(markup).toContain('ดูเป็นตาราง')
  })

  it('renders no chart for a metric with no values', () => {
    const markup = html(MetricChart, { title: 'x', points: [{ date: '2026-09-01', organic: null, paid: null, value: null, quality: 'NOT_SYNCED', unit: null }] })
    expect(markup).not.toContain('<polyline')
    expect(markup).toContain('ยังไม่มีข้อมูลที่ซิงก์')
    expect(html(Sparkline, { values: [null], label: 'v' })).toContain('ไม่มีข้อมูลสำหรับกราฟ')
  })
})

describe('Content', () => {
  it('states the cohort semantics, lists top content and offers no write actions', async () => {
    const items = [
      contentItem({ contentId: 'fx-c1', providerPostId: 'fx-p1', views: 100, publishedAt: '2026-09-10T05:00:00.000Z' }),
      contentItem({ contentId: 'fx-c2', providerPostId: 'fx-p2', contentType: 'reel', format: 'video', views: 500, publishedAt: '2026-09-11T05:00:00.000Z' }),
    ]
    const content = await svc({ items }).getContent({ query: { brand: 'infresh' }, canRead: ALL })
    const markup = html(InsightsContent, { content, type: 'all' })
    expect(markup).toContain('ยอดสะสมตลอดอายุโพสต์')
    expect(markup).toContain('ดูบน Facebook')
    expect(markup).toContain('rel="noopener noreferrer"')
    expect(markup).toContain('aria-pressed="true"')
    expect(markup).not.toMatch(/boost|โปรโมต|แก้ไข|เผยแพร่โพสต์|publish/i)
    expect(markup.indexOf('fx-c2') === -1).toBe(true) // ids are not rendered as text
  })
})

describe('layout and loading', () => {
  it('renders the shell with idle and loading states', () => {
    const idle = html(InsightsLayout, { selection: readInsightsSelection(new URLSearchParams('')), brands: ['infresh'], today: '2026-09-21', load: async () => ({}), apiBase: API })
    expect(idle).toContain('เลือกแบรนด์เพื่อดู Insights')
    expect(idle).toContain('ภาพรวม')
    const loading = html(InsightsLayout, { selection: readInsightsSelection(new URLSearchParams('brand=infresh')), brands: ['infresh'], today: '2026-09-21', load: async () => ({}), apiBase: API })
    expect(loading).toContain('กำลังโหลดข้อมูล')
    expect(loading).toContain('value="infresh" selected=""')
  })

  it('loads every Results metric and keeps per-metric failures local', async () => {
    const service = svc()
    const urls = []
    const load = async (url) => {
      urls.push(url)
      const metricKey = decodeURIComponent(url.split('/api/insights/metric/')[1].split('?')[0])
      if (metricKey === 'watch_time') throw Object.assign(new Error('x'), { code: 'SOURCE_UNAVAILABLE' })
      return service.getMetricSeries({ metricKey, query: Object.fromEntries(new URL(url, 'http://x').searchParams), canRead: ALL })
    }
    const selection = readInsightsSelection(new URLSearchParams('brand=infresh&tab=results'))
    const result = await loadInsightsTab({ tab: 'results', selection, load, apiBase: API })
    expect(urls).toHaveLength(10)
    expect(result.errors).toEqual({ watch_time: 'SOURCE_UNAVAILABLE' })
    expect(Object.keys(result.series)).toHaveLength(9)
    expect(html(InsightsBody, { result, selection })).toContain('watch_time')
  })

  it('drops a response that answers an older selection', async () => {
    const service = svc()
    const load = async (url) => service.getSummary({ query: Object.fromEntries(new URL(url, 'http://x').searchParams), canRead: ALL })
    const infresh = readInsightsSelection(new URLSearchParams('brand=infresh'))
    const glowcea = readInsightsSelection(new URLSearchParams('brand=glowcea'))
    const response = await loadInsightsTab({ tab: 'overview', selection: infresh, load, apiBase: API })
    expect(acceptsResponse(infresh, response)).toBe(true)
    expect(acceptsResponse(glowcea, response)).toBe(false)
    expect(acceptsResponse({ ...infresh, from: '2026-09-01', to: '2026-09-07' }, response)).toBe(false)
    expect(acceptsResponse({ ...infresh, tab: 'results' }, response)).toBe(false)
  })
})
