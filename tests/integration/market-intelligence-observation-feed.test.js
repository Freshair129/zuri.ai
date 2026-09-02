import { randomUUID } from 'node:crypto'

import { beforeAll, describe, expect, it, vi } from 'vitest'

import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { loadTranslateAndPersistRawMarketRecord } from '@/modules/market-intelligence/application/market-observation-service'
import { createMarketObservationRepository } from '@/modules/market-intelligence/infrastructure/market-observation-repository'
import { createMarketRawRecordRepository } from '@/modules/market-intelligence/infrastructure/market-raw-record-repository'
import { GET } from '@/app/api/market/observations/route'

// The route resolves its viewer from the session port. Swapping that one seam keeps
// the rest of the request path — Prisma, the repository's scope checks, the
// authorization gate — real.
vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: async (request) => {
    if (!request.__viewer) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 })
    return request.__viewer
  },
}))

// @req FR-092 — the whole `/market` path against a real database: rows written by the
// FR-092 translation seam, read back through the route function the browser calls.
// @spec SDD-049, BR-001, SEC-001, SEC-017, ADR-038
//
// The observations here are persisted through `loadTranslateAndPersistRawMarketRecord`
// rather than inserted by hand. If translation changes shape, this suite fails — which
// is the point: the dashboard's claim is that it shows what the domain recorded, and a
// hand-built fixture could not falsify that claim.
//
// `resolveRequestViewer` is the one thing stubbed. It reads a session cookie, which is
// not what this suite is about; every other layer — Prisma, the repository's scope
// checks, the authorization gate — is the real one.

const suffix = () => randomUUID().slice(0, 8).toUpperCase()

let tenant, business, otherBusiness, observedIds

const extractCandidate = async ({ payload }) => ({
  observationType: 'EXTERNAL_OFFER',
  candidate: { title: payload.title, price: payload.price, currency: 'THB' },
  observedAt: payload.observedAt,
})

async function seedRawRecord({ tenantId, businessId, connectionId, providerCode, title, price, observedAt }) {
  const token = suffix()
  return prisma.rawExternalRecord.create({
    data: {
      tenantId,
      businessId,
      connectionId,
      provider: providerCode,
      lane: 'MARKET_INTELLIGENCE',
      entityType: 'LISTING',
      externalId: `listing-${token}`,
      sourceType: 'PULL',
      sourceUri: `https://market.example/listing/${token}`,
      schemaVersion: 'market.test.listing.v1',
      payloadJson: JSON.stringify({ title, price, observedAt }),
      payloadHash: randomUUID().replace(/-/g, '').padEnd(64, '0').slice(0, 64),
      idempotencyKey: token.toLowerCase().padEnd(64, '0').slice(0, 64),
      receivedAt: new Date(observedAt),
    },
  })
}

async function translate(raw, { tenantId, businessId, connectionId, providerCode }) {
  const result = await loadTranslateAndPersistRawMarketRecord(raw.id, {
    rawRepository: createMarketRawRecordRepository(prisma, {
      tenantId, businessId, connectionId, provider: providerCode,
    }),
    repository: createMarketObservationRepository(prisma, { tenantId, businessId }),
    extractCandidate,
  })
  expect(result.status).toBe('CREATED')
  return result.observation
}

function request(viewer, search) {
  return GET(
    Object.assign(new Request(`http://local/api/market/observations${search}`), { __viewer: viewer }),
  )
}

describe('GET /api/market/observations over real MarketObservation rows (FR-092)', () => {
  beforeAll(async () => {
    const token = suffix()
    const portfolio = await createPortfolio({ name: `Market Feed PF ${token}`, code: `PF-MFEED-${token}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `Market Feed TNT ${token}`, code: `TNT-MFEED-${token}` })
    business = await createBusiness({ tenantId: tenant.id, name: 'ร้านตลาดทดสอบ', code: `BUS-MFEED-${token}` })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'ธุรกิจอื่นในเทนแนนต์เดียวกัน', code: `BUS-MFEED-O-${token}` })

    const provider = await prisma.integrationProvider.create({
      data: { code: `MARKET_FEED_${token}`, name: 'Market feed test source', status: 'ACTIVE' },
    })
    const connection = await prisma.integrationConnection.create({
      data: {
        tenantId: tenant.id,
        businessId: business.id,
        providerId: provider.id,
        name: 'Market feed connection',
        authorizationType: 'NONE',
        status: 'ACTIVE',
      },
    })
    const otherConnection = await prisma.integrationConnection.create({
      data: {
        tenantId: tenant.id,
        businessId: otherBusiness.id,
        providerId: provider.id,
        name: 'Other business connection',
        authorizationType: 'NONE',
        status: 'ACTIVE',
      },
    })

    const scope = { tenantId: tenant.id, businessId: business.id, connectionId: connection.id, providerCode: provider.code }

    const older = await seedRawRecord({ ...scope, title: 'RTX 3060 12GB มือสอง', price: 5000, observedAt: '2026-08-20T00:00:00.000Z' })
    const newer = await seedRawRecord({ ...scope, title: 'RTX 3060 Ti มือหนึ่ง', price: 8900, observedAt: '2026-08-21T00:00:00.000Z' })
    const foreign = await seedRawRecord({
      tenantId: tenant.id,
      businessId: otherBusiness.id,
      connectionId: otherConnection.id,
      providerCode: provider.code,
      title: 'ของธุรกิจอื่น ห้ามเห็น',
      price: 111,
      observedAt: '2026-08-22T00:00:00.000Z',
    })

    const olderObs = await translate(older, scope)
    const newerObs = await translate(newer, scope)
    await translate(foreign, {
      tenantId: tenant.id, businessId: otherBusiness.id, connectionId: otherConnection.id, providerCode: provider.code,
    })

    observedIds = { older: olderObs.id, newer: newerObs.id }
  })

  it('returns the Business\'s own observations, newest observation first', async () => {
    const viewer = makeViewer({ visibleBusinessIds: [business.id] })

    const res = await request(viewer, `?businessId=${business.id}`)
    expect(res.status).toBe(200)
    const body = await res.json()

    expect(body.observations.map((row) => row.id)).toEqual([observedIds.newer, observedIds.older])
    expect(body.scope).toMatchObject({ businessId: business.id, tenantId: tenant.id })
    expect(body.counts.observations).toBe(2)
    expect(body.observations[0]).toMatchObject({
      title: 'RTX 3060 Ti มือหนึ่ง',
      price: 8900,
      currency: 'THB',
      resolutionStatus: 'UNRESOLVED',
    })
  })

  it('never leaks another Business\'s observations, even inside the same tenant', async () => {
    // A viewer who owns the other Business and merely sees this one still gets only
    // this one's rows: the repository's scope is the Business, not the Tenant.
    const viewer = ownsElsewhere({ owns: otherBusiness.id, sees: business.id })

    const body = await (await request(viewer, `?businessId=${business.id}`)).json()

    expect(JSON.stringify(body)).not.toContain('ของธุรกิจอื่น ห้ามเห็น')
    expect(body.counts.observations).toBe(2)
  })

  it('refuses a viewer who cannot see the Business at all', async () => {
    const viewer = makeViewer({ visibleBusinessIds: [otherBusiness.id] })

    const res = await request(viewer, `?businessId=${business.id}`)

    expect(res.status).toBe(403)
    const body = await res.json()
    expect(body.error).toMatch(/denied/i)
    expect(JSON.stringify(body)).not.toContain('RTX 3060')
  })

  it('answers 401 before touching the database when no viewer resolves', async () => {
    const res = await GET(new Request(`http://local/api/market/observations?businessId=${business.id}`))

    expect(res.status).toBe(401)
  })

  it('honours the limit and reports truncation', async () => {
    const viewer = makeViewer({ visibleBusinessIds: [business.id] })

    const body = await (await request(viewer, `?businessId=${business.id}&limit=1`)).json()

    expect(body.observations).toHaveLength(1)
    expect(body.observations[0].id).toBe(observedIds.newer)
    expect(body.truncated).toBe(true)
  })

  it('answers an empty, honest feed for a Business with no observations at all', async () => {
    // The state the dashboard must be able to render truthfully: visible Business,
    // zero rows, no fixtures standing in for them.
    const token = suffix()
    const empty = await createBusiness({ tenantId: tenant.id, name: `ธุรกิจว่าง ${token}`, code: `BUS-MFEED-E-${token}` })
    const seesEmpty = makeViewer({ visibleBusinessIds: [empty.id] })

    const body = await (await request(seesEmpty, `?businessId=${empty.id}`)).json()

    expect(body.observations).toEqual([])
    expect(body.counts).toEqual({ observations: 0, providers: 0, byResolutionStatus: {} })
    expect(body.truncated).toBe(false)
  })
})
