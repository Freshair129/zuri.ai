// @req FR-270 — Business-scoped OWNER writers for lead measures, weekly
// commitments, and report/scoreboard/plan sessions.
// @spec ADR-101 D1/D5/D6, BR-001, BR-043, SEC-003
// @tested tests/integration/fr270-business-wig-execution.test.js
import { z } from 'zod'
import prisma from '@/lib/db'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { weekStartFor } from '@/modules/project-manager/progress/week'
import { recordAudit } from './audit'

const zWeek = z.coerce.date()
const zDirection = z.enum(['UP', 'DOWN'])
const zLeadMeasureStatus = z.enum(['ACTIVE', 'ARCHIVED'])
const zSessionStep = z.enum(['report', 'scoreboard', 'plan'])
const DAY_MS = 24 * 60 * 60 * 1000

export const zLeadMeasureCreateInput = z.object({
  name: z.string().trim().min(1).max(120),
  unit: z.string().trim().min(1).max(32),
  weeklyTarget: z.number().finite(),
  direction: zDirection.default('UP'),
})

export const zLeadMeasurePatchInput = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  unit: z.string().trim().min(1).max(32).optional(),
  weeklyTarget: z.number().finite().optional(),
  direction: zDirection.optional(),
  status: zLeadMeasureStatus.optional(),
}).refine((value) => Object.keys(value).length > 0, 'At least one field is required')

export const zLeadMeasureValueInput = z.object({
  weekStartAt: zWeek,
  value: z.number().finite(),
  note: z.string().max(1000).nullish(),
})

export const zWeeklyCommitmentCreateInput = z.object({
  businessId: z.string().min(1),
  weekStartAt: zWeek,
  ownerPersonId: z.string().min(1),
  leadMeasureId: z.string().min(1).nullish(),
  title: z.string().trim().min(1).max(240),
})

export const zWeeklyCommitmentDoneInput = z.object({ done: z.boolean() }).strict()

export const zWigSessionStepInput = z.object({
  businessId: z.string().min(1),
  weekStartAt: zWeek,
  step: zSessionStep,
  completed: z.boolean(),
}).strict()

function httpError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

function badRequest(message) {
  return httpError(message, 400)
}

function conflict(message) {
  return httpError(message, 409)
}

function requireOwner(viewer) {
  if (!viewer || viewer.role !== 'OWNER') throw httpError('Owner permission is required', 403)
}

function assertBusinessOwned(businessId, viewer) {
  if (!ownsBusiness(viewer, businessId)) throw httpError('Business access denied (not owned)', 403)
}

function asDate(now) {
  const date = now instanceof Date ? new Date(now.getTime()) : new Date(now)
  if (!Number.isFinite(date.getTime())) throw new Error('A valid server time is required')
  return date
}

function validateWeekBucket(weekStartAt, now, { allowNextWeek = false } = {}) {
  const week = asDate(weekStartAt)
  const currentWeek = weekStartFor(now)
  if (weekStartFor(week).getTime() !== week.getTime()) {
    throw badRequest('weekStartAt must be Monday 00:00 Asia/Bangkok')
  }
  if (week.getTime() > currentWeek.getTime()) {
    const isNextWeek = allowNextWeek && week.getTime() === currentWeek.getTime() + 7 * DAY_MS
    if (!isNextWeek) throw badRequest('weekStartAt cannot be in a future week')
  }
  return { weekStartAt: week, currentWeek }
}

async function lockBusinessWigState(tx, businessId) {
  // BR-043 is a per-Business invariant. The version write is the common
  // serialization point for goal, measure, value, and commitment writers that
  // also validate current WIG eligibility inside the same transaction.
  await tx.business.update({ where: { id: businessId }, data: { version: { increment: 1 } } })
}

async function requireActiveWigGoal(tx, goalId, businessId) {
  const goal = await tx.businessGoal.findFirst({
    where: { id: goalId, businessId },
    select: { id: true, businessId: true, status: true, isWig: true },
  })
  if (!goal) throw badRequest('Goal does not belong to this Business')
  if (!goal.isWig || goal.status === 'ARCHIVED') throw conflict('The parent Goal must be a non-archived WIG')
  return goal
}

async function requireActiveMeasure(tx, leadMeasureId, businessId) {
  const measure = await tx.businessLeadMeasure.findUnique({
    where: { id: leadMeasureId },
    include: { goal: { select: { businessId: true, isWig: true, status: true } } },
  })
  if (!measure || measure.businessId !== businessId || measure.goal.businessId !== businessId) {
    throw badRequest('Lead measure does not belong to this Business')
  }
  if (measure.status !== 'ACTIVE' || !measure.goal.isWig || measure.goal.status === 'ARCHIVED') {
    throw conflict('Lead measure must be active under a non-archived WIG')
  }
  return measure
}

async function audit(tx, { entityType, entityId, action, businessId, payload, viewer }) {
  await recordAudit(tx, {
    entityType,
    entityId,
    action,
    businessId,
    payload,
    actorId: viewer.principal?.id ?? null,
  })
}

export async function createBusinessLeadMeasure(goalId, input, { db = prisma, viewer } = {}) {
  requireOwner(viewer)
  const data = zLeadMeasureCreateInput.parse(input)
  const parent = await db.businessGoal.findUnique({ where: { id: goalId }, select: { businessId: true } })
  if (!parent) throw new Error('Goal not found')
  assertBusinessOwned(parent.businessId, viewer)

  return db.$transaction(async (tx) => {
    await lockBusinessWigState(tx, parent.businessId)
    await requireActiveWigGoal(tx, goalId, parent.businessId)
    const created = await tx.businessLeadMeasure.create({
      data: { businessId: parent.businessId, goalId, ...data },
    })
    await audit(tx, {
      entityType: 'BUSINESS_LEAD_MEASURE',
      entityId: created.id,
      action: 'CREATED',
      businessId: parent.businessId,
      payload: { goalId, name: data.name, unit: data.unit, weeklyTarget: data.weeklyTarget, direction: data.direction },
      viewer,
    })
    return created
  })
}

export async function updateBusinessLeadMeasure(id, input, { db = prisma, viewer } = {}) {
  requireOwner(viewer)
  const data = zLeadMeasurePatchInput.parse(input)
  const existing = await db.businessLeadMeasure.findUnique({ where: { id }, select: { id: true, businessId: true } })
  if (!existing) throw new Error('Lead measure not found')
  assertBusinessOwned(existing.businessId, viewer)

  return db.$transaction(async (tx) => {
    await lockBusinessWigState(tx, existing.businessId)
    const current = await tx.businessLeadMeasure.findUnique({ where: { id } })
    if (!current) throw new Error('Lead measure not found')
    const goal = await tx.businessGoal.findUnique({ where: { id: current.goalId }, select: { isWig: true, status: true } })
    if (!goal) throw conflict('The parent Goal no longer exists')
    if (data.status === 'ACTIVE' || (current.status === 'ACTIVE' && Object.keys(data).some((key) => key !== 'status'))) {
      await requireActiveWigGoal(tx, current.goalId, existing.businessId)
    }
    if (current.status === 'ARCHIVED' && Object.keys(data).some((key) => key !== 'status')) {
      throw conflict('Archived lead measures are read-only')
    }
    const changed = Object.fromEntries(Object.entries(data).filter(([key, value]) => current[key] !== value))
    if (Object.keys(changed).length === 0) return current
    const updated = await tx.businessLeadMeasure.update({
      where: { id },
      data: { ...changed, version: { increment: 1 } },
    })
    await audit(tx, {
      entityType: 'BUSINESS_LEAD_MEASURE',
      entityId: id,
      action: data.status === 'ARCHIVED' ? 'ARCHIVED' : data.status === 'ACTIVE' ? 'REACTIVATED' : 'UPDATED',
      businessId: existing.businessId,
      payload: changed,
      viewer,
    })
    return updated
  })
}

export async function recordBusinessLeadMeasureValue(leadMeasureId, input, { db = prisma, viewer, now = Date.now() } = {}) {
  requireOwner(viewer)
  const data = zLeadMeasureValueInput.parse(input)
  const { weekStartAt } = validateWeekBucket(data.weekStartAt, now)
  const existing = await db.businessLeadMeasure.findUnique({
    where: { id: leadMeasureId },
    select: { id: true, businessId: true },
  })
  if (!existing) throw new Error('Lead measure not found')
  assertBusinessOwned(existing.businessId, viewer)

  return db.$transaction(async (tx) => {
    await lockBusinessWigState(tx, existing.businessId)
    await requireActiveMeasure(tx, leadMeasureId, existing.businessId)
    const created = await tx.businessLeadMeasureValue.create({
      data: {
        leadMeasureId,
        weekStartAt,
        value: data.value,
        actorPersonId: viewer.principal?.id ?? null,
        note: data.note ?? null,
      },
    })
    await audit(tx, {
      entityType: 'BUSINESS_LEAD_MEASURE_VALUE',
      entityId: created.id,
      action: 'RECORDED',
      businessId: existing.businessId,
      payload: { leadMeasureId, weekStartAt, value: data.value, note: data.note ?? null },
      viewer,
    })
    return created
  })
}

async function requireCurrentBusinessMember(tx, businessId, personId, now) {
  const membership = await tx.membership.findFirst({
    where: {
      personId,
      businessId,
      scopeType: 'BUSINESS',
      status: 'ACTIVE',
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    select: { id: true },
  })
  if (!membership) throw badRequest('Commitment Person must have an active direct Membership in this Business')
}

export async function createBusinessWeeklyCommitment(input, { db = prisma, viewer, now = Date.now() } = {}) {
  requireOwner(viewer)
  const data = zWeeklyCommitmentCreateInput.parse(input)
  const { weekStartAt } = validateWeekBucket(data.weekStartAt, now, { allowNextWeek: true })
  assertBusinessOwned(data.businessId, viewer)
  const currentTime = asDate(now)

  return db.$transaction(async (tx) => {
    await lockBusinessWigState(tx, data.businessId)
    await requireCurrentBusinessMember(tx, data.businessId, data.ownerPersonId, currentTime)
    if (data.leadMeasureId) await requireActiveMeasure(tx, data.leadMeasureId, data.businessId)
    const created = await tx.businessWeeklyCommitment.create({
      data: {
        businessId: data.businessId,
        weekStartAt,
        ownerPersonId: data.ownerPersonId,
        leadMeasureId: data.leadMeasureId ?? null,
        title: data.title,
      },
    })
    await audit(tx, {
      entityType: 'BUSINESS_WEEKLY_COMMITMENT',
      entityId: created.id,
      action: 'CREATED',
      businessId: data.businessId,
      payload: {
        weekStartAt,
        ownerPersonId: data.ownerPersonId,
        leadMeasureId: data.leadMeasureId ?? null,
        title: data.title,
        recordedByOwner: true,
      },
      viewer,
    })
    return created
  })
}

export async function setBusinessWeeklyCommitmentDone(id, input, { db = prisma, viewer } = {}) {
  requireOwner(viewer)
  const data = zWeeklyCommitmentDoneInput.parse(input)
  const existing = await db.businessWeeklyCommitment.findUnique({ where: { id }, select: { id: true, businessId: true } })
  if (!existing) throw new Error('Weekly commitment not found')
  assertBusinessOwned(existing.businessId, viewer)

  return db.$transaction(async (tx) => {
    const current = await tx.businessWeeklyCommitment.findUnique({ where: { id } })
    if (!current) throw new Error('Weekly commitment not found')
    if (current.done === data.done) return current
    const updated = await tx.businessWeeklyCommitment.update({
      where: { id },
      data: { done: data.done, version: { increment: 1 } },
    })
    await audit(tx, {
      entityType: 'BUSINESS_WEEKLY_COMMITMENT',
      entityId: id,
      action: data.done ? 'COMPLETED' : 'REOPENED',
      businessId: existing.businessId,
      payload: { done: data.done },
      viewer,
    })
    return updated
  })
}

const SESSION_STEP_FIELD = {
  report: 'reportCompletedAt',
  scoreboard: 'scoreboardCompletedAt',
  plan: 'planCompletedAt',
}

export async function setBusinessWigSessionStep(input, { db = prisma, viewer, now = Date.now() } = {}) {
  requireOwner(viewer)
  const data = zWigSessionStepInput.parse(input)
  const { weekStartAt } = validateWeekBucket(data.weekStartAt, now)
  assertBusinessOwned(data.businessId, viewer)
  const field = SESSION_STEP_FIELD[data.step]
  const changedAt = data.completed ? asDate(now) : null

  async function attemptCreateOrUpdate() {
    return db.$transaction(async (tx) => {
      const where = { businessId_weekStartAt: { businessId: data.businessId, weekStartAt } }
      const current = await tx.businessWigSession.findUnique({ where })
      if (current && Boolean(current[field]) === data.completed) return current

      const saved = current
        ? await tx.businessWigSession.update({
          where: { id: current.id },
          data: { [field]: changedAt, version: { increment: 1 } },
        })
        : await tx.businessWigSession.create({
          data: { businessId: data.businessId, weekStartAt, [field]: changedAt },
        })

      await audit(tx, {
        entityType: 'BUSINESS_WIG_SESSION',
        entityId: saved.id,
        action: 'STEP_SET',
        businessId: data.businessId,
        payload: { weekStartAt, step: data.step, completed: data.completed },
        viewer,
      })
      return saved
    })
  }

  try {
    return await attemptCreateOrUpdate()
  } catch (error) {
    // The unique key is the race oracle: one concurrent first writer creates
    // the week row, and a single bounded retry applies the other requested
    // step against that row. No unbounded transaction retry is attempted.
    if (error?.code !== 'P2002') throw error
    try {
      return await attemptCreateOrUpdate()
    } catch (retryError) {
      if (retryError?.code === 'P2002') throw conflict('A session step changed concurrently; reload and retry once')
      throw retryError
    }
  }
}
