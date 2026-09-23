// @req FR-268 - OWNER-scoped Business Key Result create/update and weekly
// check-in, through the same audited project-manager service as FR-059.
// @spec SDD-107, BR-044, ADR-101 D4
// @tested tests/integration/fr268-business-key-result-mutation.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
import {
  createRoadmap,
  createGoal,
  updateGoal,
  createKeyResult,
  updateKeyResult,
  recordKeyResultCheckIn,
} from '@/modules/project-manager/application/business-strategy-mutation-service'
import { POST as postKeyResultRoute } from '@/app/api/business/goals/[id]/key-results/route'
import { PATCH as patchKeyResultRoute } from '@/app/api/business/key-results/[id]/route'
import { POST as postCheckInRoute } from '@/app/api/business/key-results/[id]/check-ins/route'
import { generateSessionToken } from '@/modules/identity/auth-service'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

let OWNER
const MEMBER = makeViewer({ principal: { id: 'fr268-member' } })

const twoHorizons = [
  { key: 'SHORT', label: 'Short term', position: 1 },
  { key: 'MEDIUM', label: 'Medium term', position: 2 },
]

function auditFor(entityType, entityId, action) {
  return prisma.auditEvent.findFirst({ where: { entityType, entityId, action }, orderBy: { occurredAt: 'desc' } })
}

const AUTH_SESSION_SECRET = 'fr268-session-secret-that-is-long-enough-123456'
const TEST_OWNER_CODE = 'PER-FR268'
let authenticatedOwnerId = null

async function ensureAuthenticatedOwner() {
  process.env.ZURI_SESSION_SECRET = AUTH_SESSION_SECRET
  const owner = await prisma.person.upsert({
    where: { code: TEST_OWNER_CODE },
    update: { email: 'fr268-owner@example.test' },
    create: { code: TEST_OWNER_CODE, displayName: 'FR-268 Owner', email: 'fr268-owner@example.test' },
  })
  authenticatedOwnerId = owner.id
  return owner
}

function authenticatedRequest(url, { method = 'GET', body } = {}) {
  if (!authenticatedOwnerId) throw new Error('Authenticated test owner has not been seeded')
  return new Request(url, {
    method,
    headers: {
      cookie: `zuri_session=${generateSessionToken(authenticatedOwnerId, { secret: AUTH_SESSION_SECRET })}`,
      ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
}

describe('FR-268 Business Key Result mutation', () => {
  let businessA
  let businessB
  let goalA
  let goalNoKr

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase()
    const portfolio = await createPortfolio({ name: `FR268 ${suffix}`, code: `PF-F268-${suffix}` })
    const tenantA = await createTenant({ portfolioId: portfolio.id, name: `FR268 A ${suffix}`, code: `TNT-F268A-${suffix}` })
    const tenantB = await createTenant({ portfolioId: portfolio.id, name: `FR268 B ${suffix}`, code: `TNT-F268B-${suffix}` })
    businessA = await createBusiness({ tenantId: tenantA.id, name: `FR268 A ${suffix}`, code: `BUS-F268A-${suffix}` })
    businessB = await createBusiness({ tenantId: tenantB.id, name: `FR268 B ${suffix}`, code: `BUS-F268B-${suffix}` })

    // FR-268's checkIn.actorPersonId is a real, enforced FK to Person — unlike
    // AuditEvent.actorId (an unconstrained String? column, so the FR-059
    // suite's synthetic 'fr059-owner' string never has to be a real row).
    // OWNER's principal id must therefore be a real Person here, or the
    // very first check-in fails its foreign key.
    const authOwner = await ensureAuthenticatedOwner()
    OWNER = makeViewer({
      principal: { id: authOwner.id },
      visibleBusinessIds: [businessA.id, businessB.id],
      ownedBusinessIds: [businessA.id, businessB.id],
    })

    await createWorkspace({ name: `FR268 A ${suffix}`, scopeType: 'BUSINESS', businessId: businessA.id, code: `WS-F268A-${suffix}` })

    for (const business of [businessA, businessB]) {
      const existing = await prisma.membership.findFirst({ where: { personId: authOwner.id, businessId: business.id } })
      if (!existing) {
        await prisma.membership.create({ data: { personId: authOwner.id, tenantId: business.tenantId, businessId: business.id, role: 'OWNER' } })
      }
    }

    const roadmap = await createRoadmap({ businessId: businessA.id, title: 'FR-268 Direction', horizons: twoHorizons }, { viewer: OWNER })
    goalA = await createGoal(
      { businessId: businessA.id, roadmapId: roadmap.id, horizonId: roadmap.horizons[0].id, title: 'Grow revenue', progress: 20 },
      { viewer: OWNER }
    )
    goalNoKr = await createGoal(
      { businessId: businessA.id, roadmapId: roadmap.id, horizonId: roadmap.horizons[0].id, title: 'Untouched by Key Results' },
      { viewer: OWNER }
    )
  })

  it('refuses a non-OWNER viewer', async () => {
    await expect(
      createKeyResult(goalA.id, { title: 'Blocked', metric: 'x', unit: 'x', baseline: 0, target: 10 }, { viewer: MEMBER })
    ).rejects.toMatchObject({ message: 'Owner permission is required', status: 403 })
  })

  it('refuses an OWNER of a different Business (sees businessA, owns only businessB)', async () => {
    await expect(
      createKeyResult(
        goalA.id,
        { title: 'Blocked', metric: 'x', unit: 'x', baseline: 0, target: 10 },
        { viewer: ownsElsewhere({ owns: businessB.id, sees: businessA.id }) }
      )
    ).rejects.toMatchObject({ status: 400 })
  })

  it('rejects target === baseline at create (FR-271 Measurable)', async () => {
    await expect(
      createKeyResult(goalA.id, { title: 'Flat', metric: 'x', unit: 'x', baseline: 5, target: 5 }, { viewer: OWNER })
    ).rejects.toThrow(/target must differ from baseline/)
  })

  describe('create, check-in, and write-through progress', () => {
    let kr

    it('creates a Key Result, records CREATED, and rolls the goal up to 0% (baseline, no check-in yet)', async () => {
      kr = await createKeyResult(
        goalA.id,
        { title: 'Close 12 enterprise deals', metric: 'Closed-won deals', unit: 'deals', baseline: 0, target: 12, ownerPersonId: null },
        { viewer: OWNER }
      )
      expect(kr.progress).toBe(0)
      expect(kr.current).toBe(0)
      expect(kr.status).toBe('ACTIVE')

      const audit = await auditFor('BUSINESS_KEY_RESULT', kr.id, 'CREATED')
      expect(audit).toBeTruthy()

      const goal = await prisma.businessGoal.findUnique({ where: { id: goalA.id } })
      expect(goal.progress).toBe(0) // was 20 by hand; now a write-through cache
    })

    it('BR-044: refuses a manual progress patch on a goal with an active Key Result', async () => {
      await expect(updateGoal(goalA.id, { progress: 50 }, { viewer: OWNER })).rejects.toMatchObject({
        message: expect.stringMatching(/BR-044/),
        status: 409,
      })
    })

    it('a manual progress patch still works on a goal with no Key Results', async () => {
      const updated = await updateGoal(goalNoKr.id, { progress: 33 }, { viewer: OWNER })
      expect(updated.progress).toBe(33)
      expect(updated.progressSource).toBe('MANUAL')
    })

    it('records a check-in, write-through updates the goal, and returns matching values', async () => {
      const now = Date.parse('2026-09-24T10:00:00Z') // a Thursday
      const result = await recordKeyResultCheckIn(kr.id, { value: 6, confidence: 4, note: 'Halfway.' }, { viewer: OWNER, now })
      expect(result.current).toBe(6)
      expect(result.progress).toBe(50) // 6/12
      expect(result.checkIns).toHaveLength(1)
      expect(result.checkIns[0].note).toBe('Halfway.')

      const goal = await prisma.businessGoal.findUnique({ where: { id: goalA.id } })
      expect(goal.progress).toBe(50)

      const audit = await auditFor('BUSINESS_KEY_RESULT', kr.id, 'CHECKED_IN')
      expect(audit).toBeTruthy()
      expect(JSON.parse(audit.payloadJson)).toMatchObject({ value: 6, confidence: 4 })
    })

    it('a second check-in the same week upserts rather than accumulating a duplicate row', async () => {
      const now = Date.parse('2026-09-25T10:00:00Z') // Friday — same Bangkok week as the Thursday above
      const result = await recordKeyResultCheckIn(kr.id, { value: 8, confidence: 4 }, { viewer: OWNER, now })
      expect(result.checkIns).toHaveLength(1) // still one row, updated
      expect(result.current).toBe(8)
      expect(result.progress).toBe(66.7) // 8/12*100 = 66.666.. -> clampPercent's 1dp round

      const goal = await prisma.businessGoal.findUnique({ where: { id: goalA.id } })
      expect(goal.progress).toBe(66.7)
    })

    it('a check-in in a later week adds a second row', async () => {
      const now = Date.parse('2026-10-01T10:00:00Z')
      const result = await recordKeyResultCheckIn(kr.id, { value: 10, confidence: 3 }, { viewer: OWNER, now })
      expect(result.checkIns).toHaveLength(2)
    })

    it('archiving the last active Key Result freezes goal progress and reopens manual editing (BR-044)', async () => {
      const archived = await updateKeyResult(kr.id, { status: 'ARCHIVED' }, { viewer: OWNER })
      expect(archived.status).toBe('ARCHIVED')

      const goal = await prisma.businessGoal.findUnique({ where: { id: goalA.id } })
      expect(goal.progress).toBe(83.3) // last computed value (10/12*100=83.33..), left in place — not reset to 0

      const updated = await updateGoal(goalA.id, { progress: 90 }, { viewer: OWNER })
      expect(updated.progress).toBe(90)
      expect(updated.progressSource).toBe('MANUAL')
    })
  })

  describe('route wiring', () => {
    it('POST /api/business/goals/{id}/key-results creates a Key Result over HTTP', async () => {
      const res = await postKeyResultRoute(
        authenticatedRequest(`http://local/api/business/goals/${goalNoKr.id}/key-results`, {
          method: 'POST',
          body: { title: 'Cut churn', metric: 'Monthly churn', unit: '%', baseline: 8, target: 3, direction: 'DOWN' },
        }),
        { params: { id: goalNoKr.id } }
      )
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.title).toBe('Cut churn')
      expect(body.direction).toBe('DOWN')

      const patchRes = await patchKeyResultRoute(
        authenticatedRequest(`http://local/api/business/key-results/${body.id}`, { method: 'PATCH', body: { confidence: 2 } }),
        { params: { id: body.id } }
      )
      expect(patchRes.status).toBe(200)
      expect((await patchRes.json()).confidence).toBe(2)

      const checkInRes = await postCheckInRoute(
        authenticatedRequest(`http://local/api/business/key-results/${body.id}/check-ins`, {
          method: 'POST',
          body: { value: 6, confidence: 3 },
        }),
        { params: { id: body.id } }
      )
      expect(checkInRes.status).toBe(200)
      const checkedIn = await checkInRes.json()
      expect(checkedIn.current).toBe(6)
      expect(checkedIn.progress).toBe(40) // DOWN 8->3, at 6: (8-6)/(8-3)*100 = 40
    })
  })
})
