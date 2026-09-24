import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  MARKET_EXECUTORS,
  createMarketRouting,
  resolveMarketExecutor,
} from '@/modules/market-intelligence/infrastructure/market-executor'

// @req FR-092 — ADR-108 D6 single-writer routing for the two Market routes.
// @spec SEC-001, SEC-017, ADR-108
//
// The flag decides which executor runs; the BFF forwards the session token opaquely
// and never falls back to legacy when the service path is misconfigured.

const TOKEN = 's'.repeat(40)
const serviceEnv = { MARKET_EXECUTOR: 'service', MARKET_SERVICE_URL: 'http://market-intelligence:3082', MARKET_SERVICE_TOKEN: TOKEN }
const withSession = (url, init = {}) => new Request(url, { ...init, headers: { cookie: 'other=1; zuri_session=opaque-session-token', ...(init.headers || {}) } })
const jsonResponse = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('resolveMarketExecutor', () => {
  it('unset, empty and "legacy" all mean legacy', () => {
    for (const env of [{}, { MARKET_EXECUTOR: '' }, { MARKET_EXECUTOR: 'legacy' }]) {
      expect(resolveMarketExecutor(env).executor).toBe(MARKET_EXECUTORS.LEGACY)
    }
  })

  it('anything else, or service without URL/token, is misconfigured', () => {
    expect(resolveMarketExecutor({ MARKET_EXECUTOR: 'Service' }).executor).toBe(MARKET_EXECUTORS.MISCONFIGURED)
    expect(resolveMarketExecutor({ MARKET_EXECUTOR: 'service' }).executor).toBe(MARKET_EXECUTORS.MISCONFIGURED)
    expect(resolveMarketExecutor({ ...serviceEnv, MARKET_SERVICE_TOKEN: 'short' }).executor).toBe(MARKET_EXECUTORS.MISCONFIGURED)
    expect(resolveMarketExecutor({ ...serviceEnv, MARKET_SERVICE_URL: 'ftp://x' }).executor).toBe(MARKET_EXECUTORS.MISCONFIGURED)
    expect(resolveMarketExecutor(serviceEnv).executor).toBe(MARKET_EXECUTORS.SERVICE)
  })
})

describe('createMarketRouting', () => {
  it('legacy leaves both routes on the in-process path', () => {
    const routing = createMarketRouting({})
    expect(routing.feed).toBeNull()
    expect(routing.translate).toBeNull()
  })

  it('misconfigured refuses with 503 and never runs legacy', async () => {
    const routing = createMarketRouting({ MARKET_EXECUTOR: 'service' })
    const response = await routing.translate(withSession('http://local/api/market/translations', { method: 'POST', body: '{}' }))
    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({ error: 'Market service is not configured', code: 'MARKET_SERVICE_MISCONFIGURED' })
  })

  it('forwards the feed query, the service token and the session token opaquely', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(200, { version: '1.0', observations: [] }))
    const routing = createMarketRouting(serviceEnv, { fetchFn })
    const response = await routing.feed(withSession('http://local/api/market/observations?businessId=b-1&limit=5'))
    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ version: '1.0', observations: [] })
    const [url, init] = fetchFn.mock.calls[0]
    expect(String(url)).toBe('http://market-intelligence:3082/v1/observations?businessId=b-1&limit=5')
    expect(init.headers.authorization).toBe(`Bearer ${TOKEN}`)
    expect(init.headers['x-zuri-subject']).toBe('opaque-session-token')
    expect(init.redirect).toBe('error')
  })

  it('passes refusals through with the legacy body shape', async () => {
    const fetchFn = vi.fn(async () => jsonResponse(404, { error: 'Business not found' }))
    const routing = createMarketRouting(serviceEnv, { fetchFn })
    const response = await routing.translate(withSession('http://local/api/market/translations', { method: 'POST', body: JSON.stringify({ businessId: 'b-1' }) }))
    expect(response.status).toBe(404)
    await expect(response.json()).resolves.toEqual({ error: 'Business not found' })
    expect(fetchFn.mock.calls[0][1].body).toBe(JSON.stringify({ businessId: 'b-1' }))
  })

  it('no session means 401 without calling the service', async () => {
    const fetchFn = vi.fn()
    const routing = createMarketRouting(serviceEnv, { fetchFn })
    const response = await routing.feed(new Request('http://local/api/market/observations?businessId=b-1'))
    expect(response.status).toBe(401)
    await expect(response.json()).resolves.toEqual({ error: 'AUTH_REQUIRED' })
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('an unreachable or garbled service fails closed', async () => {
    const down = createMarketRouting(serviceEnv, { fetchFn: async () => { throw new TypeError('fetch failed') } })
    expect((await down.feed(withSession('http://local/api/market/observations?businessId=b-1'))).status).toBe(503)
    const garbled = createMarketRouting(serviceEnv, { fetchFn: async () => new Response('<html>', { status: 200 }) })
    expect((await garbled.feed(withSession('http://local/api/market/observations?businessId=b-1'))).status).toBe(502)
  })

  it('oversized translation bodies are refused before forwarding', async () => {
    const fetchFn = vi.fn()
    const routing = createMarketRouting(serviceEnv, { fetchFn })
    const response = await routing.translate(withSession('http://local/api/market/translations', { method: 'POST', body: 'x'.repeat(64 * 1024 + 1) }))
    expect(response.status).toBe(413)
    expect(fetchFn).not.toHaveBeenCalled()
  })
})

describe('route wiring reads the flag once at module load', () => {
  it('with MARKET_EXECUTOR=service the route proxies and the legacy service is never called', async () => {
    vi.stubEnv('MARKET_EXECUTOR', 'service')
    vi.stubEnv('MARKET_SERVICE_URL', 'http://127.0.0.1:1')
    vi.stubEnv('MARKET_SERVICE_TOKEN', TOKEN)
    const legacy = vi.fn()
    vi.doMock('@/modules/market-intelligence/application/market-observation-service', async (importOriginal) => ({
      ...(await importOriginal()),
      getMarketObservationFeed: legacy,
    }))
    const { GET } = await import('@/app/api/market/observations/route')
    const response = await GET(withSession('http://local/api/market/observations?businessId=b-1'))
    // Port 1 refuses the connection: the proxy answers 503 and legacy stays untouched.
    expect(response.status).toBe(503)
    expect(legacy).not.toHaveBeenCalled()
    vi.doUnmock('@/modules/market-intelligence/application/market-observation-service')
  })
})
