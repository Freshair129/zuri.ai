// @req FR-269 — OWNER-only KPI mutations, immutable observations, deterministic
// latest-value selection, and additive Strategy read projection.
// @spec ADR-101 D1, BR-001, SEC-003
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import {
  createBusinessKpi,
  updateBusinessKpi,
  recordBusinessKpiObservation,
} from '@/modules/project-manager/application/business-strategy-mutation-service'
import { POST as postKpiRoute } from '@/app/api/business/kpis/route'
import { PATCH as patchKpiRoute } from '@/app/api/business/kpis/[id]/route'
import { POST as postObservationRoute } from '@/app/api/business/kpis/[id]/observations/route'
import * as kpiRoute from '@/app/api/business/kpis/[id]/route'
import * as observationRoute from '@/app/api/business/kpis/[id]/observations/route'
import { GET as getBusinessStrategyRoute } from '@/app/api/business/strategy/route'
import { generateSessionToken } from '@/modules/identity/auth-service'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

const AUTH_SESSION_SECRET = 'fr269-session-secret-that-is-long-enough-123456'
const TEST_OWNER_CODE = 'PER-FR269'
const TEST_MEMBER_CODE = 'PER-FR269-MEMBER'
let ownerId = null
let memberId = null
let ownerViewer
let businessA
let businessB

function requestFor(personId, url, { method = 'GET', body } = {}) {
  return new Request(url, {
    method,
    headers: {
      cookie: `zuri_session=${generateSessionToken(personId, { secret: AUTH_SESSION_SECRET })}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

function auditFor(entityId, action) {
  return prisma.auditEvent.findFirst({
    where: { entityType: 'BUSINESS_KPI', entityId, action },
    orderBy: { occurredAt: 'desc' },
  })
}

describe('FR-269 Business KPI mutation and read scope', () => {
  let kpi
  let tieKpi

  beforeAll(async () => {
    process.env.ZURI_SESSION_SECRET = AUTH_SESSION_SECRET
    const suffix = randomUUID().slice(0, 8).toUpperCase()
    const portfolio = await createPortfolio({ name: `FR269 ${suffix}`, code: `PF-F269-${suffix}` })
    const tenantA = await createTenant({ portfolioId: portfolio.id, name: `FR269 A ${suffix}`, code: `TNT-F269A-${suffix}` })
    const tenantB = await createTenant({ portfolioId: portfolio.id, name: `FR269 B ${suffix}`, code: `TNT-F269B-${suffix}` })
    businessA = await createBusiness({ tenantId: tenantA.id, name: `FR269 A ${suffix}`, code: `BUS-F269A-${suffix}` })
    businessB = await createBusiness({ tenantId: tenantB.id, name: `FR269 B ${suffix}`, code: `BUS-F269B-${suffix}` })

    const owner = await prisma.person.upsert({
      where: { code: TEST_OWNER_CODE },
      update: { email: 'fr269-owner@example.test' },
      create: { code: TEST_OWNER_CODE, displayName: 'FR-269 Owner', email: 'fr269-owner@example.test' },
    })
    const member = await prisma.person.upsert({
      where: { code: TEST_MEMBER_CODE },
      update: { email: 'fr269-member@example.test' },
      create: { code: TEST_MEMBER_CODE, displayName: 'FR-269 Member', email: 'fr269-member@example.test' },
    })
    ownerId = owner.id
    memberId = member.id

    for (const [personId, business, role] of [
      [owner.id, businessA, 'OWNER'],
      // OWNER elsewhere + MEMBER here is intentional: global OWNER role must
      // never substitute for per-Business `ownsBusiness`.
      [owner.id, businessB, 'MEMBER'],
      [member.id, businessA, 'MEMBER'],
    ]) {
      const existing = await prisma.membership.findFirst({ where: { personId, businessId: business.id } })
      if (!existing) {
        await prisma.membership.create({
          data: { personId, tenantId: business.tenantId, businessId: business.id, role },
        })
      }
    }

    ownerViewer = makeViewer({
      principal: { id: owner.id },
      visibleBusinessIds: [businessA.id, businessB.id],
      ownedBusinessIds: [businessA.id],
    })
  })

  it('refuses writes from a non-owner and from an owner of a different Business', async () => {
    const memberViewer = makeViewer({
      role: 'MEMBER',
      principal: { id: memberId || 'fr269-member' },
      visibleBusinessIds: [businessA.id],
      ownedBusinessIds: [],
    })
    await expect(createBusinessKpi({
      businessId: businessA.id,
      name: 'Blocked',
      perspective: 'FINANCIAL',
      unit: 'USD',
      target: 100,
      warningThreshold: 80,
    }, { viewer: memberViewer })).rejects.toMatchObject({ status: 403 })

    await expect(createBusinessKpi({
      businessId: businessA.id,
      name: 'Blocked cross-scope',
      perspective: 'FINANCIAL',
      unit: 'USD',
      target: 100,
      warningThreshold: 80,
    }, { viewer: ownsElsewhere({ owns: businessB.id, sees: businessA.id }) })).rejects.toMatchObject({ status: 400 })
  })

  it('defaults an omitted observedAt to the server acceptance time', async () => {
    const defaultKpi = await createBusinessKpi({
      businessId: businessA.id,
      name: 'Server timestamp metric',
      perspective: 'INTERNAL_PROCESS',
      unit: 'jobs',
      target: 10,
      warningThreshold: 8,
    }, { viewer: ownerViewer })
    const acceptedAt = Date.parse('2026-10-12T04:00:00.000Z')
    const recorded = await recordBusinessKpiObservation(defaultKpi.id, { value: 9 }, {
      viewer: ownerViewer,
      now: acceptedAt,
    })
    expect(recorded.latestObservation.observedAt).toEqual(new Date(acceptedAt))

    await updateBusinessKpi(defaultKpi.id, { status: 'ARCHIVED' }, { viewer: ownerViewer })
    const archivedStrategyResponse = await getBusinessStrategyRoute(requestFor(
      ownerId,
      `http://local/api/business/strategy?businessId=${businessA.id}`,
    ))
    expect(archivedStrategyResponse.status).toBe(200)
    const archivedStrategy = await archivedStrategyResponse.json()
    expect(archivedStrategy.kpis.flatMap((group) => group.kpis).some((entry) => entry.id === defaultKpi.id)).toBe(false)
    await expect(recordBusinessKpiObservation(defaultKpi.id, { value: 10 }, {
      viewer: ownerViewer,
      now: acceptedAt,
    })).rejects.toMatchObject({ status: 409 })
  })

  it('rejects an observation when its in-transaction KPI version compare-and-swap loses', async () => {
    const staleKpi = {
      id: 'stale-kpi',
      businessId: businessA.id,
      status: 'ACTIVE',
      version: 4,
      business: { tenantId: 'tenant-fr269' },
    }
    const updateMany = vi.fn().mockResolvedValue({ count: 0 })
    const createObservation = vi.fn()
    const db = {
      businessKpi: { findUnique: vi.fn().mockResolvedValue(staleKpi) },
      $transaction: (callback) => callback({
        businessKpi: { updateMany, findUnique: vi.fn() },
        businessKpiObservation: { create: createObservation },
      }),
    }

    await expect(recordBusinessKpiObservation(staleKpi.id, { value: 5 }, {
      db,
      viewer: ownerViewer,
      now: Date.parse('2026-10-12T04:00:00.000Z'),
    })).rejects.toMatchObject({ status: 409 })
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: staleKpi.id, businessId: businessA.id, status: 'ACTIVE', version: 4 },
      data: { version: { increment: 1 } },
    })
    expect(createObservation).not.toHaveBeenCalled()
  })

  it('rejects reversed/equal thresholds and mismatched body scope', async () => {
    await expect(createBusinessKpi({
      businessId: businessA.id,
      name: 'Bad ordering',
      perspective: 'FINANCIAL',
      unit: 'USD',
      target: 100,
      warningThreshold: 100,
      direction: 'UP',
    }, { viewer: ownerViewer })).rejects.toMatchObject({ status: 400 })

    await expect(createBusinessKpi({
      businessId: businessA.id,
      name: 'Bad DOWN ordering',
      perspective: 'FINANCIAL',
      unit: 'USD',
      target: 5,
      warningThreshold: 4,
      direction: 'DOWN',
    }, { viewer: ownerViewer })).rejects.toMatchObject({ status: 400 })

    const response = await postKpiRoute(requestFor(ownerId, 'http://local/api/business/kpis', {
      method: 'POST',
      body: {
        businessId: businessB.id,
        name: 'Not owned',
        perspective: 'FINANCIAL',
        unit: 'USD',
        target: 100,
        warningThreshold: 80,
      },
    }))
    expect(response.status).toBe(400)
  })

  it('rejects non-finite, non-numeric, and JSON-overflow KPI values before persistence', async () => {
    for (const target of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '100']) {
      await expect(createBusinessKpi({
        businessId: businessA.id,
        name: 'Invalid finite target',
        perspective: 'FINANCIAL',
        unit: 'USD',
        target,
        warningThreshold: 80,
      }, { viewer: ownerViewer })).rejects.toThrow()
    }

    for (const warningThreshold of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '80']) {
      await expect(createBusinessKpi({
        businessId: businessA.id,
        name: 'Invalid finite warning threshold',
        perspective: 'FINANCIAL',
        unit: 'USD',
        target: 100,
        warningThreshold,
      }, { viewer: ownerViewer })).rejects.toThrow()
    }

    const finiteKpi = await createBusinessKpi({
      businessId: businessA.id,
      name: 'Finite value guard',
      perspective: 'FINANCIAL',
      unit: 'USD',
      target: 100,
      warningThreshold: 80,
    }, { viewer: ownerViewer })
    const before = await prisma.businessKpiObservation.count({ where: { kpiId: finiteKpi.id } })

    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '90']) {
      await expect(recordBusinessKpiObservation(finiteKpi.id, { value }, { viewer: ownerViewer }))
        .rejects.toThrow()
    }

    const overflowResponse = await postObservationRoute(new Request(
      `http://local/api/business/kpis/${finiteKpi.id}/observations`,
      {
        method: 'POST',
        headers: {
          cookie: `zuri_session=${generateSessionToken(ownerId, { secret: AUTH_SESSION_SECRET })}`,
          'content-type': 'application/json',
        },
        body: '{"value":1e400}',
      },
    ), { params: { id: finiteKpi.id } })
    expect(overflowResponse.status).toBe(400)
    expect(await prisma.businessKpiObservation.count({ where: { kpiId: finiteKpi.id } })).toBe(before)
  })

  it('Business hard-delete cascades through KPI and observation rows', async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase()
    const portfolio = await createPortfolio({ name: `Erase KPI ${suffix}`, code: `PF-ERK-${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `Erase KPI ${suffix}`, code: `TNT-ERK-${suffix}` })
    const eraseBusiness = await createBusiness({ tenantId: tenant.id, name: `Erase KPI ${suffix}`, code: `BUS-ERK-${suffix}` })
    const eraseKpi = await prisma.businessKpi.create({
      data: {
        businessId: eraseBusiness.id,
        name: 'Cascade fixture',
        perspective: 'CUSTOMER',
        unit: 'points',
        target: 10,
        warningThreshold: 8,
        direction: 'UP',
        cadence: 'MONTHLY',
      },
    })
    const eraseObservation = await prisma.businessKpiObservation.create({
      data: {
        kpiId: eraseKpi.id,
        value: 9,
        observedAt: new Date('2026-10-12T00:00:00.000Z'),
        actorPersonId: ownerId,
      },
    })

    await prisma.business.delete({ where: { id: eraseBusiness.id } })

    expect(await prisma.businessKpi.findUnique({ where: { id: eraseKpi.id } })).toBeNull()
    expect(await prisma.businessKpiObservation.findUnique({ where: { id: eraseObservation.id } })).toBeNull()
  })

  it('creates/updates an audited KPI and appends observations without rewriting history', async () => {
    const createdResponse = await postKpiRoute(requestFor(ownerId, 'http://local/api/business/kpis', {
      method: 'POST',
      body: {
        businessId: businessA.id,
        name: 'Monthly revenue',
        perspective: 'FINANCIAL',
        unit: 'USD',
        target: 100,
        warningThreshold: 80,
        direction: 'UP',
        cadence: 'MONTHLY',
      },
    }))
    expect(createdResponse.status).toBe(200)
    kpi = await createdResponse.json()
    expect(kpi).toMatchObject({ businessId: businessA.id, status: 'ACTIVE', resultStatus: 'NO_SIGNAL' })
    expect(await auditFor(kpi.id, 'CREATED')).toBeTruthy()

    const mismatch = await patchKpiRoute(requestFor(ownerId, `http://local/api/business/kpis/${kpi.id}`, {
      method: 'PATCH',
      body: { businessId: businessB.id, name: 'Scope escape' },
    }), { params: { id: kpi.id } })
    expect(mismatch.status).toBe(400)

    const updatedResponse = await patchKpiRoute(requestFor(ownerId, `http://local/api/business/kpis/${kpi.id}`, {
      method: 'PATCH',
      body: { businessId: businessA.id, name: 'Monthly revenue actuals' },
    }), { params: { id: kpi.id } })
    expect(updatedResponse.status).toBe(200)
    expect((await updatedResponse.json()).name).toBe('Monthly revenue actuals')
    expect(await auditFor(kpi.id, 'UPDATED')).toBeTruthy()
    await expect(updateBusinessKpi(kpi.id, { target: 70 }, { viewer: ownerViewer })).rejects.toMatchObject({ status: 400 })

    const first = await postObservationRoute(requestFor(ownerId, `http://local/api/business/kpis/${kpi.id}/observations`, {
      method: 'POST',
      body: { value: 80, observedAt: '2026-10-01T12:00:00.000Z', note: 'First report' },
    }), { params: { id: kpi.id } })
    expect(first.status).toBe(200)
    const firstKpi = await first.json()
    expect(firstKpi.resultStatus).toBe('WARN')
    const firstObservation = await prisma.businessKpiObservation.findFirst({ where: { kpiId: kpi.id } })

    const future = await postObservationRoute(requestFor(ownerId, `http://local/api/business/kpis/${kpi.id}/observations`, {
      method: 'POST',
      body: { value: 120, observedAt: '2999-01-01T00:00:00.000Z' },
    }), { params: { id: kpi.id } })
    expect(future.status).toBe(400)

    const scopeMismatch = await postObservationRoute(requestFor(ownerId, `http://local/api/business/kpis/${kpi.id}/observations`, {
      method: 'POST',
      body: { businessId: businessB.id, value: 90, observedAt: '2026-10-02T12:00:00.000Z' },
    }), { params: { id: kpi.id } })
    expect(scopeMismatch.status).toBe(400)

    await recordBusinessKpiObservation(kpi.id, {
      value: 70,
      observedAt: '2026-10-02T12:00:00.000Z',
      note: 'Second report',
    }, { viewer: ownerViewer, now: Date.parse('2026-10-12T00:00:00.000Z') })
    expect(await prisma.businessKpiObservation.count({ where: { kpiId: kpi.id } })).toBe(2)
    expect(await prisma.businessKpiObservation.findUnique({ where: { id: firstObservation.id } })).toMatchObject({
      value: 80,
      note: 'First report',
    })
    expect(await auditFor(kpi.id, 'OBSERVATION_RECORDED')).toBeTruthy()

    const memberResponse = await patchKpiRoute(requestFor(memberId, `http://local/api/business/kpis/${kpi.id}`, {
      method: 'PATCH',
      body: { name: 'Member write must fail' },
    }), { params: { id: kpi.id } })
    expect(memberResponse.status).toBe(403)

    // No update/delete handler exists for observation rows: corrections append.
    expect(observationRoute.PATCH).toBeUndefined()
    expect(observationRoute.DELETE).toBeUndefined()
    expect(kpiRoute.DELETE).toBeUndefined()
  })

  it('orders latest observations by observedAt, createdAt, then id and groups active KPIs by perspective', async () => {
    tieKpi = await createBusinessKpi({
      businessId: businessA.id,
      name: 'Tie break metric',
      perspective: 'CUSTOMER',
      unit: 'points',
      target: 10,
      warningThreshold: 8,
      direction: 'UP',
    }, { viewer: ownerViewer })

    const observedAt = new Date('2026-10-03T00:00:00.000Z')
    await prisma.businessKpiObservation.createMany({ data: [
      { id: `created-old-${tieKpi.id}`, kpiId: tieKpi.id, value: 1, observedAt, createdAt: new Date('2026-10-04T00:00:00.000Z') },
      { id: `created-new-${tieKpi.id}`, kpiId: tieKpi.id, value: 9, observedAt, createdAt: new Date('2026-10-05T00:00:00.000Z') },
    ] })

    async function readStrategy() {
      const response = await getBusinessStrategyRoute(requestFor(ownerId, `http://local/api/business/strategy?businessId=${businessA.id}`))
      expect(response.status).toBe(200)
      return response.json()
    }

    let strategy = await readStrategy()
    let customerKpis = strategy.kpis.find((group) => group.perspective === 'CUSTOMER').kpis
    expect(customerKpis.find((entry) => entry.id === tieKpi.id)).toMatchObject({
      resultStatus: 'WARN',
      latestObservation: { id: `created-new-${tieKpi.id}`, value: 9 },
    })

    // Equal observedAt values are ordered by createdAt, then equal timestamps
    // are broken by descending id so two corrections cannot swap on reload.
    const sameObservedAt = observedAt
    const laterCreatedAt = new Date('2026-10-06T00:00:00.000Z')
    await prisma.businessKpiObservation.createMany({ data: [
      { id: `a-${tieKpi.id}`, kpiId: tieKpi.id, value: 1, observedAt: sameObservedAt, createdAt: laterCreatedAt },
      { id: `z-${tieKpi.id}`, kpiId: tieKpi.id, value: 12, observedAt: sameObservedAt, createdAt: laterCreatedAt },
    ] })
    strategy = await readStrategy()
    customerKpis = strategy.kpis.find((group) => group.perspective === 'CUSTOMER').kpis
    expect(customerKpis.find((entry) => entry.id === tieKpi.id)).toMatchObject({
      resultStatus: 'OK',
      latestObservation: { id: `z-${tieKpi.id}`, value: 12 },
    })

    await prisma.businessKpiObservation.create({
      data: {
        id: `newer-observed-${tieKpi.id}`,
        kpiId: tieKpi.id,
        value: 7,
        observedAt: new Date('2026-10-04T00:00:00.000Z'),
        createdAt: new Date('2026-10-01T00:00:00.000Z'),
      },
    })
    strategy = await readStrategy()
    customerKpis = strategy.kpis.find((group) => group.perspective === 'CUSTOMER').kpis
    expect(strategy.kpis.map((group) => group.perspective)).toEqual([
      'FINANCIAL', 'CUSTOMER', 'INTERNAL_PROCESS', 'LEARNING_GROWTH',
    ])
    expect(customerKpis.find((entry) => entry.id === tieKpi.id)).toMatchObject({
      resultStatus: 'BAD',
      latestObservation: { id: `newer-observed-${tieKpi.id}`, value: 7 },
    })
    expect(strategy.kpis.find((group) => group.perspective === 'FINANCIAL').kpis
      .find((entry) => entry.id === kpi.id)).toMatchObject({ resultStatus: 'BAD', latestObservation: { value: 70 } })

    const memberRead = await getBusinessStrategyRoute(requestFor(memberId, `http://local/api/business/strategy?businessId=${businessA.id}`))
    expect(memberRead.status).toBe(200)
    expect((await memberRead.json()).kpis.find((group) => group.perspective === 'FINANCIAL').kpis)
      .toContainEqual(expect.objectContaining({ id: kpi.id }))
  })
})
