import { beforeEach, describe, expect, it, vi } from 'vitest'
import { makeViewer } from '../../../factories/viewer'
import { createInsightsQueryService } from '@/modules/marketing/insights/application/insights-query-service'
import { loadInsightsJson } from '@/app/(pm)/growth/insights/load-insights-json'
import {
  createFixtureRepository, createFixtureBindingPort, dailyRows, FX_BUSINESS,
} from '../../../fixtures/marketing-insights/fixture-insights-repository'

// The real route modules are exercised; only the service seam and the viewer resolver are replaced.
const seam = vi.hoisted(() => ({ service: null, viewer: null, viewerError: null }))
vi.mock('@/modules/marketing/insights/application/insights-runtime', () => ({ getInsightsQueryService: () => seam.service }))
vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: async () => {
    if (seam.viewerError) throw seam.viewerError
    return seam.viewer
  },
}))

const { GET: brandsGET } = await import('@/app/api/insights/brands/route')
const { GET: summaryGET } = await import('@/app/api/insights/summary/route')
const { GET: metricGET } = await import('@/app/api/insights/metric/[metricKey]/route')
const { GET: exportGET } = await import('@/app/api/insights/metric/[metricKey]/export/route')
const { GET: contentGET } = await import('@/app/api/insights/content/route')

const NOW = () => new Date('2026-09-21T03:00:00.000Z')
const PAGE_A = 'fx-asset-infresh-page-a'
const infreshMember = makeViewer({ principal: { id: 'fx-member' }, visibleBusinessIds: [FX_BUSINESS.infresh], visibleDomains: ['growth'] })
const ALL_ROUTES = [
  [brandsGET, '/api/insights/brands', undefined],
  [summaryGET, '/api/insights/summary?brand=infresh', undefined],
  [metricGET, '/api/insights/metric/views?brand=infresh', { params: Promise.resolve({ metricKey: 'views' }) }],
  [exportGET, '/api/insights/metric/views/export?brand=infresh', { params: Promise.resolve({ metricKey: 'views' }) }],
  [contentGET, '/api/insights/content?brand=infresh', undefined],
]

function fixtureService() {
  const observations = dailyRows({ assetId: PAGE_A, metricKey: 'views', from: '2026-07-27', to: '2026-09-20', base: 0 })
  return createInsightsQueryService({ repository: createFixtureRepository({ observations }), bindingPort: createFixtureBindingPort(), now: NOW })
}

const get = (path) => new Request(`http://localhost${path}`)

beforeEach(() => {
  seam.service = null
  seam.viewer = infreshMember
  seam.viewerError = null
})

describe('Insights routes (FR-275) — release wiring', () => {
  it('the real runtime has no reporting source in this release', async () => {
    const actual = await vi.importActual('@/modules/marketing/insights/application/insights-runtime')
    expect(actual.getInsightsQueryService()).toBeNull()
  })

  it.each(ALL_ROUTES)('%#: with no source, a signed-in viewer gets 503 INSIGHTS_NOT_CONFIGURED', async (GET, path, context) => {
    const response = await GET(get(path), context)
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ code: 'INSIGHTS_NOT_CONFIGURED' })
  })

  it.each(ALL_ROUTES)('%#: an unauthenticated request gets 401 before the source is consulted', async (GET, path, context) => {
    seam.viewerError = Object.assign(new Error('Authentication required'), { status: 401 })
    const response = await GET(get(path), context)
    expect(response.status).toBe(401)
  })
})

describe('Insights routes (FR-275) — with the synthetic fixture repository injected', () => {
  beforeEach(() => { seam.service = fixtureService() })

  it('lists only brands whose Business the viewer sees with the growth domain', async () => {
    expect((await (await brandsGET(get('/api/insights/brands'))).json()).data).toEqual(['infresh'])
  })

  it('returns the summary for a readable brand and one shape for a denied or unknown brand', async () => {
    const ok = await summaryGET(get('/api/insights/summary?brand=infresh'))
    expect(ok.status).toBe(200)
    const body = await ok.json()
    expect(body.data.find((item) => item.metricKey === 'views')).toMatchObject({ metricKey: 'views' })
    expect(body.meta).toMatchObject({ brand: 'infresh', source: 'REPORTING_READ_MODEL' })

    for (const brand of ['glowcea', 'nope']) {
      const denied = await summaryGET(get(`/api/insights/summary?brand=${brand}`))
      expect(denied.status, brand).toBe(404)
      expect((await denied.json()).code, brand).toBe('SCOPE_NOT_FOUND')
    }
  })

  it('reads the metric key from the route params and rejects an unknown metric with INVALID_QUERY', async () => {
    const ok = await metricGET(get('/api/insights/metric/views?brand=infresh'), { params: Promise.resolve({ metricKey: 'views' }) })
    expect(ok.status).toBe(200)
    expect(Array.isArray((await ok.json()).data)).toBe(true)

    const unknown = await metricGET(get('/api/insights/metric/nope?brand=infresh'), { params: Promise.resolve({ metricKey: 'nope' }) })
    expect(unknown.status).toBe(400)
    expect((await unknown.json()).code).toBe('INVALID_QUERY')
  })

  it('exports the series as a CSV attachment that is never cached', async () => {
    const response = await exportGET(get('/api/insights/metric/views/export?brand=infresh'), { params: Promise.resolve({ metricKey: 'views' }) })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toMatch(/^attachment; filename="insights-infresh-views-[0-9-]+-[0-9-]+\.csv"$/)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect((await response.text()).length).toBeGreaterThan(0)
  })

  it('returns content performance for a readable brand', async () => {
    const response = await contentGET(get('/api/insights/content?brand=infresh'))
    expect(response.status).toBe(200)
    expect((await response.json()).meta).toMatchObject({ brand: 'infresh' })
  })
})

describe('Insights page loader', () => {
  it('returns the JSON body on success and keeps the typed code on a refusal', async () => {
    const ok = vi.fn(async () => new Response(JSON.stringify({ data: ['infresh'] }), { status: 200 }))
    expect(await loadInsightsJson('/api/insights/brands', { fetchImpl: ok })).toEqual({ data: ['infresh'] })

    const off = vi.fn(async () => new Response(JSON.stringify({ error: 'off', code: 'INSIGHTS_NOT_CONFIGURED' }), { status: 503 }))
    await expect(loadInsightsJson('/api/insights/brands', { fetchImpl: off })).rejects.toMatchObject({ code: 'INSIGHTS_NOT_CONFIGURED', status: 503 })
  })
})
