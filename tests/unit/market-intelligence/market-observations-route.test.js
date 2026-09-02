import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeViewer } from '../../factories/viewer'

// @req FR-092 — the GET /api/market/observations handler: it resolves the viewer
// before anything else, parses the query at the boundary, and hands the application
// service the composition root (Prisma client + persistence adapter) rather than
// deciding anything itself.
// @spec SDD-049, BR-001, SEC-001, ADR-038
//
// The service and the repository are mocked here. This suite is about the wiring the
// route owns — not about the read, which is proved in
// tests/unit/market-intelligence/market-observation-feed.test.js and against a real
// database in tests/integration/market-intelligence-observation-feed.test.js.

const { getMarketObservationFeed, resolveRequestViewer, createMarketObservationRepository, prismaClient } =
  vi.hoisted(() => ({
    getMarketObservationFeed: vi.fn(),
    resolveRequestViewer: vi.fn(),
    createMarketObservationRepository: vi.fn(),
    prismaClient: { marker: 'prisma' },
  }))

vi.mock('@/lib/db', () => ({ default: prismaClient }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
vi.mock('@/modules/market-intelligence/infrastructure/market-observation-repository', () => ({
  createMarketObservationRepository,
}))
vi.mock('@/modules/market-intelligence/application/market-observation-service', async (importOriginal) => {
  // The query parser is the real one: mocking it would let a malformed query pass a
  // test the route would fail in production.
  const actual = await importOriginal()
  return { ...actual, getMarketObservationFeed }
})

const { GET } = await import('@/app/api/market/observations/route')

const viewer = makeViewer({ visibleBusinessIds: ['b-1'] })

const get = (search) => GET(new Request(`http://local/api/market/observations${search}`))

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(viewer)
  getMarketObservationFeed.mockResolvedValue({ version: '1.0', observations: [] })
})

describe('GET /api/market/observations', () => {
  it('passes the resolved viewer and parsed query to the service, with prisma and the real adapter', async () => {
    const res = await get('?businessId=b-1&limit=5')

    expect(getMarketObservationFeed).toHaveBeenCalledWith(
      { viewer, businessId: 'b-1', limit: 5 },
      { db: prismaClient, createRepository: createMarketObservationRepository },
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ version: '1.0', observations: [] })
  })

  it('defaults the limit rather than letting a caller omit the cap', async () => {
    await get('?businessId=b-1')

    expect(getMarketObservationFeed.mock.calls[0][0].limit).toBe(50)
  })

  it('rejects a request with no businessId as a validation failure, without calling the service', async () => {
    const res = await get('')

    expect(res.status).toBe(400)
    expect(getMarketObservationFeed).not.toHaveBeenCalled()
  })

  it('never reaches the service for an unauthenticated caller', async () => {
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))

    const res = await get('?businessId=b-1')

    expect(res.status).toBe(401)
    expect(getMarketObservationFeed).not.toHaveBeenCalled()
  })

  it('surfaces the service authorization refusal as the status the service chose', async () => {
    getMarketObservationFeed.mockRejectedValue(
      Object.assign(new Error('Business access denied'), { status: 403 }),
    )

    const res = await get('?businessId=b-1')

    expect(res.status).toBe(403)
    await expect(res.json()).resolves.toEqual({ error: 'Business access denied' })
  })

  it('exposes no write verb — the translation seam is the only writer of these rows', async () => {
    const routeModule = await import('@/app/api/market/observations/route')

    expect(Object.keys(routeModule).filter((key) => ['POST', 'PATCH', 'PUT', 'DELETE'].includes(key))).toEqual([])
  })
})
