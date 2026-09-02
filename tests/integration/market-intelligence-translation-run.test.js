import { randomUUID } from 'node:crypto'

import { beforeAll, describe, expect, it, vi } from 'vitest'

import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { ingestRawExternalRecord } from '@/platform/integrations/core/raw-ingest-service'
import { createPrismaRawRecordRepository } from '@/platform/integrations/core/raw-record-repository'
import { POST } from '@/app/api/market/translations/route'
import { GET as getObservations } from '@/app/api/market/observations/route'

// The route resolves its viewer from the session port. Swapping that one seam keeps
// the rest of the request path — Prisma, the repository's scope checks, the
// authorization gate, the candidate scan — real.
vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: async (request) => {
    if (!request.__viewer) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 })
    return request.__viewer
  },
}))

// @req FR-092 — the production translation trigger against a real database: a raw
// record seeded through the FR-081 raw-ingest service, translated by calling the route
// function the browser would call, with the persisted MarketObservation read back
// through the FR-092 feed route. Nothing here reaches into
// `translateAndPersistRawMarketRecord` or the repositories by hand — if the route's own
// wiring (its default `extractCandidate`, the candidate scan, the ownership gate)
// regresses, this suite is what notices.
// @spec SDD-049, BR-001, SEC-001, SEC-017, ADR-038

const suffix = () => randomUUID().slice(0, 8).toUpperCase()

let tenant, business, otherBusiness, connection, providerCode

async function seedListingRawRecord({ tenantId, businessId, connectionId, providerCode, title, price }) {
  const token = suffix()
  const repository = createPrismaRawRecordRepository(prisma, { tenantId, connectionId })
  const { rawRecord } = await ingestRawExternalRecord(
    {
      tenantId,
      businessId,
      connectionId,
      provider: providerCode,
      lane: 'MARKET_INTELLIGENCE',
      entityType: 'listing',
      externalId: `listing-${token}`,
      sourceType: 'PULL',
      sourceUri: `https://market.example/listing/${token}`,
      schemaVersion: 'market.test.listing.v1',
      payload: { title, price, currency: 'THB', condition: 'USED', sellerName: 'ร้านทดสอบ' },
    },
    { repository },
  )
  return rawRecord
}

function postTranslation(viewer, body) {
  return POST(
    Object.assign(
      new Request('http://local/api/market/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      { __viewer: viewer },
    ),
  )
}

function getFeed(viewer, search) {
  return getObservations(
    Object.assign(new Request(`http://local/api/market/observations${search}`), { __viewer: viewer }),
  )
}

describe('POST /api/market/translations over a real database (FR-092)', () => {
  beforeAll(async () => {
    const token = suffix()
    const portfolio = await createPortfolio({ name: `Market Trigger PF ${token}`, code: `PF-MTRG-${token}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `Market Trigger TNT ${token}`, code: `TNT-MTRG-${token}` })
    business = await createBusiness({ tenantId: tenant.id, name: 'ร้านทริกเกอร์ทดสอบ', code: `BUS-MTRG-${token}` })
    otherBusiness = await createBusiness({ tenantId: tenant.id, name: 'ธุรกิจอื่นในเทนแนนต์เดียวกัน', code: `BUS-MTRG-O-${token}` })

    const provider = await prisma.integrationProvider.create({
      data: { code: `MARKET_TRIGGER_${token}`, name: 'Market trigger test source', status: 'ACTIVE' },
    })
    connection = await prisma.integrationConnection.create({
      data: {
        tenantId: tenant.id,
        businessId: business.id,
        providerId: provider.id,
        name: 'Market trigger connection',
        authorizationType: 'NONE',
        status: 'ACTIVE',
      },
    })
    providerCode = provider.code
  })

  it('refuses an unauthenticated caller before touching the database', async () => {
    const res = await POST(
      new Request('http://local/api/market/translations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ businessId: business.id }),
      }),
    )
    expect(res.status).toBe(401)
  })

  it('refuses a viewer who only sees the Business (not owns it), 404-shaped like a nonexistent one', async () => {
    const raw = await seedListingRawRecord({
      tenantId: tenant.id, businessId: business.id, connectionId: connection.id,
      providerCode: providerCode, title: 'ของที่ไม่ควรถูกแปลโดยผู้ไม่ใช่เจ้าของ', price: 1,
    })
    const seesOnly = makeViewer({ visibleDomains: [...VIEWER_DOMAINS], visibleBusinessIds: [business.id] })

    const res = await postTranslation(seesOnly, { businessId: business.id })

    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('Business not found')

    // Confirm it never ran: no observation exists for this raw record.
    const owner = makeViewer({ visibleDomains: [...VIEWER_DOMAINS], visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    const feed = await (await getFeed(owner, `?businessId=${business.id}`)).json()
    expect(JSON.stringify(feed)).not.toContain(raw.externalId)
  })

  it('answers an unowned-but-real Business identically to a fabricated one (no enumeration oracle)', async () => {
    const attacker = ownsElsewhere({ visibleDomains: [...VIEWER_DOMAINS], owns: otherBusiness.id, sees: business.id })

    const realButUnowned = await postTranslation(attacker, { businessId: business.id })
    const fabricated = await postTranslation(attacker, { businessId: randomUUID() })

    expect(realButUnowned.status).toBe(404)
    expect(fabricated.status).toBe(404)
    expect(await realButUnowned.json()).toEqual(await fabricated.json())
  })

  it('translates an owner-triggered run, and a second run over the same backlog finds nothing left eligible', async () => {
    // A dedicated Business + connection, so an earlier test's still-untranslated seed
    // on the shared `business` fixture cannot inflate this run's count.
    const token = suffix()
    const freshBusiness = await createBusiness({ tenantId: tenant.id, name: 'ธุรกิจแปลข้อมูลเดี่ยว', code: `BUS-MTRG-F-${token}` })
    const freshConnection = await prisma.integrationConnection.create({
      data: {
        tenantId: tenant.id,
        businessId: freshBusiness.id,
        providerId: connection.providerId,
        name: 'Fresh translation connection',
        authorizationType: 'NONE',
        status: 'ACTIVE',
      },
    })
    const owner = makeViewer({ visibleDomains: [...VIEWER_DOMAINS], visibleBusinessIds: [freshBusiness.id], ownedBusinessIds: [freshBusiness.id] })
    const raw = await seedListingRawRecord({
      tenantId: tenant.id, businessId: freshBusiness.id, connectionId: freshConnection.id,
      providerCode, title: 'RTX 4060 มือสอง', price: 9500,
    })

    const first = await postTranslation(owner, { businessId: freshBusiness.id })
    expect(first.status).toBe(200)
    const firstBody = await first.json()
    expect(firstBody).toEqual({ translated: 1, unchanged: 0, failed: [] })

    const feed = await (await getFeed(owner, `?businessId=${freshBusiness.id}`)).json()
    const row = feed.observations.find((o) => o.externalId === raw.externalId)
    expect(row).toMatchObject({ title: 'RTX 4060 มือสอง', price: 9500, currency: 'THB', resolutionStatus: 'UNRESOLVED' })

    // The candidate scan itself excludes any raw record with an observation already —
    // `findTranslatedRawRecordIds` sees the row `first` just persisted — so the second
    // run's eligible set is empty before `translateAndPersistRawMarketRecord` is ever
    // called again. `unchanged` counts a *persistence-level* replay (the atomic
    // `insertIfAbsent` resolving a lineage collision for a row that reached the loop
    // regardless — proven in
    // tests/unit/market-intelligence/market-translation-run.test.js), not "ran again
    // over an already-translated backlog"; those are two different idempotency layers
    // and this second run exercises only the first one.
    const second = await postTranslation(owner, { businessId: freshBusiness.id })
    expect(second.status).toBe(200)
    const secondBody = await second.json()
    expect(secondBody).toEqual({ translated: 0, unchanged: 0, failed: [] })

    const auditEvents = await prisma.auditEvent.findMany({
      where: { entityType: 'MarketObservation', action: 'MARKET_TRANSLATION_RUN', entityId: freshBusiness.id },
      orderBy: { occurredAt: 'asc' },
    })
    expect(auditEvents.length).toBe(2)
    for (const event of auditEvents) {
      const payload = JSON.parse(event.payloadJson)
      expect(payload.businessId).toBe(freshBusiness.id)
    }
    const [, secondPayload] = auditEvents.map((event) => JSON.parse(event.payloadJson))
    // The raw record is still in the scan (Integration evidence is never deleted); it
    // is simply no longer eligible, which is what makes this idempotent-by-scan rather
    // than idempotent-by-replay.
    expect(secondPayload).toMatchObject({ candidates: 1, eligible: 0, translated: 0, unchanged: 0 })
  })

  it('never translates another Business\'s raw records, even inside the same tenant', async () => {
    const otherRaw = await seedListingRawRecord({
      tenantId: tenant.id, businessId: otherBusiness.id, connectionId: connection.id,
      providerCode: providerCode, title: 'ของธุรกิจอื่น ห้ามแปลข้าม', price: 42,
    })
    const owner = makeViewer({ visibleDomains: [...VIEWER_DOMAINS], visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })

    const res = await postTranslation(owner, { businessId: business.id })
    expect(res.status).toBe(200)

    const otherOwner = makeViewer({ visibleDomains: [...VIEWER_DOMAINS], visibleBusinessIds: [otherBusiness.id], ownedBusinessIds: [otherBusiness.id] })
    const otherFeed = await (await getFeed(otherOwner, `?businessId=${otherBusiness.id}`)).json()
    expect(JSON.stringify(otherFeed)).not.toContain(otherRaw.externalId)
  })
})
