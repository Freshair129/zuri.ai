import { beforeEach, describe, expect, it, vi } from 'vitest'

import { makeViewer } from '../../factories/viewer'

// @req FR-092 — the `POST /api/market/translations` handler: it resolves the viewer,
// parses the body at the boundary, and hands the application service the composition
// root (Prisma client + persistence adapter + candidate reader + default
// extractCandidate) rather than deciding anything itself.
// @spec SDD-049, BR-001, SEC-001, SEC-017, ADR-038
//
// The service is mocked here. The authorization decision, candidate filtering and
// translation loop are proved in
// tests/unit/market-intelligence/market-translation-run.test.js and against a real
// database in tests/integration/market-intelligence-translation-run.test.js.

const {
  runMarketTranslationForBusiness,
  resolveRequestViewer,
  createMarketObservationRepository,
  listMarketLaneRawRecordCandidates,
  extractGenericMarketCandidate,
  prismaClient,
} = vi.hoisted(() => ({
  runMarketTranslationForBusiness: vi.fn(),
  resolveRequestViewer: vi.fn(),
  createMarketObservationRepository: vi.fn(),
  listMarketLaneRawRecordCandidates: vi.fn(),
  extractGenericMarketCandidate: vi.fn(),
  prismaClient: { marker: 'prisma' },
}))

vi.mock('@/lib/db', () => ({ default: prismaClient }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))
vi.mock('@/modules/market-intelligence/infrastructure/market-observation-repository', () => ({
  createMarketObservationRepository,
}))
vi.mock('@/modules/market-intelligence/infrastructure/market-raw-record-repository', () => ({
  listMarketLaneRawRecordCandidates,
}))
vi.mock('@/modules/market-intelligence/application/generic-candidate-extractor', () => ({
  extractGenericMarketCandidate,
}))
vi.mock('@/modules/market-intelligence/application/market-observation-service', async (importOriginal) => {
  // The request parser is the real one: mocking it would let a malformed body pass a
  // test the route would fail in production.
  const actual = await importOriginal()
  return { ...actual, runMarketTranslationForBusiness }
})

const { POST } = await import('@/app/api/market/translations/route')

const viewer = makeViewer({ ownedBusinessIds: ['b-1'] })

const post = (body) =>
  POST(
    new Request('http://local/api/market/translations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  )

beforeEach(() => {
  vi.clearAllMocks()
  resolveRequestViewer.mockResolvedValue(viewer)
  runMarketTranslationForBusiness.mockResolvedValue({ translated: 0, unchanged: 0, failed: [] })
})

describe('POST /api/market/translations', () => {
  it('passes the resolved viewer and parsed body to the service, with prisma and the real adapters', async () => {
    const res = await post({ businessId: 'b-1', limit: 5 })

    expect(runMarketTranslationForBusiness).toHaveBeenCalledWith(
      { viewer, businessId: 'b-1', limit: 5 },
      {
        db: prismaClient,
        createRepository: createMarketObservationRepository,
        listCandidates: listMarketLaneRawRecordCandidates,
        extractCandidate: extractGenericMarketCandidate,
      },
    )
    expect(res.status).toBe(200)
    await expect(res.json()).resolves.toEqual({ translated: 0, unchanged: 0, failed: [] })
  })

  it('defaults the limit rather than letting a caller omit the cap', async () => {
    await post({ businessId: 'b-1' })

    expect(runMarketTranslationForBusiness.mock.calls[0][0].limit).toBe(20)
  })

  it('rejects a request with no businessId as a validation failure, without calling the service', async () => {
    const res = await post({})

    expect(res.status).toBe(400)
    expect(runMarketTranslationForBusiness).not.toHaveBeenCalled()
  })

  it('never reaches the service for an unauthenticated caller', async () => {
    resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))

    const res = await post({ businessId: 'b-1' })

    expect(res.status).toBe(401)
    expect(runMarketTranslationForBusiness).not.toHaveBeenCalled()
  })

  it('surfaces the service authorization refusal as the status the service chose', async () => {
    runMarketTranslationForBusiness.mockRejectedValue(
      Object.assign(new Error('Business not found'), { status: 404 }),
    )

    const res = await post({ businessId: 'b-1' })

    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'Business not found' })
  })

  it('exposes no GET verb — reads stay on GET /api/market/observations', async () => {
    const routeModule = await import('@/app/api/market/translations/route')

    expect(Object.keys(routeModule).filter((key) => ['GET', 'PATCH', 'PUT', 'DELETE'].includes(key))).toEqual([])
  })
})
