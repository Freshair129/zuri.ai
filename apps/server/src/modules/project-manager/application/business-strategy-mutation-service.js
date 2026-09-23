// @req FR-059 — OWNER-scoped create/update of BusinessRoadmap + horizons,
// BusinessGoal, and ProjectGoal link/unlink.
// @spec SDD-032, BR-001, SEC-003
// SDD-032: writes live only in project-manager/application; business stays a
// read slice. BR-001: strategy belongs to Business, never inferred from
// Organization. SEC-003: every write records an AuditEvent.
// @tested tests/integration/fr059-business-strategy-mutation.test.js, tests/unit/fr059-strategy-validation.test.js
//
// Response DTOs (serializeRoadmapDto/serializeGoalDto below) intentionally
// mirror the private serializeRoadmap/serializeGoal shape in
// src/modules/business/application/business-strategy-service.js field for
// field. They are not imported from there — those helpers are not exported,
// and that file is the frozen FR-041 read contract this slice must not touch.
// Re-deriving the DTO through the exported getBusinessStrategy() was also
// rejected: it nests goals under roadmap.horizons.goals only, so a goal
// created with a roadmapId but no horizonId would be invisible to that
// projection. Keeping the shape here is a deliberate, small duplication —
// see FR-059-business-strategy-mutation.md. An equivalence test
// (tests/integration/fr059-business-strategy-mutation.test.js) guards against
// the two shapes drifting apart undetected.
import prisma from '@/lib/db'
import { z } from 'zod'
import { uniqueHumanCode } from '@/lib/ids'
import { zRoadmapStatus, zGoalStatus, zGoalPriority, zKeyResultDirection, zKeyResultStatus, zBusinessGoalPerspective } from '@/lib/validation/enums'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { recordAudit } from './audit'
// @req FR-268, SDD-107 — the pure calculators this file's Key Result writers
// call to keep BusinessGoal.progress a write-through cache (never a second
// source of truth) rather than a value this file invents its own formula for.
import { keyResultProgress, expectedProgress } from '../progress/key-result-progress'
import { rollupGoal } from '../progress/goal-rollup'
import { weekStartFor } from '../progress/week'

// ---- authorization ----------------------------------------------------------
// Owner-role check follows the same idiom as
// src/modules/identity/profile-permission-service.js:27-35 (FR-038). Role
// alone is not enough here, though: `viewer.role === 'OWNER'` is a *global*
// per-principal label (resolve-viewer.js — OWNER of any single Business gets
// role OWNER everywhere), so it only screens out viewers who are OWNER of
// *nothing* (a pure MEMBER, or a platform DEV grant). It still does not tell
// you the target Business is one this OWNER actually owns.
//
// T3b-1 FIX 1: every mutation below also asserts the target Business is in
// `viewer.ownedBusinessIds` — the actual per-Business OWNER grant set
// (resolve-viewer.js) — instead of the old `visibleBusinessIds` check. A
// principal who is OWNER of Business A and merely MEMBER of Business B has
// role 'OWNER' (global label) and Business B legitimately in
// visibleBusinessIds (the MEMBER Membership populates it), so the old
// `role === 'OWNER'` + `visibleBusinessIds.includes(businessId)` pair passed
// for a write to Business B it had no OWNER authority over — proven live
// against the database. `ownedBusinessIds` is always an array, and is a
// subset of `visibleBusinessIds` (resolve-viewer.js), so this check
// subsumes the old visibility check: any Business it passes is necessarily
// also visible. The separate `assertBusinessVisible`/`visibleBusinessIds`
// check is therefore removed as redundant, not silently dropped — this
// paragraph is that removal's justification, and
// FR-059-business-strategy-mutation.md §1 records the same decision.

function requireOwner(viewer) {
  if (!viewer || viewer.role !== 'OWNER') {
    const error = new Error('Owner permission is required')
    error.status = 403
    throw error
  }
}

// Explicit-status isolation/validation failures (SHOULD-FIX 4, 9). These are
// bad requests from a caller that already passed authorization — not server
// faults — so they get 400 rather than falling through _helpers.js's message
// sniffing to a 500.
function badRequest(message) {
  const error = new Error(message)
  error.status = 400
  return error
}

function assertBusinessOwned(businessId, viewer) {
  // The decision itself lives in one place now — identity/viewer-authority.js —
  // because it had been written here, in profile-permission-service.js, and was
  // about to be written a third time for project teams. It fails closed on a
  // missing or malformed `ownedBusinessIds` rather than optional-chaining into
  // `undefined`, which would fail *open*. The status and message stay here:
  // those are this endpoint's promise to its callers, not part of the decision.
  if (!ownsBusiness(viewer, businessId)) {
    // Sets status explicitly rather than relying on _helpers.js's message
    // sniffing (the `denied` regex still maps this message to 400, so the
    // observable status stays the same as before this check existed — see
    // FR-059-business-strategy-mutation.md §4.1).
    throw badRequest('Business access denied (not owned)')
  }
}

function conflict(message) {
  const error = new Error(message)
  error.status = 409
  return error
}

// ---- validation ---------------------------------------------------------
// Enums are the single Zod source (src/lib/validation/enums.js) — never hand-copied.

// position is bounded to non-negative so the reconciliation's negative
// sentinel staging (reconcileHorizons below) is a proven disjoint range, not
// an assumption: a caller-submitted negative position could otherwise land on
// the same value as an in-flight sentinel and trip @@unique([roadmapId,
// position]) mid-transaction, surfacing as a raw P2002 (500) instead of the
// 400 every other malformed-horizon case already gets.
const zHorizonInput = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  position: z.number().int().min(0),
  description: z.string().nullish(),
  targetAt: z.coerce.date().nullish(),
})

export const zRoadmapCreateInput = z.object({
  businessId: z.string().min(1),
  // Optional caller-declared code (FR-108): the ExecutionPlanBundle orchestrator
  // must create a Roadmap under the bundle's own stable code so a re-import
  // matches it by identity instead of minting a title-derived duplicate. Absent
  // (every pre-FR-108 caller), the title-derived uniqueHumanCode is unchanged.
  code: z.string().min(1).max(128).optional(),
  title: z.string().min(1),
  description: z.string().nullish(),
  status: zRoadmapStatus.default('ACTIVE'),
  startAt: z.coerce.date().nullish(),
  targetAt: z.coerce.date().nullish(),
  horizons: z.array(zHorizonInput),
})

export const zRoadmapPatchInput = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullish().optional(),
  status: zRoadmapStatus.optional(),
  startAt: z.coerce.date().nullish().optional(),
  targetAt: z.coerce.date().nullish().optional(),
  horizons: z.array(zHorizonInput).optional(),
})

// horizonId is required (SHOULD-FIX 5): the FR-041 read model
// (getBusinessStrategy) nests goals only under roadmap.horizons.goals, so a
// goal created without a horizon returns 200 and then is invisible on the
// very next GET. The read side is frozen in this build, so the write
// contract conforms to it. roadmapId stays independently optional/derivable
// from the horizon — see resolveGoalRoadmapId below — but if both are given
// they must agree.
export const zGoalCreateInput = z.object({
  businessId: z.string().min(1),
  // Optional caller-declared code (FR-108) — same rule as zRoadmapCreateInput.
  code: z.string().min(1).max(128).optional(),
  roadmapId: z.string().min(1).nullish(),
  horizonId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().nullish(),
  status: zGoalStatus.default('PLANNED'),
  priority: zGoalPriority.default('MEDIUM'),
  // @req ADR-101 D1 — nullable Balanced Scorecard tag; absent by default, same
  // as every goal that existed before FR-268. `isWig` is deliberately not
  // settable here — FR-270/Phase 3 owns the <=2-per-Business rule (BR-043)
  // and its own dedicated mutation.
  perspective: zBusinessGoalPerspective.nullish(),
  progress: z.number().min(0).max(100).default(0),
  startAt: z.coerce.date().nullish(),
  targetAt: z.coerce.date().nullish(),
})

// Patch never accepts an explicit null for roadmapId/horizonId — an update
// can move a goal to a different horizon, never detach it back into the
// invisible state SHOULD-FIX 5 closes off for create.
export const zGoalPatchInput = z.object({
  roadmapId: z.string().min(1).optional(),
  horizonId: z.string().min(1).optional(),
  title: z.string().min(1).optional(),
  description: z.string().nullish().optional(),
  status: zGoalStatus.optional(),
  priority: zGoalPriority.optional(),
  perspective: zBusinessGoalPerspective.nullish().optional(),
  progress: z.number().min(0).max(100).optional(),
  startAt: z.coerce.date().nullish().optional(),
  targetAt: z.coerce.date().nullish().optional(),
})

// @req FR-268 — a Key Result under an existing goal. `goalId` is a function
// parameter (createKeyResult(goalId, input, …)), never a body field — the
// same shape linkProjectToGoal already uses, so a caller cannot claim a
// businessId the target goal disagrees with; it is always derived from the
// goal, never trusted from input.
export const zKeyResultCreateInput = z
  .object({
    code: z.string().min(1).max(128).optional(),
    title: z.string().min(1),
    metric: z.string().min(1),
    unit: z.string().min(1),
    baseline: z.number(),
    target: z.number(),
    direction: zKeyResultDirection.default('UP'),
    dueAt: z.coerce.date().nullish(),
    ownerPersonId: z.string().min(1).nullish(),
    confidence: z.number().int().min(1).max(5).default(3),
  })
  .refine((d) => d.target !== d.baseline, { message: 'target must differ from baseline (FR-271 Measurable)', path: ['target'] })

export const zKeyResultPatchInput = z.object({
  title: z.string().min(1).optional(),
  metric: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
  baseline: z.number().optional(),
  target: z.number().optional(),
  direction: zKeyResultDirection.optional(),
  dueAt: z.coerce.date().nullish().optional(),
  ownerPersonId: z.string().min(1).nullish().optional(),
  confidence: z.number().int().min(1).max(5).optional(),
  status: zKeyResultStatus.optional(),
})

// weekStartAt is never a client field (Phase 1 keeps this simple): every
// check-in belongs to weekStartFor(now) at call time, server-computed.
export const zCheckInInput = z.object({
  value: z.number(),
  confidence: z.number().int().min(1).max(5),
  note: z.string().nullish(),
})

export const zProjectLinkInput = z.object({
  projectId: z.string().min(1),
})

/**
 * A roadmap must always have exactly 2 or 3 horizons — enforced by the
 * service, not only defensively at read time (FR-059 §3). Exact wording
 * matches the existing read-side defensive check
 * (business-strategy-service.js:51-53) so a write-time rejection and that
 * check mean the same thing to any caller that greps for it.
 */
export function assertHorizonCardinality(horizons) {
  if (!Array.isArray(horizons) || horizons.length < 2 || horizons.length > 3) {
    throw new Error('Business roadmap must have 2 or 3 horizons')
  }
}

/**
 * Reject a horizon set with a duplicate key or position before it ever
 * reaches Prisma (SHOULD-FIX 9): the schema's @@unique([roadmapId, key]) and
 * @@unique([roadmapId, position]) would otherwise surface as a raw P2002,
 * which _helpers.js maps to a 500.
 */
function assertHorizonsWellFormed(horizons) {
  const keys = new Set()
  const positions = new Set()
  for (const horizon of horizons) {
    if (keys.has(horizon.key)) throw badRequest(`Duplicate horizon key "${horizon.key}"`)
    keys.add(horizon.key)
    if (positions.has(horizon.position)) throw badRequest(`Duplicate horizon position ${horizon.position}`)
    positions.add(horizon.position)
  }
}

// ---- response shape (mirrors business-strategy-service.js, see file header) ----

function projectLinkDto(project, businessId) {
  const ownerId = project && project.businessId !== undefined
    ? project.businessId
    : project?.workspace?.businessId || null
  if (!project || ownerId !== businessId) return null
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    status: project.status,
  }
}

function serializeCheckInDto(checkIn) {
  return {
    id: checkIn.id,
    weekStartAt: checkIn.weekStartAt,
    value: checkIn.value,
    confidence: checkIn.confidence,
    note: checkIn.note,
    source: checkIn.source,
    actorPersonId: checkIn.actorPersonId,
  }
}

// @req FR-268, SDD-107 — progress/expectedProgress are never stored on
// BusinessKeyResult; both are recomputed here from (baseline, target,
// direction, latest check-in), the same pure calculators the read side and
// the UI's live SMART/status rendering call, so this response can never
// disagree with what a reload of the same row would show.
function serializeKeyResultDto(kr, now = Date.now()) {
  const checkIns = [...(kr.checkIns || [])].sort((a, b) => new Date(a.weekStartAt) - new Date(b.weekStartAt))
  const latest = checkIns[checkIns.length - 1]
  const current = latest ? latest.value : kr.baseline
  return {
    id: kr.id,
    code: kr.code,
    title: kr.title,
    metric: kr.metric,
    unit: kr.unit,
    baseline: kr.baseline,
    target: kr.target,
    direction: kr.direction,
    dueAt: kr.dueAt,
    ownerPersonId: kr.ownerPersonId,
    confidence: kr.confidence,
    status: kr.status,
    current,
    progress: keyResultProgress(kr, current),
    expectedProgress: expectedProgress(kr, now),
    checkIns: checkIns.map(serializeCheckInDto),
  }
}

function serializeGoalDto(goal, businessId) {
  // GOAL_INCLUDE below already filters keyResults to non-archived, so its
  // length here is exactly BR-044's "does this goal have an active Key
  // Result" test — no second query.
  const keyResults = (goal.keyResults || []).map((kr) => serializeKeyResultDto(kr))
  return {
    id: goal.id,
    code: goal.code,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    priority: goal.priority,
    perspective: goal.perspective,
    isWig: goal.isWig,
    progress: goal.progress,
    progressSource: keyResults.length > 0 ? 'KEY_RESULTS' : 'MANUAL',
    startAt: goal.startAt,
    targetAt: goal.targetAt,
    projects: (goal.projects || [])
      .map((link) => projectLinkDto(link.project, businessId))
      .filter(Boolean),
    keyResults,
  }
}

function serializeRoadmapDto(roadmap, businessId) {
  const horizons = [...(roadmap.horizons || [])]
    .sort((a, b) => a.position - b.position)
    .map((horizon) => ({
      id: horizon.id,
      key: horizon.key,
      label: horizon.label,
      position: horizon.position,
      description: horizon.description,
      targetAt: horizon.targetAt,
      goals: (horizon.goals || []).map((goal) => serializeGoalDto(goal, businessId)),
    }))
  return {
    id: roadmap.id,
    code: roadmap.code,
    title: roadmap.title,
    description: roadmap.description,
    status: roadmap.status,
    startAt: roadmap.startAt,
    targetAt: roadmap.targetAt,
    horizons,
  }
}

const PROJECT_SELECT = {
  select: { id: true, code: true, name: true, status: true, businessId: true, workspace: { select: { businessId: true } } },
}
// Up to 13 check-ins (a quarter of weeks) per Key Result — enough for the
// strategy card's own read, without an unbounded include on a goal that has
// been running for a year.
const KEY_RESULT_INCLUDE = { checkIns: { orderBy: { weekStartAt: 'desc' }, take: 13 } }
const GOAL_INCLUDE = {
  projects: { include: { project: PROJECT_SELECT } },
  keyResults: { where: { status: { not: 'ARCHIVED' } }, orderBy: { code: 'asc' }, include: KEY_RESULT_INCLUDE },
}
const ROADMAP_INCLUDE = { horizons: { orderBy: { position: 'asc' }, include: { goals: { include: GOAL_INCLUDE } } } }

// ---- roadmap --------------------------------------------------------------

export async function createRoadmap(input, { db = prisma, viewer } = {}) {
  requireOwner(viewer)
  const data = zRoadmapCreateInput.parse(input)
  assertBusinessOwned(data.businessId, viewer)
  assertHorizonCardinality(data.horizons)
  assertHorizonsWellFormed(data.horizons)
  const business = await db.business.findUnique({ where: { id: data.businessId }, select: { id: true } })
  if (!business) throw new Error('Business not found')
  let code
  if (data.code) {
    // A declared code is an identity claim, not a suggestion: if it is already
    // taken the caller's premise is wrong, so refuse rather than suffix it.
    if (await db.businessRoadmap.findUnique({ where: { code: data.code } })) {
      throw conflict(`Roadmap code "${data.code}" already exists`)
    }
    code = data.code
  } else {
    code = await uniqueHumanCode('RM', data.title, async (candidate) =>
      Boolean(await db.businessRoadmap.findUnique({ where: { code: candidate } }))
    )
  }

  const roadmap = await db.$transaction(async (tx) => {
    const created = await tx.businessRoadmap.create({
      data: {
        code,
        businessId: data.businessId,
        title: data.title,
        description: data.description ?? null,
        status: data.status,
        startAt: data.startAt ?? null,
        targetAt: data.targetAt ?? null,
        horizons: {
          create: data.horizons.map((horizon) => ({
            key: horizon.key,
            label: horizon.label,
            position: horizon.position,
            description: horizon.description ?? null,
            targetAt: horizon.targetAt ?? null,
          })),
        },
      },
      include: ROADMAP_INCLUDE,
    })
    await recordAudit(tx, {
      entityType: 'BUSINESS_ROADMAP',
      entityId: created.id,
      action: 'CREATED',
      payload: { code, businessId: data.businessId, horizonKeys: data.horizons.map((horizon) => horizon.key) },
      actorId: viewer.principal?.id ?? null,
    })
    return created
  })

  return serializeRoadmapDto(roadmap, data.businessId)
}

/**
 * Reconcile the roadmap's horizon set by stable `key` instead of the old
 * delete-then-recreate (BLOCKER 2): a horizon whose key still exists is
 * updated in place (same row, same id) so BusinessGoal.horizonId never gets
 * SET NULL by the schema's ON DELETE behaviour; a genuinely new key is
 * inserted; a removed key is deleted only when no goal is still attached to
 * it — otherwise the operation is refused with a clear error rather than
 * silently orphaning those goals (the decision recorded in
 * FR-059-business-strategy-mutation.md, so Wave 2's UI is built against it).
 *
 * Positions are cleared to unique negative sentinels before the final values
 * are applied, so reordering kept horizons never trips the schema's
 * @@unique([roadmapId, position]) mid-transaction.
 */
async function reconcileHorizons(tx, roadmapId, horizons) {
  const existingHorizons = await tx.businessRoadmapHorizon.findMany({ where: { roadmapId } })
  const existingByKey = new Map(existingHorizons.map((horizon) => [horizon.key, horizon]))
  const nextKeys = new Set(horizons.map((horizon) => horizon.key))

  const removed = existingHorizons.filter((horizon) => !nextKeys.has(horizon.key))
  for (const horizon of removed) {
    const goalCount = await tx.businessGoal.count({ where: { horizonId: horizon.id } })
    if (goalCount > 0) {
      throw badRequest(
        `Cannot remove horizon "${horizon.key}" — it still has ${goalCount} goal(s) attached. Move or update those goals first.`
      )
    }
  }
  for (const horizon of removed) {
    await tx.businessRoadmapHorizon.delete({ where: { id: horizon.id } })
  }

  const kept = horizons.filter((horizon) => existingByKey.has(horizon.key))
  let temp = -1
  for (const horizon of kept) {
    const existingHorizon = existingByKey.get(horizon.key)
    await tx.businessRoadmapHorizon.update({ where: { id: existingHorizon.id }, data: { position: temp } })
    temp -= 1
  }

  for (const horizon of horizons) {
    const existingHorizon = existingByKey.get(horizon.key)
    if (existingHorizon) {
      await tx.businessRoadmapHorizon.update({
        where: { id: existingHorizon.id },
        data: {
          label: horizon.label,
          position: horizon.position,
          description: horizon.description ?? null,
          targetAt: horizon.targetAt ?? null,
        },
      })
    } else {
      await tx.businessRoadmapHorizon.create({
        data: {
          roadmapId,
          key: horizon.key,
          label: horizon.label,
          position: horizon.position,
          description: horizon.description ?? null,
          targetAt: horizon.targetAt ?? null,
        },
      })
    }
  }
}

export async function updateRoadmap(id, patch, { db = prisma, viewer } = {}) {
  requireOwner(viewer)
  const data = zRoadmapPatchInput.parse(patch)
  const existing = await db.businessRoadmap.findUnique({ where: { id } })
  if (!existing) throw new Error('Roadmap not found')
  assertBusinessOwned(existing.businessId, viewer)
  if (data.horizons) {
    assertHorizonCardinality(data.horizons)
    assertHorizonsWellFormed(data.horizons)
  }

  // Empty patch (SHOULD-FIX 9): no fields to apply, so no version bump and no
  // UPDATED AuditEvent — an update that changes nothing should not look like
  // one that did.
  if (Object.keys(data).length === 0) {
    const unchanged = await db.businessRoadmap.findUnique({ where: { id }, include: ROADMAP_INCLUDE })
    return serializeRoadmapDto(unchanged, existing.businessId)
  }

  const roadmap = await db.$transaction(async (tx) => {
    if (data.horizons) {
      await reconcileHorizons(tx, id, data.horizons)
    }
    const updated = await tx.businessRoadmap.update({
      where: { id },
      data: {
        title: data.title ?? existing.title,
        description: data.description === undefined ? existing.description : data.description,
        status: data.status ?? existing.status,
        startAt: data.startAt === undefined ? existing.startAt : data.startAt,
        targetAt: data.targetAt === undefined ? existing.targetAt : data.targetAt,
        version: { increment: 1 },
      },
      include: ROADMAP_INCLUDE,
    })
    await recordAudit(tx, {
      entityType: 'BUSINESS_ROADMAP',
      entityId: id,
      action: 'UPDATED',
      payload: data, // the applied (parsed) patch — see SHOULD-FIX 9
      actorId: viewer.principal?.id ?? null,
    })
    return updated
  })

  return serializeRoadmapDto(roadmap, existing.businessId)
}

// ---- goal -------------------------------------------------------------------

async function assertRoadmapBelongsToBusiness(db, roadmapId, businessId) {
  const roadmap = await db.businessRoadmap.findUnique({ where: { id: roadmapId }, select: { id: true, businessId: true } })
  if (!roadmap || roadmap.businessId !== businessId) throw badRequest('Roadmap does not belong to Business')
}

async function assertHorizonBelongsToBusiness(db, horizonId, businessId) {
  const horizon = await db.businessRoadmapHorizon.findUnique({
    where: { id: horizonId },
    select: { id: true, roadmapId: true, roadmap: { select: { businessId: true } } },
  })
  if (!horizon || horizon.roadmap.businessId !== businessId) throw badRequest('Horizon does not belong to Business')
  return horizon
}

export async function createGoal(input, { db = prisma, viewer } = {}) {
  requireOwner(viewer)
  const data = zGoalCreateInput.parse(input)
  assertBusinessOwned(data.businessId, viewer)
  const business = await db.business.findUnique({ where: { id: data.businessId }, select: { id: true } })
  if (!business) throw new Error('Business not found')
  const horizon = await assertHorizonBelongsToBusiness(db, data.horizonId, data.businessId)
  // roadmapId is derivable from the (required) horizon; if the caller also
  // supplies one it must agree — otherwise the two fields are a silently
  // contradictory pair (SHOULD-FIX 9).
  if (data.roadmapId && data.roadmapId !== horizon.roadmapId) {
    throw badRequest('horizonId does not belong to roadmapId')
  }
  const roadmapId = data.roadmapId ?? horizon.roadmapId

  let code
  if (data.code) {
    // Same identity rule as createRoadmap: a declared code that is already
    // taken is refused, never quietly suffixed into a lookalike.
    if (await db.businessGoal.findUnique({ where: { code: data.code } })) {
      throw conflict(`Goal code "${data.code}" already exists`)
    }
    code = data.code
  } else {
    code = await uniqueHumanCode('GOAL', data.title, async (candidate) =>
      Boolean(await db.businessGoal.findUnique({ where: { code: candidate } }))
    )
  }

  const goal = await db.$transaction(async (tx) => {
    const created = await tx.businessGoal.create({
      data: {
        code,
        businessId: data.businessId,
        roadmapId,
        horizonId: data.horizonId,
        title: data.title,
        description: data.description ?? null,
        status: data.status,
        priority: data.priority,
        perspective: data.perspective ?? null,
        progress: data.progress,
        startAt: data.startAt ?? null,
        targetAt: data.targetAt ?? null,
      },
      include: GOAL_INCLUDE,
    })
    await recordAudit(tx, {
      entityType: 'BUSINESS_GOAL',
      entityId: created.id,
      action: 'CREATED',
      payload: { code, businessId: data.businessId, roadmapId, horizonId: data.horizonId },
      actorId: viewer.principal?.id ?? null,
    })
    return created
  })

  return serializeGoalDto(goal, data.businessId)
}

export async function updateGoal(id, patch, { db = prisma, viewer } = {}) {
  requireOwner(viewer)
  const data = zGoalPatchInput.parse(patch)
  const existing = await db.businessGoal.findUnique({ where: { id } })
  if (!existing) throw new Error('Goal not found')
  const businessId = existing.businessId
  assertBusinessOwned(businessId, viewer)

  // @req BR-044, SDD-107 — once a goal holds an active Key Result, its
  // progress is a write-through cache only recordKeyResultCheckIn writes;
  // a manual patch here is refused so there is exactly one writer of the
  // number, never two that can disagree.
  if (data.progress !== undefined) {
    const activeKeyResultCount = await db.businessKeyResult.count({
      where: { goalId: id, status: { not: 'ARCHIVED' } },
    })
    if (activeKeyResultCount > 0) {
      throw conflict(
        `Cannot set progress by hand — this goal has ${activeKeyResultCount} active Key Result(s); ` +
        'progress is derived from them (BR-044).'
      )
    }
  }

  let nextRoadmapId
  if (data.horizonId !== undefined) {
    const horizon = await assertHorizonBelongsToBusiness(db, data.horizonId, businessId)
    if (data.roadmapId !== undefined && data.roadmapId !== horizon.roadmapId) {
      throw badRequest('horizonId does not belong to roadmapId')
    }
    nextRoadmapId = data.roadmapId !== undefined ? data.roadmapId : horizon.roadmapId
  } else if (data.roadmapId !== undefined) {
    await assertRoadmapBelongsToBusiness(db, data.roadmapId, businessId)
    nextRoadmapId = data.roadmapId
  }

  // Empty patch (SHOULD-FIX 9): nothing to apply, so no version bump / audit.
  if (Object.keys(data).length === 0) {
    const unchanged = await db.businessGoal.findUnique({ where: { id }, include: GOAL_INCLUDE })
    return serializeGoalDto(unchanged, businessId)
  }

  const goal = await db.$transaction(async (tx) => {
    const updated = await tx.businessGoal.update({
      where: { id },
      data: {
        roadmapId: nextRoadmapId !== undefined ? nextRoadmapId : existing.roadmapId,
        horizonId: data.horizonId === undefined ? existing.horizonId : data.horizonId,
        title: data.title ?? existing.title,
        description: data.description === undefined ? existing.description : data.description,
        status: data.status ?? existing.status,
        priority: data.priority ?? existing.priority,
        perspective: data.perspective === undefined ? existing.perspective : data.perspective,
        progress: data.progress === undefined ? existing.progress : data.progress,
        startAt: data.startAt === undefined ? existing.startAt : data.startAt,
        targetAt: data.targetAt === undefined ? existing.targetAt : data.targetAt,
        version: { increment: 1 },
      },
      include: GOAL_INCLUDE,
    })
    await recordAudit(tx, {
      entityType: 'BUSINESS_GOAL',
      entityId: id,
      action: 'UPDATED',
      payload: data, // the applied (parsed) patch — see SHOULD-FIX 9
      actorId: viewer.principal?.id ?? null,
    })
    return updated
  })

  return serializeGoalDto(goal, businessId)
}

// ---- goal <-> project link --------------------------------------------------
// A goal in Business A must never link a Project owned by Business B — the
// same rule FR-043 enforces for direct Project ownership, and the same
// wording already used for the equivalent Business File Manager check
// (file-manager-read-model.js:148/169). A Project with a null businessId
// (explicit shared portfolio/tenant Project, FR-043) is never linkable,
// since null !== goal.businessId for every real businessId.

export async function linkProjectToGoal(goalId, input, { db = prisma, viewer } = {}) {
  requireOwner(viewer)
  const data = zProjectLinkInput.parse(input)
  const goal = await db.businessGoal.findUnique({ where: { id: goalId }, select: { id: true, businessId: true } })
  if (!goal) throw new Error('Goal not found')
  assertBusinessOwned(goal.businessId, viewer)
  const project = await db.project.findUnique({ where: { id: data.projectId }, select: { id: true, businessId: true } })
  if (!project || project.businessId !== goal.businessId) throw badRequest('Project does not belong to Business')

  // Re-linking an already-linked Project is a conflict, not a crash
  // (SHOULD-FIX 9): the schema's @@id([projectId, goalId]) would otherwise
  // surface as a raw P2002, which _helpers.js maps to a 500.
  const existingLink = await db.projectGoal.findUnique({
    where: { projectId_goalId: { projectId: data.projectId, goalId: goal.id } },
  })
  if (existingLink) throw conflict('Project is already linked to this Goal')

  const updated = await db.$transaction(async (tx) => {
    await tx.projectGoal.create({ data: { goalId: goal.id, projectId: data.projectId } })
    await recordAudit(tx, {
      entityType: 'PROJECT_GOAL',
      entityId: `${goal.id}:${data.projectId}`,
      action: 'LINKED',
      payload: { goalId: goal.id, projectId: data.projectId },
      actorId: viewer.principal?.id ?? null,
    })
    return tx.businessGoal.findUnique({ where: { id: goal.id }, include: GOAL_INCLUDE })
  })

  return serializeGoalDto(updated, goal.businessId)
}

export async function unlinkProjectFromGoal(goalId, projectId, { db = prisma, viewer } = {}) {
  requireOwner(viewer)
  const goal = await db.businessGoal.findUnique({ where: { id: goalId }, select: { id: true, businessId: true } })
  if (!goal) throw new Error('Goal not found')
  assertBusinessOwned(goal.businessId, viewer)
  const link = await db.projectGoal.findUnique({ where: { projectId_goalId: { projectId, goalId } } })
  if (!link) throw new Error('Project link not found')

  const updated = await db.$transaction(async (tx) => {
    await tx.projectGoal.delete({ where: { projectId_goalId: { projectId, goalId } } })
    await recordAudit(tx, {
      entityType: 'PROJECT_GOAL',
      entityId: `${goal.id}:${projectId}`,
      action: 'UNLINKED',
      payload: { goalId: goal.id, projectId },
      actorId: viewer.principal?.id ?? null,
    })
    return tx.businessGoal.findUnique({ where: { id: goal.id }, include: GOAL_INCLUDE })
  })

  return serializeGoalDto(updated, goal.businessId)
}

// ---- key result --------------------------------------------------------
// @req FR-268, SDD-107, BR-044 — OWNER-only, same authority as every other
// write in this file (ADR-101 D4: a narrower Key-Result-owner grant is
// explicit future work, not assumed here). Every write that changes a check-
// in or a Key Result's archived status recomputes the parent goal's
// `progress` in the SAME transaction (recomputeGoalProgress below), so a
// reader of the goal never observes a check-in without the number it
// produced.

/**
 * Recompute and persist a goal's progress from its own active (non-archived)
 * Key Results, inside the caller's transaction. Returns the new percent, or
 * `null` when there are no active Key Results left to roll up — archiving a
 * goal's last Key Result leaves `progress` at its last computed value rather
 * than resetting it to 0, so BR-044's manual-edit gate reopens on a real
 * number, not a discontinuity.
 *
 * `overrideValueFor(keyResultId)` lets a caller supply the value a check-in
 * just wrote before that write would otherwise be visible to this query —
 * belt-and-suspenders alongside the transaction's own read-your-writes
 * guarantee, so this function's correctness never depends on relying on it.
 */
async function recomputeGoalProgress(tx, goalId, { overrideValueFor } = {}) {
  const siblings = await tx.businessKeyResult.findMany({
    where: { goalId, status: { not: 'ARCHIVED' } },
    include: { checkIns: { orderBy: { weekStartAt: 'desc' }, take: 1 } },
  })
  if (siblings.length === 0) return null
  const percents = siblings.map((sibling) => {
    const overridden = overrideValueFor ? overrideValueFor(sibling.id) : undefined
    const current = overridden !== undefined && overridden !== null
      ? overridden
      : (sibling.checkIns[0] ? sibling.checkIns[0].value : sibling.baseline)
    return keyResultProgress(sibling, current)
  })
  const rollup = rollupGoal(percents)
  await tx.businessGoal.update({ where: { id: goalId }, data: { progress: rollup.percent, version: { increment: 1 } } })
  return rollup.percent
}

export async function createKeyResult(goalId, input, { db = prisma, viewer } = {}) {
  requireOwner(viewer)
  const data = zKeyResultCreateInput.parse(input)
  const goal = await db.businessGoal.findUnique({ where: { id: goalId }, select: { id: true, businessId: true } })
  if (!goal) throw new Error('Goal not found')
  assertBusinessOwned(goal.businessId, viewer)

  let code
  if (data.code) {
    if (await db.businessKeyResult.findUnique({ where: { code: data.code } })) {
      throw conflict(`Key Result code "${data.code}" already exists`)
    }
    code = data.code
  } else {
    code = await uniqueHumanCode('KR', data.title, async (candidate) =>
      Boolean(await db.businessKeyResult.findUnique({ where: { code: candidate } }))
    )
  }

  const kr = await db.$transaction(async (tx) => {
    const created = await tx.businessKeyResult.create({
      data: {
        code,
        businessId: goal.businessId,
        goalId,
        title: data.title,
        metric: data.metric,
        unit: data.unit,
        baseline: data.baseline,
        target: data.target,
        direction: data.direction,
        dueAt: data.dueAt ?? null,
        ownerPersonId: data.ownerPersonId ?? null,
        confidence: data.confidence,
      },
      include: KEY_RESULT_INCLUDE,
    })
    // A brand-new Key Result starts at its baseline (0% progress) with no
    // check-in yet, so it changes the goal's rollup the moment it exists —
    // recompute now rather than waiting for the first check-in.
    await recomputeGoalProgress(tx, goalId)
    await recordAudit(tx, {
      entityType: 'BUSINESS_KEY_RESULT',
      entityId: created.id,
      action: 'CREATED',
      payload: { code, goalId, businessId: goal.businessId },
      actorId: viewer.principal?.id ?? null,
      businessId: goal.businessId,
    })
    return created
  })

  return serializeKeyResultDto(kr)
}

export async function updateKeyResult(id, patch, { db = prisma, viewer } = {}) {
  requireOwner(viewer)
  const data = zKeyResultPatchInput.parse(patch)
  const existing = await db.businessKeyResult.findUnique({ where: { id } })
  if (!existing) throw new Error('Key Result not found')
  assertBusinessOwned(existing.businessId, viewer)

  if (data.target !== undefined || data.baseline !== undefined) {
    const nextBaseline = data.baseline ?? existing.baseline
    const nextTarget = data.target ?? existing.target
    if (nextTarget === nextBaseline) throw badRequest('target must differ from baseline (FR-271 Measurable)')
  }

  if (Object.keys(data).length === 0) {
    const unchanged = await db.businessKeyResult.findUnique({ where: { id }, include: KEY_RESULT_INCLUDE })
    return serializeKeyResultDto(unchanged)
  }

  const kr = await db.$transaction(async (tx) => {
    const updated = await tx.businessKeyResult.update({
      where: { id },
      data: {
        title: data.title ?? existing.title,
        metric: data.metric ?? existing.metric,
        unit: data.unit ?? existing.unit,
        baseline: data.baseline ?? existing.baseline,
        target: data.target ?? existing.target,
        direction: data.direction ?? existing.direction,
        dueAt: data.dueAt === undefined ? existing.dueAt : data.dueAt,
        ownerPersonId: data.ownerPersonId === undefined ? existing.ownerPersonId : data.ownerPersonId,
        confidence: data.confidence ?? existing.confidence,
        status: data.status ?? existing.status,
        version: { increment: 1 },
      },
      include: KEY_RESULT_INCLUDE,
    })
    // baseline/target/direction/status can all move what this Key Result
    // contributes to its goal's rollup — recompute unconditionally rather
    // than trying to enumerate which patched fields matter.
    await recomputeGoalProgress(tx, existing.goalId)
    await recordAudit(tx, {
      entityType: 'BUSINESS_KEY_RESULT',
      entityId: id,
      action: 'UPDATED',
      payload: data,
      actorId: viewer.principal?.id ?? null,
      businessId: existing.businessId,
    })
    return updated
  })

  return serializeKeyResultDto(kr)
}

// No separate archiveKeyResult: `updateKeyResult(id, { status: 'ARCHIVED' })`
// already recomputes the parent goal's rollup unconditionally (a status
// change is exactly the kind of edit that changes what a goal rolls up from),
// the same way BusinessGoal itself has no dedicated archive verb — archiving
// a goal is a PATCH with `status: 'ARCHIVED'` too.

/**
 * Weekly check-in (FR-268). Upserts by (keyResultId, weekStartFor(now)) —
 * a second check-in the same week updates the same row rather than
 * accumulating duplicates a "latest" read would have to disambiguate — and
 * write-through recomputes the parent goal's progress in the same
 * transaction (SDD-107).
 */
export async function recordKeyResultCheckIn(keyResultId, input, { db = prisma, viewer, now = Date.now() } = {}) {
  requireOwner(viewer)
  const data = zCheckInInput.parse(input)
  const existing = await db.businessKeyResult.findUnique({ where: { id: keyResultId } })
  if (!existing) throw new Error('Key Result not found')
  assertBusinessOwned(existing.businessId, viewer)

  const weekStartAt = weekStartFor(now)
  const actorId = viewer.principal?.id ?? null

  const result = await db.$transaction(async (tx) => {
    await tx.businessKeyResultCheckIn.upsert({
      where: { keyResultId_weekStartAt: { keyResultId, weekStartAt } },
      create: {
        keyResultId,
        weekStartAt,
        value: data.value,
        confidence: data.confidence,
        note: data.note ?? null,
        actorPersonId: actorId,
      },
      update: {
        value: data.value,
        confidence: data.confidence,
        note: data.note ?? null,
        actorPersonId: actorId,
      },
    })
    if (data.confidence !== existing.confidence) {
      await tx.businessKeyResult.update({
        where: { id: keyResultId },
        data: { confidence: data.confidence, version: { increment: 1 } },
      })
    }
    await recomputeGoalProgress(tx, existing.goalId, {
      overrideValueFor: (id) => (id === keyResultId ? data.value : undefined),
    })
    await recordAudit(tx, {
      entityType: 'BUSINESS_KEY_RESULT',
      entityId: keyResultId,
      action: 'CHECKED_IN',
      payload: { weekStartAt, value: data.value, confidence: data.confidence, note: data.note ?? null },
      actorId,
      businessId: existing.businessId,
    })
    return tx.businessKeyResult.findUnique({ where: { id: keyResultId }, include: KEY_RESULT_INCLUDE })
  })

  return serializeKeyResultDto(result, now)
}
