import prisma from '@/lib/db'
import { isApiAccessFor, ownsBusiness } from '@/modules/identity/viewer-authority'

// @req FR-108 — bundle-local symbol and scope resolution (ADR-049 D4/D5).
// @spec ADR-049, SDD-056, SEC-001, SEC-002, BR-001, BR-002
// @tested tests/integration/execution-plan-bundle.test.js
//
// Two jobs, both fail-closed:
//
//   1. **Scope (Phase A).** The bundle's `scope.businessCode` is a selector
//      inside the trusted viewer's ceiling, never proof of authority. It is
//      resolved and authorized BEFORE anything else in the bundle is parsed —
//      an unauthorized dry-run is refused exactly as a commit would be, and a
//      Business the viewer was not given answers identically to one that does
//      not exist (the FR-065 `missing()` discipline, one level up).
//
//   2. **Symbols (Phases C/D).** Bundle-local refs (`GOAL-KNOWLEDGE`,
//      `PROJECT-GKS`) resolve to canonical rows inside the authorized Business
//      only. Unknown, ambiguous, cross-Business, cross-Workspace or
//      type-mismatched targets are conflicts, never guesses; a ref grants no
//      authority (D4). Type mismatch is structurally excluded: a goal ref is
//      only ever looked up in BusinessGoal, a roadmap code only in
//      BusinessRoadmap — there is no shared symbol table to cross.

/**
 * Phase A. Reads ONLY `scope.businessCode` / `scope.defaultWorkspaceCode` from
 * the raw bundle (the fields naming the target — never the body), resolves
 * the Business, and decides authority with the same composition the existing
 * import surface uses: `ownsBusiness`, or an Enterprise API key bound to the
 * Business's own Tenant (`isApiAccessFor`, FR-106) — the Tenant resolved from
 * the Business row itself, never from anything the request claims.
 *
 * Refusal is indistinguishable from absence.
 */
export async function resolveBundleScope(rawBundle, { viewer, db = prisma } = {}) {
  if (viewer === undefined || viewer === null) {
    throw new Error(
      'resolveBundleScope(): viewer is required — a bundle target is authorized ' +
      'against a resolved viewer, never against the payload that named it'
    )
  }
  const businessCode =
    typeof rawBundle?.scope?.businessCode === 'string' ? rawBundle.scope.businessCode : null
  const defaultWorkspaceCode =
    typeof rawBundle?.scope?.defaultWorkspaceCode === 'string' ? rawBundle.scope.defaultWorkspaceCode : null

  const missingBusiness = () =>
    `Bundle scope.businessCode "${businessCode || '(none)'}" does not match an authorized Business — select a target Business.`

  const business = businessCode
    ? await db.business.findUnique({
      where: { code: businessCode },
      select: { id: true, code: true, name: true, tenantId: true },
    })
    : null
  if (!business) return { error: missingBusiness() }

  const authorized = ownsBusiness(viewer, business.id) || isApiAccessFor(viewer, business.tenantId)
  if (!authorized) return { error: missingBusiness() }

  let defaultWorkspace = null
  if (defaultWorkspaceCode) {
    const resolved = await resolveScopedWorkspace(defaultWorkspaceCode, { business, db })
    if (resolved.error) return { error: resolved.error }
    defaultWorkspace = resolved.workspace
  }

  return { business, defaultWorkspace }
}

/**
 * Resolve a workspaceCode strictly inside the bundle's authorized Business.
 * A code that is missing, or that names a Workspace of ANY other scope
 * (another Business, a Tenant/Portfolio workspace), gets one identical
 * message: cross-Business must not be distinguishable from nonexistent, or
 * the refusal becomes an enumeration oracle over other tenants' codes.
 */
export async function resolveScopedWorkspace(workspaceCode, { business, db = prisma }) {
  const missing = () =>
    `Bundle workspaceCode "${workspaceCode}" does not match a workspace in the bundle's Business scope.`
  const workspace = await db.workspace.findUnique({ where: { code: workspaceCode } })
  if (!workspace || workspace.scopeType !== 'BUSINESS' || workspace.businessId !== business.id) {
    return { error: missing() }
  }
  return { workspace }
}

/**
 * Which Workspace does one bundle Project entry target?
 * Order (EXECUTION-PLAN-BUNDLE.md §6 Phase D): the entry's own override →
 * the bundle default → the nested PlanEnvelope's `scope.workspaceCode`
 * (resolved by the existing per-Project pipeline itself, then verified by the
 * caller to sit inside the bundle's Business).
 *
 * Returns `{ workspaceId }` (possibly undefined — meaning: defer to the
 * nested plan's own scope) or `{ error }`.
 */
export async function resolveProjectWorkspace(entry, { business, defaultWorkspace, db = prisma }) {
  if (entry.workspaceCode) {
    const resolved = await resolveScopedWorkspace(entry.workspaceCode, { business, db })
    if (resolved.error) return { error: `Project "${entry.bundleProjectRef}": ${resolved.error}` }
    return { workspaceId: resolved.workspace.id }
  }
  if (defaultWorkspace) return { workspaceId: defaultWorkspace.id }
  return { workspaceId: undefined }
}

/**
 * Phase C — classify the strategy section against the authorized Business and
 * build the deterministic symbol map the dry-run and commit both consume.
 * Read-only.
 *
 * Returns:
 *   {
 *     conflicts: [{ kind, code|ref, reason }],
 *     roadmap:   null | { action: 'INSERT'|'UPDATE', code, id? },
 *     horizons:  [{ ref, key, action: 'INSERT'|'UPDATE', id? }],
 *     removedHorizons: [{ key, id, goalCount }],
 *     goals:     [{ ref, code, action: 'INSERT'|'UPDATE', id?, horizonRef }],
 *     goalsByRef: Map(ref -> { status: 'EXISTING'|'NEW', id?, code }),
 *   }
 *
 * Strategy writes are FR-059 owner-scoped, so a viewer that reached Phase A on
 * an Enterprise API key alone (isApiAccessFor without ownsBusiness) gets a
 * strategy conflict here rather than a 403 mid-commit: the dry-run must refuse
 * everything the commit would refuse (D7).
 */
export async function resolveStrategy(bundle, { business, viewer, db = prisma }) {
  const strategy = bundle.strategy
  const result = {
    conflicts: [],
    roadmap: null,
    horizons: [],
    removedHorizons: [],
    goals: [],
    goalsByRef: new Map(),
  }
  if (!strategy || (!strategy.roadmap && strategy.goals.length === 0)) return result

  if (!ownsBusiness(viewer, business.id)) {
    result.conflicts.push({
      kind: 'strategy',
      code: business.code,
      reason: 'Bundle strategy writes (Roadmap/Horizons/Goals) require owner authority over the target Business',
    })
    return result
  }

  // ---- roadmap -------------------------------------------------------------
  let existingRoadmap = null
  let existingHorizons = []
  if (strategy.roadmap) {
    existingRoadmap = await db.businessRoadmap.findUnique({ where: { code: strategy.roadmap.code } })
    if (existingRoadmap && existingRoadmap.businessId !== business.id) {
      // Same wording rule as everywhere else: outside the authorized scope is
      // reported as "already exists outside", never which scope.
      result.conflicts.push({
        kind: 'roadmap',
        code: strategy.roadmap.code,
        reason: `Roadmap code "${strategy.roadmap.code}" already exists outside the bundle's Business scope`,
      })
      return result
    }
    result.roadmap = existingRoadmap
      ? { action: 'UPDATE', code: existingRoadmap.code, id: existingRoadmap.id }
      : { action: 'INSERT', code: strategy.roadmap.code }
    if (existingRoadmap) {
      existingHorizons = await db.businessRoadmapHorizon.findMany({ where: { roadmapId: existingRoadmap.id } })
    }

    // ---- horizons ----------------------------------------------------------
    // The FR-059 service reconciles the roadmap's horizon set to the submitted
    // list, so the bundle's horizons — when present — are the whole set.
    if (strategy.horizons.length > 0 || !existingRoadmap) {
      if (strategy.horizons.length < 2 || strategy.horizons.length > 3) {
        result.conflicts.push({
          kind: 'horizon',
          code: strategy.roadmap.code,
          reason: 'Business roadmap must have 2 or 3 horizons',
        })
      }
      const existingByKey = new Map(existingHorizons.map((horizon) => [horizon.key, horizon]))
      for (const horizon of strategy.horizons) {
        const existing = existingByKey.get(horizon.key)
        result.horizons.push(
          existing
            ? { ref: horizon.ref, key: horizon.key, action: 'UPDATE', id: existing.id }
            : { ref: horizon.ref, key: horizon.key, action: 'INSERT' }
        )
      }
      const submittedKeys = new Set(strategy.horizons.map((horizon) => horizon.key))
      for (const horizon of existingHorizons) {
        if (submittedKeys.has(horizon.key)) continue
        const goalCount = await db.businessGoal.count({ where: { horizonId: horizon.id } })
        if (goalCount > 0) {
          result.conflicts.push({
            kind: 'horizon',
            code: horizon.key,
            reason: `Bundle omits horizon "${horizon.key}", which still has ${goalCount} goal(s) attached — the reconcile would be refused`,
          })
        } else {
          result.removedHorizons.push({ key: horizon.key, id: horizon.id, goalCount })
        }
      }
    }
  }

  // ---- goals ---------------------------------------------------------------
  const horizonRefSet = new Set(strategy.horizons.map((horizon) => horizon.ref))
  for (const goal of strategy.goals) {
    const existing = await db.businessGoal.findUnique({ where: { code: goal.code } })
    if (existing && existing.businessId !== business.id) {
      result.conflicts.push({
        kind: 'goal',
        code: goal.code,
        reason: `Goal code "${goal.code}" already exists outside the bundle's Business scope`,
      })
      continue
    }
    if (existing) {
      result.goals.push({ ref: goal.ref, code: goal.code, action: 'UPDATE', id: existing.id, horizonRef: goal.horizonRef })
      result.goalsByRef.set(goal.ref, { status: 'EXISTING', id: existing.id, code: goal.code })
    } else {
      // A NEW goal needs a horizon: the FR-059 create contract requires one
      // (a goal without a horizon is invisible to the frozen FR-041 read
      // model), and the bundle can only name horizons it carries itself.
      if (!goal.horizonRef) {
        result.conflicts.push({
          kind: 'goal',
          code: goal.code,
          reason: `Goal "${goal.ref}" would be created but has no horizonRef — a new Business Goal requires a horizon`,
        })
        continue
      }
      if (!horizonRefSet.has(goal.horizonRef)) {
        // validateBundleSemantics already rejects this; kept as belt-and-braces
        // because this resolver is also callable on its own.
        result.conflicts.push({
          kind: 'goal',
          code: goal.code,
          reason: `Goal "${goal.ref}" references unknown horizonRef "${goal.horizonRef}"`,
        })
        continue
      }
      result.goals.push({ ref: goal.ref, code: goal.code, action: 'INSERT', horizonRef: goal.horizonRef })
      result.goalsByRef.set(goal.ref, { status: 'NEW', code: goal.code })
    }
  }

  return result
}
