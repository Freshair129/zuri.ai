import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { makeViewer } from '../../../factories/viewer'
import { insightsGet, csvResponse, INSIGHTS_NOT_CONFIGURED } from '@/app/api/insights/_insights-http'
import { getInsightsQueryService } from '@/modules/marketing/insights/application/insights-runtime'
import { createInsightsQueryService } from '@/modules/marketing/insights/application/insights-query-service'
import { loadInsightsJson } from '@/modules/marketing/insights/ui/insights-page-loader'
import {
  createFixtureRepository, createFixtureBindingPort, dailyRows, FX_BUSINESS,
} from '../../../fixtures/marketing-insights/fixture-insights-repository'

const NOW = () => new Date('2026-09-21T03:00:00.000Z')
const PAGE_A = 'fx-asset-infresh-page-a'
const infreshMember = makeViewer({ principal: { id: 'fx-member' }, visibleBusinessIds: [FX_BUSINESS.infresh], visibleDomains: ['growth'] })

function fixtureService() {
  const observations = dailyRows({ assetId: PAGE_A, metricKey: 'views', from: '2026-07-27', to: '2026-09-20', base: 0 })
  return createInsightsQueryService({ repository: createFixtureRepository({ observations }), bindingPort: createFixtureBindingPort(), now: NOW })
}

function handler(read, { service = fixtureService(), viewer = infreshMember } = {}) {
  return insightsGet(read, { getService: () => service, resolveViewer: async () => viewer })
}

const get = (path) => new Request(`http://localhost${path}`)
const ROUTES = [
  'src/app/api/insights/brands/route.js',
  'src/app/api/insights/summary/route.js',
  'src/app/api/insights/metric/[metricKey]/route.js',
  'src/app/api/insights/metric/[metricKey]/export/route.js',
  'src/app/api/insights/content/route.js',
]

describe('Insights routes (FR-275)', () => {
  it('has no reporting source in this release, so every route answers 503 INSIGHTS_NOT_CONFIGURED', async () => {
    expect(getInsightsQueryService()).toBeNull()
    const GET = insightsGet(({ service }) => service.listBrands({ canRead: () => true }), { resolveViewer: async () => infreshMember })
    const response = await GET(get('/api/insights/brands'))
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: INSIGHTS_NOT_CONFIGURED })
  })

  it('authenticates before anything else', async () => {
    const refusal = Object.assign(new Error('Authentication required'), { status: 401 })
    const read = vi.fn()
    const GET = insightsGet(read, { getService: () => fixtureService(), resolveViewer: async () => { throw refusal } })
    const response = await GET(get('/api/insights/summary?brand=infresh'))
    expect(response.status).toBe(401)
    expect(read).not.toHaveBeenCalled()
  })

  it('lists only brands whose Business the viewer sees with the growth domain', async () => {
    const GET = handler(({ service, canRead }) => service.listBrands({ canRead }))
    expect((await (await GET(get('/api/insights/brands'))).json()).data).toEqual(['infresh'])
  })

  it('returns the summary for a readable brand and a typed code for a denied one', async () => {
    const GET = handler(({ service, query, canRead }) => service.getSummary({ query, canRead }))
    const ok = await GET(get('/api/insights/summary?brand=infresh'))
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.data.find((item) => item.metricKey === 'views')).toMatchObject({ metricKey: 'views' })
    expect(body.meta).toMatchObject({ brand: 'infresh', source: 'REPORTING_READ_MODEL' })

    const denied = await GET(get('/api/insights/summary?brand=glowcea'))
    expect(denied.status).toBe(404)
    expect((await denied.json()).code).toBe('SCOPE_NOT_FOUND')
  })

  it('reads the metric key from the route params and rejects an invalid query with its code', async () => {
    const GET = handler(({ service, query, canRead, params }) => service.getMetricSeries({ metricKey: params.metricKey, query, canRead }))
    const ok = await GET(get('/api/insights/metric/views?brand=infresh'), { params: Promise.resolve({ metricKey: 'views' }) })
    expect(ok.status).toBe(200)
    expect(Array.isArray((await ok.json()).data)).toBe(true)

    const unknown = await GET(get('/api/insights/metric/nope?brand=infresh'), { params: Promise.resolve({ metricKey: 'nope' }) })
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).code).toBe('INVALID_QUERY')
  })

  it('exports the series as a CSV attachment that is never cached', async () => {
    const GET = handler(async ({ service, query, canRead, params }) => csvResponse(await service.exportMetricCsv({ metricKey: params.metricKey, query, canRead })))
    const response = await GET(get('/api/insights/metric/views/export?brand=infresh'), { params: Promise.resolve({ metricKey: 'views' }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="insights-infresh-views-[0-9-]+-[0-9-]+\.csv"$/)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await response.text()).length).toBeGreaterThan(0)
  })

  it('declares FR-275 on every route file and reads only through the query service', () => {
    for (const file of ROUTES) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).toContain('@req FR-275')
      expect(source, file).toContain('insightsGet(')
      expect(source, file).not.toMatch(/graph\.facebook|fetch\(|prisma/i)
    }
  })
})

describe('Insights page loader', () => {
  it('returns the JSON body on success and keeps the typed code on a refusal', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ data: ['infresh'] }), { status: 200 }))
    expect(await loadInsightsJson('/api/insights/brands', { fetchImpl: ok })).toEqual({ data: ['infresh'] })

    const off = vi.fn(async () => new Response(JSON.stringify({ error: 'off', code: INSIGHTS_NOT_CONFIGURED }), { status: 503 }))
    await expect(loadInsightsJson('/api/insights/brands', { fetchImpl: off })).rejects.toMatchObject({ code: INSIGHTS_NOT_CONFIGURED, status: 503 })
  })
})
