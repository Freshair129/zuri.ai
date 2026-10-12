// @req FR-270 — Business WIG limits, lead measures, commitments, sessions and
// the persisted overdue boundary.
// @spec ADR-101 D1/D5/D6, BR-001, BR-043, SEC-003
import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { getBusinessStrategy } from '@/modules/business/application/business-strategy-service'
import {
  createBusinessLeadMeasure,
  createBusinessWeeklyCommitment,
  recordBusinessLeadMeasureValue,
  setBusinessWeeklyCommitmentDone,
  setBusinessWigSessionStep,
  updateBusinessLeadMeasure,
} from '@/modules/project-manager/application/business-wig-execution-service'
import {
  createGoal,
  createKeyResult,
  createRoadmap,
  setGoalWig,
  updateGoal,
  updateKeyResult,
} from '@/modules/project-manager/application/business-strategy-mutation-service'
import { weekStartFor } from '@/modules/project-manager/progress/week'
import { PATCH as patchGoalWig } from '@/app/api/business/goals/[id]/wig/route'
import { POST as postLeadMeasure } from '@/app/api/business/goals/[id]/lead-measures/route'
import { PATCH as patchLeadMeasure } from '@/app/api/business/lead-measures/[id]/route'
import { POST as postLeadMeasureValue } from '@/app/api/business/lead-measures/[id]/values/route'
import { POST as postWeeklyCommitment } from '@/app/api/business/weekly-commitments/route'
import { PATCH as patchWeeklyCommitment } from '@/app/api/business/weekly-commitments/[id]/route'
import { PUT as putWigSessionStep } from '@/app/api/business/wig-sessions/steps/route'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

const NOW = new Date('2026-10-12T04:00:00.000Z')
const TWO_HORIZONS = [
  { key: 'SHORT', label: 'Short term', position: 1 },
  { key: 'MEDIUM', label: 'Medium term', position: 2 },
]

describe('FR-270 4DX weekly execution', () => {
  let businessA
  let businessB
  let owner
  let memberA
  let memberB
  let tenantOnlyPerson
  let expiredMember
  let ownerViewer
  let memberViewer
  let devViewer
  let goalA1
  let goalA2
  let goalA3
  let goalB1
  let goalB2
  let goalB3
  let goalB4
  let krA1
  let krA2
  let krA3
  let krB1
  let krB2
  let krB3
  let krB4
  let leadMeasure

  async function goalIn(business, viewer, title) {
    const roadmap = await prisma.businessRoadmap.findFirst({ where: { businessId: business.id } })
    const horizon = await prisma.businessRoadmapHorizon.findFirst({ where: { roadmapId: roadmap.id, key: 'SHORT' } })
    const goal = await createGoal({ businessId: business.id, roadmapId: roadmap.id, horizonId: horizon.id, title }, { viewer })
    const keyResult = await createKeyResult(goal.id, {
      title: `${title} outcome`, metric: `${title} count`, unit: 'deals', baseline: 0, target: 10,
    }, { viewer })
    return { goal, keyResult }
  }

  function unauthenticatedRequest(path, method, body = {}) {
    return new Request(`http://local${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
  }

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase()
    const portfolio = await createPortfolio({ name: `FR270 ${suffix}`, code: `PF-F270-${suffix}` })
    const tenantA = await createTenant({ portfolioId: portfolio.id, name: `FR270 A ${suffix}`, code: `TNT-F270A-${suffix}` })
    const tenantB = await createTenant({ portfolioId: portfolio.id, name: `FR270 B ${suffix}`, code: `TNT-F270B-${suffix}` })
    businessA = await createBusiness({ tenantId: tenantA.id, name: `FR270 A ${suffix}`, code: `BUS-F270A-${suffix}` })
    businessB = await createBusiness({ tenantId: tenantB.id, name: `FR270 B ${suffix}`, code: `BUS-F270B-${suffix}` })

    owner = await prisma.person.create({ data: { code: `PER-F270-O-${suffix}`, displayName: 'FR270 Owner' } })
    memberA = await prisma.person.create({ data: { code: `PER-F270-A-${suffix}`, displayName: 'FR270 Member A' } })
    memberB = await prisma.person.create({ data: { code: `PER-F270-B-${suffix}`, displayName: 'FR270 Member B' } })
    tenantOnlyPerson = await prisma.person.create({ data: { code: `PER-F270-T-${suffix}`, displayName: 'FR270 Tenant-only member' } })
    expiredMember = await prisma.person.create({ data: { code: `PER-F270-X-${suffix}`, displayName: 'FR270 Expired member' } })
    for (const [person, business, role] of [
      [owner, businessA, 'OWNER'], [owner, businessB, 'OWNER'],
      [memberA, businessA, 'MEMBER'], [memberB, businessB, 'MEMBER'],
    ]) {
      await prisma.membership.create({ data: { personId: person.id, tenantId: business.tenantId, businessId: business.id, role } })
    }
    await prisma.membership.create({
      data: { personId: tenantOnlyPerson.id, tenantId: businessA.tenantId, businessId: null, scopeType: 'TENANT', role: 'MEMBER' },
    })
    await prisma.membership.create({
      data: {
        personId: expiredMember.id, tenantId: businessA.tenantId, businessId: businessA.id,
        scopeType: 'BUSINESS', role: 'MEMBER', expiresAt: new Date(NOW.getTime() - 1),
      },
    })
    ownerViewer = makeViewer({
      principal: { id: owner.id }, visibleBusinessIds: [businessA.id, businessB.id], ownedBusinessIds: [businessA.id, businessB.id],
    })
    memberViewer = makeViewer({
      role: 'MEMBER', principal: { id: memberA.id }, visibleBusinessIds: [businessA.id], ownedBusinessIds: [],
    })
    devViewer = makeViewer({ role: 'DEV', principal: { id: memberA.id }, visibleBusinessIds: [businessA.id], ownedBusinessIds: [] })
    for (const business of [businessA, businessB]) {
      await createRoadmap({ businessId: business.id, title: 'FR-270 direction', horizons: TWO_HORIZONS }, { viewer: ownerViewer })
    }
    ;({ goal: goalA1, keyResult: krA1 } = await goalIn(businessA, ownerViewer, 'A WIG 1'))
    ;({ goal: goalA2, keyResult: krA2 } = await goalIn(businessA, ownerViewer, 'A WIG 2'))
    ;({ goal: goalA3, keyResult: krA3 } = await goalIn(businessA, ownerViewer, 'A WIG 3'))
    ;({ goal: goalB1, keyResult: krB1 } = await goalIn(businessB, ownerViewer, 'B WIG 1'))
    ;({ goal: goalB2, keyResult: krB2 } = await goalIn(businessB, ownerViewer, 'B non-WIG'))
    ;({ goal: goalB3, keyResult: krB3 } = await goalIn(businessB, ownerViewer, 'B concurrent WIG 3'))
    ;({ goal: goalB4, keyResult: krB4 } = await goalIn(businessB, ownerViewer, 'B concurrent WIG 4'))
  })

  it('enforces OWNER and Business scope, one same-goal lag result, and a per-Business cap of two', async () => {
    await expect(setGoalWig(goalA1.id, { isWig: true, lagKeyResultId: krA1.id }, { viewer: memberViewer }))
      .rejects.toMatchObject({ status: 403 })
    await expect(setGoalWig(goalA1.id, { isWig: true, lagKeyResultId: krA1.id }, { viewer: devViewer }))
      .rejects.toMatchObject({ status: 403 })
    await expect(setGoalWig(goalA1.id, { isWig: true, lagKeyResultId: krB1.id }, { viewer: ownerViewer }))
      .rejects.toMatchObject({ status: 400 })
    await expect(setGoalWig(goalA1.id, { isWig: true, lagKeyResultId: krA1.id }, {
      viewer: ownsElsewhere({ owns: businessB.id, sees: businessA.id }),
    })).rejects.toMatchObject({ status: 400 })

    await setGoalWig(goalA1.id, { isWig: true, lagKeyResultId: krA1.id }, { viewer: ownerViewer })
    await setGoalWig(goalA2.id, { isWig: true, lagKeyResultId: krA2.id }, { viewer: ownerViewer })
    const versionBeforeThird = await prisma.business.findUnique({ where: { id: businessA.id }, select: { version: true } })
    const auditBeforeThird = await prisma.auditEvent.count({ where: { entityType: 'BUSINESS_GOAL', entityId: goalA3.id } })
    await expect(setGoalWig(goalA3.id, { isWig: true, lagKeyResultId: krA3.id }, { viewer: ownerViewer }))
      .rejects.toMatchObject({ status: 409 })
    expect(await prisma.business.findUnique({ where: { id: businessA.id }, select: { version: true } })).toEqual(versionBeforeThird)
    expect(await prisma.businessKeyResult.findUnique({ where: { id: krA3.id } })).toMatchObject({ isLagMeasure: false })
    expect(await prisma.auditEvent.count({ where: { entityType: 'BUSINESS_GOAL', entityId: goalA3.id } })).toBe(auditBeforeThird)

    // The same limit is independent for a different Business.
    await expect(setGoalWig(goalB1.id, { isWig: true, lagKeyResultId: krB1.id }, { viewer: ownerViewer }))
      .resolves.toMatchObject({ isWig: true })
    expect(await prisma.businessGoal.count({ where: { businessId: businessA.id, isWig: true, status: { not: 'ARCHIVED' } } })).toBe(2)
  })

  it('rejects unauthenticated requests at every Phase 3 mutation route before any write', async () => {
    const businessBefore = await prisma.business.findUnique({ where: { id: businessA.id }, select: { version: true } })
    const auditWhere = { entityType: { in: [
      'BUSINESS_GOAL', 'BUSINESS_LEAD_MEASURE', 'BUSINESS_LEAD_MEASURE_VALUE',
      'BUSINESS_WEEKLY_COMMITMENT', 'BUSINESS_WIG_SESSION',
    ] } }
    const auditBefore = await prisma.auditEvent.count({ where: auditWhere })
    const results = await Promise.all([
      patchGoalWig(unauthenticatedRequest(`/api/business/goals/${goalA1.id}/wig`, 'PATCH'), { params: { id: goalA1.id } }),
      postLeadMeasure(unauthenticatedRequest(`/api/business/goals/${goalA1.id}/lead-measures`, 'POST'), { params: { id: goalA1.id } }),
      patchLeadMeasure(unauthenticatedRequest('/api/business/lead-measures/unknown', 'PATCH'), { params: { id: 'unknown' } }),
      postLeadMeasureValue(unauthenticatedRequest('/api/business/lead-measures/unknown/values', 'POST'), { params: { id: 'unknown' } }),
      postWeeklyCommitment(unauthenticatedRequest('/api/business/weekly-commitments', 'POST')),
      patchWeeklyCommitment(unauthenticatedRequest('/api/business/weekly-commitments/unknown', 'PATCH'), { params: { id: 'unknown' } }),
      putWigSessionStep(unauthenticatedRequest('/api/business/wig-sessions/steps', 'PUT')),
    ])
    expect(results.map((response) => response.status)).toEqual([401, 401, 401, 401, 401, 401, 401])
    expect(await prisma.business.findUnique({ where: { id: businessA.id }, select: { version: true } })).toEqual(businessBefore)
    expect(await prisma.auditEvent.count({ where: auditWhere })).toBe(auditBefore)
  })

  it('frees capacity on WIG archive and requires a valid lag Key Result before reactivation', async () => {
    await updateGoal(goalB1.id, { status: 'ARCHIVED' }, { viewer: ownerViewer })
    expect(await prisma.businessGoal.findUnique({ where: { id: goalB1.id } })).toMatchObject({ isWig: true, status: 'ARCHIVED' })
    await updateKeyResult(krB1.id, { status: 'ARCHIVED' }, { viewer: ownerViewer })
    await expect(updateGoal(goalB1.id, { status: 'ACTIVE' }, { viewer: ownerViewer }))
      .rejects.toThrow(/one non-archived lag Key Result/)
    await updateKeyResult(krB1.id, { status: 'ACTIVE' }, { viewer: ownerViewer })
    await updateGoal(goalB1.id, { status: 'ACTIVE' }, { viewer: ownerViewer })
    await expect(updateKeyResult(krB1.id, { status: 'ARCHIVED' }, { viewer: ownerViewer }))
      .rejects.toThrow(/lag Key Result of an active WIG/)
  })

  it('serializes concurrent WIG activation contenders so only one can consume the final slot', async () => {
    const results = await Promise.allSettled([
      setGoalWig(goalB3.id, { isWig: true, lagKeyResultId: krB3.id }, { viewer: ownerViewer }),
      setGoalWig(goalB4.id, { isWig: true, lagKeyResultId: krB4.id }, { viewer: ownerViewer }),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(results.find((result) => result.status === 'rejected').reason).toMatchObject({ status: 409 })
    expect(await prisma.businessGoal.count({ where: { businessId: businessB.id, isWig: true, status: { not: 'ARCHIVED' } } })).toBe(2)
  })

  it('requires a live WIG for lead measures, appends corrections, and keeps only the latest value in each BKK week', async () => {
    await expect(createBusinessLeadMeasure(goalB2.id, {
      name: 'Invalid parent', unit: 'calls', weeklyTarget: 5,
    }, { viewer: ownerViewer })).rejects.toMatchObject({ status: 409 })

    leadMeasure = await createBusinessLeadMeasure(goalB1.id, {
      name: 'Qualified buyer calls', unit: 'calls', weeklyTarget: 10, direction: 'UP',
    }, { viewer: ownerViewer })
    const currentWeek = weekStartFor(NOW)
    const oldWeek = new Date(currentWeek.getTime() - 7 * 24 * 60 * 60 * 1000)
    await recordBusinessLeadMeasureValue(leadMeasure.id, { weekStartAt: oldWeek, value: 3 }, { viewer: ownerViewer, now: NOW })
    const correctionA = await recordBusinessLeadMeasureValue(leadMeasure.id, { weekStartAt: currentWeek, value: 7 }, { viewer: ownerViewer, now: NOW })
    const correctionB = await recordBusinessLeadMeasureValue(leadMeasure.id, { weekStartAt: currentWeek, value: 9 }, { viewer: ownerViewer, now: NOW })
    expect(correctionA.id).not.toBe(correctionB.id)
    await expect(recordBusinessLeadMeasureValue(leadMeasure.id, {
      weekStartAt: new Date(currentWeek.getTime() + 7 * 24 * 60 * 60 * 1000), value: 12,
    }, { viewer: ownerViewer, now: NOW })).rejects.toMatchObject({ status: 400 })
    await expect(recordBusinessLeadMeasureValue(leadMeasure.id, { weekStartAt: currentWeek, value: Number.POSITIVE_INFINITY }, {
      viewer: ownerViewer, now: NOW,
    })).rejects.toThrow()

    const strategy = await getBusinessStrategy(businessB.id, { visibleBusinessIds: [businessB.id], now: NOW })
    const projectedMeasure = strategy.wigExecution.wigs.find((wig) => wig.goalId === goalB1.id).leadMeasures[0]
    const allCorrections = await prisma.businessLeadMeasureValue.findMany({
      where: { leadMeasureId: leadMeasure.id, weekStartAt: currentWeek },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    })
    expect(projectedMeasure.weeklyBars).toHaveLength(5)
    expect(projectedMeasure.weeklyBars.at(-1)).toMatchObject({
      value: allCorrections.at(-1).value, observationId: allCorrections.at(-1).id,
    })
    expect(allCorrections.some((row) => row.id === correctionB.id)).toBe(true)
    expect(await prisma.businessLeadMeasureValue.count({ where: { leadMeasureId: leadMeasure.id } })).toBe(3)

    await updateBusinessLeadMeasure(leadMeasure.id, { status: 'ARCHIVED' }, { viewer: ownerViewer })
    await expect(recordBusinessLeadMeasureValue(leadMeasure.id, { weekStartAt: currentWeek, value: 11 }, { viewer: ownerViewer, now: NOW }))
      .rejects.toMatchObject({ status: 409 })
    await updateBusinessLeadMeasure(leadMeasure.id, { status: 'ACTIVE' }, { viewer: ownerViewer })
  })

  it('assigns immutable current/next week commitments only to an active direct Business member', async () => {
    const sundayLastSecond = new Date('2026-10-11T16:59:59.999Z')
    const mondayStart = new Date('2026-10-11T17:00:00.000Z')
    const sundayWeek = weekStartFor(sundayLastSecond)
    const mondayWeek = weekStartFor(mondayStart)
    expect(mondayWeek.getTime() - sundayWeek.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
    await expect(createBusinessWeeklyCommitment({
      businessId: businessA.id, weekStartAt: sundayWeek, ownerPersonId: memberA.id, title: 'Sunday local week',
    }, { viewer: ownerViewer, now: sundayLastSecond })).resolves.toMatchObject({ weekStartAt: sundayWeek })
    await expect(createBusinessWeeklyCommitment({
      businessId: businessA.id, weekStartAt: mondayWeek, ownerPersonId: memberA.id, title: 'Monday local week',
    }, { viewer: ownerViewer, now: mondayStart })).resolves.toMatchObject({ weekStartAt: mondayWeek })

    const currentWeek = weekStartFor(NOW)
    const nextWeek = new Date(currentWeek.getTime() + 7 * 24 * 60 * 60 * 1000)
    await expect(createBusinessWeeklyCommitment({
      businessId: businessA.id, weekStartAt: currentWeek, ownerPersonId: memberB.id, title: 'Wrong Business person',
    }, { viewer: ownerViewer, now: NOW })).rejects.toMatchObject({ status: 400 })
    await expect(createBusinessWeeklyCommitment({
      businessId: businessA.id, weekStartAt: currentWeek, ownerPersonId: tenantOnlyPerson.id, title: 'Tenant-wide only',
    }, { viewer: ownerViewer, now: NOW })).rejects.toMatchObject({ status: 400 })
    await expect(createBusinessWeeklyCommitment({
      businessId: businessA.id, weekStartAt: currentWeek, ownerPersonId: expiredMember.id, title: 'Expired direct member',
    }, { viewer: ownerViewer, now: NOW })).rejects.toMatchObject({ status: 400 })
    await expect(createBusinessWeeklyCommitment({
      businessId: businessA.id, weekStartAt: currentWeek, ownerPersonId: memberA.id,
      leadMeasureId: leadMeasure.id, title: 'Wrong Business measure',
    }, { viewer: ownerViewer, now: NOW })).rejects.toMatchObject({ status: 400 })
    await expect(createBusinessWeeklyCommitment({
      businessId: businessA.id,
      weekStartAt: new Date(currentWeek.getTime() + 60 * 60 * 1000),
      ownerPersonId: memberA.id,
      title: 'Invalid non-Monday',
    }, { viewer: ownerViewer, now: NOW })).rejects.toMatchObject({ status: 400 })
    await expect(createBusinessWeeklyCommitment({
      businessId: businessA.id,
      weekStartAt: new Date(nextWeek.getTime() + 7 * 24 * 60 * 60 * 1000),
      ownerPersonId: memberA.id,
      title: 'Beyond next week',
    }, { viewer: ownerViewer, now: NOW })).rejects.toMatchObject({ status: 400 })
    const currentCommitment = await createBusinessWeeklyCommitment({
      businessId: businessA.id, weekStartAt: currentWeek, ownerPersonId: memberA.id, title: 'Review this week',
    }, { viewer: ownerViewer, now: NOW })
    expect(currentCommitment.weekStartAt).toEqual(currentWeek)

    const commitment = await createBusinessWeeklyCommitment({
      businessId: businessB.id, weekStartAt: nextWeek, ownerPersonId: memberB.id,
      leadMeasureId: leadMeasure.id, title: 'Run ten qualified calls',
    }, { viewer: ownerViewer, now: NOW })
    const completedAuditBefore = await prisma.auditEvent.count({ where: { entityType: 'BUSINESS_WEEKLY_COMMITMENT', entityId: commitment.id, action: 'COMPLETED' } })
    const completed = await setBusinessWeeklyCommitmentDone(commitment.id, { done: true }, { viewer: ownerViewer })
    const repeated = await setBusinessWeeklyCommitmentDone(commitment.id, { done: true }, { viewer: ownerViewer })
    expect(completed.done).toBe(true)
    expect(repeated.version).toBe(completed.version)
    expect(await prisma.auditEvent.count({ where: { entityType: 'BUSINESS_WEEKLY_COMMITMENT', entityId: commitment.id, action: 'COMPLETED' } })).toBe(completedAuditBefore + 1)
    await expect(setBusinessWeeklyCommitmentDone(commitment.id, { done: false }, { viewer: ownerViewer }))
      .resolves.toMatchObject({ done: false })

    const strategy = await getBusinessStrategy(businessB.id, { visibleBusinessIds: [businessB.id], now: NOW })
    expect(strategy.wigExecution.commitments.next).toEqual(expect.arrayContaining([expect.objectContaining({ id: commitment.id })]))
  })

  it('uses an explicit idempotent session row and applies the persisted overdue threshold at exactly +8 days', async () => {
    const currentWeek = weekStartFor(NOW)
    const oldWeek = new Date(currentWeek.getTime() - 7 * 24 * 60 * 60 * 1000)
    const dueAt = new Date(oldWeek.getTime() + 8 * 24 * 60 * 60 * 1000)
    const sessionInput = { businessId: businessB.id, weekStartAt: oldWeek, step: 'report', completed: true }
    const first = await setBusinessWigSessionStep(sessionInput, { viewer: ownerViewer, now: NOW })
    const sessionAuditBefore = await prisma.auditEvent.count({ where: { entityType: 'BUSINESS_WIG_SESSION', entityId: first.id, action: 'STEP_SET' } })
    const same = await setBusinessWigSessionStep(sessionInput, { viewer: ownerViewer, now: NOW })
    expect(first.id).toBe(same.id)
    expect(await prisma.businessWigSession.count({ where: { businessId: businessB.id, weekStartAt: oldWeek } })).toBe(1)
    expect(await prisma.auditEvent.count({ where: { entityType: 'BUSINESS_WIG_SESSION', entityId: first.id, action: 'STEP_SET' } })).toBe(sessionAuditBefore)

    const before = await getBusinessStrategy(businessB.id, {
      visibleBusinessIds: [businessB.id], now: new Date(dueAt.getTime() - 1),
    })
    expect(before.wigExecution.overdueSessions.some((session) => session.weekStartAt.getTime() === oldWeek.getTime())).toBe(false)
    const atBoundary = await getBusinessStrategy(businessB.id, { visibleBusinessIds: [businessB.id], now: dueAt })
    expect(atBoundary.wigExecution.overdueSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ weekStartAt: oldWeek, missingSteps: ['scoreboard', 'plan'] }),
    ]))

    await setBusinessWigSessionStep({ ...sessionInput, step: 'scoreboard' }, { viewer: ownerViewer, now: dueAt })
    await setBusinessWigSessionStep({ ...sessionInput, step: 'plan' }, { viewer: ownerViewer, now: dueAt })
    const resolved = await getBusinessStrategy(businessB.id, { visibleBusinessIds: [businessB.id], now: dueAt })
    expect(resolved.wigExecution.overdueSessions.some((session) => session.weekStartAt.getTime() === oldWeek.getTime())).toBe(false)
    const cleared = await setBusinessWigSessionStep({ ...sessionInput, step: 'scoreboard', completed: false }, { viewer: ownerViewer, now: dueAt })
    expect(cleared.scoreboardCompletedAt).toBeNull()
    const reopenedAttention = await getBusinessStrategy(businessB.id, { visibleBusinessIds: [businessB.id], now: dueAt })
    expect(reopenedAttention.wigExecution.overdueSessions).toEqual(expect.arrayContaining([
      expect.objectContaining({ weekStartAt: oldWeek, missingSteps: ['scoreboard'] }),
    ]))

    const concurrentWeek = new Date(oldWeek.getTime() - 7 * 24 * 60 * 60 * 1000)
    const raced = await Promise.all([
      setBusinessWigSessionStep({ businessId: businessB.id, weekStartAt: concurrentWeek, step: 'report', completed: true }, { viewer: ownerViewer, now: NOW }),
      setBusinessWigSessionStep({ businessId: businessB.id, weekStartAt: concurrentWeek, step: 'plan', completed: true }, { viewer: ownerViewer, now: NOW }),
    ])
    expect(raced[0].id).toBe(raced[1].id)
    expect(await prisma.businessWigSession.count({ where: { businessId: businessB.id, weekStartAt: concurrentWeek } })).toBe(1)
    expect(await prisma.businessWigSession.findUnique({ where: { businessId_weekStartAt: { businessId: businessB.id, weekStartAt: concurrentWeek } } }))
      .toMatchObject({ reportCompletedAt: expect.any(Date), planCompletedAt: expect.any(Date) })
  })
})
