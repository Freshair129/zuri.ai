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
import { zRoadmapStatus, zGoalStatus, zGoalPriority } from '@/lib/validation/enums'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { recordAudit } from './audit'

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
  progress: z.number().min(0).max(100).optional(),
  startAt: z.coerce.date().nullish().optional(),
  targetAt: z.coerce.date().nullish().optional(),
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

function serializeGoalDto(goal, businessId) {
  return {
    id: goal.id,
    code: goal.code,
    title: goal.title,
    description: goal.description,
    status: goal.status,
    priority: goal.priority,
    progress: goal.progress,
    startAt: goal.startAt,
    targetAt: goal.targetAt,
    projects: (goal.projects || [])
      .map((link) => projectLinkDto(link.project, businessId))
      .filter(Boolean),
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
const GOAL_INCLUDE = { projects: { include: { project: PROJECT_SELECT } } }
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
