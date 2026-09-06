import prisma from '@/lib/db'
import { dryRunPlan } from '../plan-import-service'
import { zExecutionPlanBundle, validateBundleSemantics } from './bundle-schema'
import { resolveBundleScope, resolveProjectWorkspace, resolveStrategy } from './bundle-resolver'

// @req FR-108 — the combined bundle dry-run: Phases A–F of the ADR-049 D3
// lifecycle in one read-only pass, producing the single preview a Human
// confirms once (D7).
// @spec ADR-049, SDD-056, BR-007, BR-009, SEC-001, SEC-002
// @tested tests/integration/execution-plan-bundle.test.js
//
//   A  resolve trusted viewer + Business ceiling (before any sensitive parsing)
//   B  bundle schema + bundle-level semantics
//   C  strategy dry-run (Roadmap/Horizons/Goals → INSERT/UPDATE/CONFLICT)
//   D  per-Project: resolve Workspace, inject resolved goal ids, run the
//      EXISTING PlanEnvelope dry-run — never a second classifier
//   E  cross-Project dependency validation against the combined preview
//   F  one combined preview; any unresolved conflict anywhere keeps the whole
//      bundle non-committable
//
// Writes nothing. State is NOT carried to commit: commitBundle re-runs this
// dry-run (the commitPlan precedent — one decision point, not two that could
// disagree), so there is no confirmation token to replay or spoof.

/**
 * Cycle check for the COMBINED graph: the bundle's PROJECT→PROJECT edges plus
 * every existing PROJECT-typed dependency edge in the database. Pure DFS over
 * an adjacency map; nodes are project codes for bundle-side edges joined onto
 * database ids through the codes the preview resolved.
 */
async function combinedDependencyCycle(bundleEdges, db) {
  const existing = await db.dependency.findMany({
    where: { sourceType: 'PROJECT', targetType: 'PROJECT' },
    select: { sourceId: true, targetId: true },
  })
  const adjacency = new Map()
  const addEdge = (from, to) => {
    if (!adjacency.has(from)) adjacency.set(from, new Set())
    adjacency.get(from).add(to)
  }
  for (const edge of existing) addEdge(`id:${edge.sourceId}`, `id:${edge.targetId}`)
  for (const edge of bundleEdges) {
    // A bundle project that already exists participates under its database id
    // so bundle edges and existing edges meet in one graph; a brand-new
    // project cannot yet appear in any existing edge, so its code is enough.
    addEdge(edge.sourceProjectId ? `id:${edge.sourceProjectId}` : `code:${edge.sourceProjectCode}`,
      edge.targetProjectId ? `id:${edge.targetProjectId}` : `code:${edge.targetProjectCode}`)
  }
  const state = new Map()
  let cyclic = false
  const visit = (node) => {
    if (cyclic || state.get(node) === 'done') return
    if (state.get(node) === 'visiting') {
      cyclic = true
      return
    }
    state.set(node, 'visiting')
    for (const next of adjacency.get(node) || []) visit(next)
    state.set(node, 'done')
  }
  for (const node of adjacency.keys()) visit(node)
  return cyclic
}

/**
 * Validate + preview a whole ExecutionPlanBundle. Read-only.
 *
 * `viewer` is REQUIRED and authorized first (D5): previewing another tenant's
 * bundle is refused exactly as a write would be. `db` lets commitBundle run
 * the identical pass inside its transaction.
 *
 * Returns `{ valid, errors, bundle, business, defaultWorkspace, strategy,
 * projects, dependencies, preview }`; `preview` is the one combined object the
 * confirm screen renders and `valid === (conflict count === 0)`.
 */
export async function dryRunBundle(rawBundle, { viewer, db = prisma } = {}) {
  // Phase A — authorize before parsing anything beyond the scope selector.
  const scope = await resolveBundleScope(rawBundle, { viewer, db })
  if (scope.error) return { valid: false, errors: [scope.error], preview: null }
  const { business, defaultWorkspace } = scope

  // Phase B — shape, then bundle-level semantics.
  const parsed = zExecutionPlanBundle.safeParse(rawBundle)
  if (!parsed.success) {
    return {
      valid: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
      preview: null,
    }
  }
  const bundle = parsed.data
  const semanticErrors = validateBundleSemantics(bundle)
  if (semanticErrors.length > 0) {
    return { valid: false, errors: semanticErrors, preview: null }
  }

  const errors = []

  // Phase C — strategy classification + symbol map.
  const strategy = await resolveStrategy(bundle, { business, viewer, db })
  for (const conflict of strategy.conflicts) {
    errors.push(`${conflict.kind} ${conflict.code}: ${conflict.reason}`)
  }

  // Phase D — every Project entry through the EXISTING PlanEnvelope dry-run.
  const projects = []
  for (const entry of bundle.projects) {
    const target = await resolveProjectWorkspace(entry, { business, defaultWorkspace, db })
    if (target.error) {
      errors.push(target.error)
      projects.push({
        bundleProjectRef: entry.bundleProjectRef,
        projectCode: entry.plan.project.code,
        valid: false,
        errors: [target.error],
        preview: null,
        pendingGoalRefs: [],
      })
      continue
    }

    // D4 — inject canonical ids for goals that exist now; a NEW goal has no
    // UUID until commit creates it inside the same transaction, so it appears
    // in the preview as a pending symbol instead of a fabricated id.
    const resolvedGoalIds = []
    const pendingGoalRefs = []
    for (const goalRef of entry.goalRefs) {
      const symbol = strategy.goalsByRef.get(goalRef)
      if (!symbol) continue // already a semantic error above
      if (symbol.status === 'EXISTING') resolvedGoalIds.push(symbol.id)
      else pendingGoalRefs.push(goalRef)
    }
    const plan = structuredClone(entry.plan)
    if (resolvedGoalIds.length) {
      plan.project.goalIds = [...new Set([...(plan.project.goalIds || []), ...resolvedGoalIds])]
    }

    const dry = await dryRunPlan(plan, { workspaceId: target.workspaceId, viewer, db })
    // Cross-Business fail-closed (D4): when the Workspace came from the nested
    // plan's own scope, it authorized against the viewer — but the bundle's
    // ceiling is ONE Business, so a Workspace of another (even owned) Business
    // is still refused, with the same wording a missing code gets.
    if (dry.workspace && dry.workspace.businessId !== business.id) {
      const message = `Project "${entry.bundleProjectRef}": Bundle workspaceCode "${plan.scope?.workspaceCode || '(none)'}" does not match a workspace in the bundle's Business scope.`
      errors.push(message)
      projects.push({
        bundleProjectRef: entry.bundleProjectRef,
        projectCode: entry.plan.project.code,
        valid: false,
        errors: [message],
        preview: null,
        pendingGoalRefs,
      })
      continue
    }
    if (!dry.valid) {
      for (const error of dry.errors) errors.push(`Project "${entry.bundleProjectRef}": ${error}`)
    }
    projects.push({
      bundleProjectRef: entry.bundleProjectRef,
      projectCode: entry.plan.project.code,
      workspaceId: dry.workspace?.id ?? target.workspaceId,
      workspace: dry.workspace ?? null,
      valid: dry.valid,
      errors: dry.errors,
      preview: dry.preview,
      pendingGoalRefs,
    })
  }

  // Phase E — cross-Project dependencies against the combined preview: only
  // meaningful once every entry has an identity candidate.
  const entryByRef = new Map(projects.map((project) => [project.bundleProjectRef, project]))
  const dependencies = []
  for (const dependency of bundle.dependencies) {
    const source = entryByRef.get(dependency.sourceProjectRef)
    const target = entryByRef.get(dependency.targetProjectRef)
    const sourceProject = source
      ? await db.project.findUnique({ where: { code: source.projectCode }, select: { id: true } })
      : null
    const targetProject = target
      ? await db.project.findUnique({ where: { code: target.projectCode }, select: { id: true } })
      : null
    dependencies.push({
      sourceProjectRef: dependency.sourceProjectRef,
      targetProjectRef: dependency.targetProjectRef,
      relation: dependency.relation,
      description: dependency.description,
      sourceProjectCode: source?.projectCode ?? null,
      targetProjectCode: target?.projectCode ?? null,
      sourceProjectId: sourceProject?.id ?? null,
      targetProjectId: targetProject?.id ?? null,
    })
  }
  if (dependencies.length > 0 && await combinedDependencyCycle(dependencies, db)) {
    errors.push('Cross-project dependencies would create a cycle with existing Project dependencies')
  }

  // Phase F — one combined preview.
  const countActions = (rows, action) => rows.filter((row) => row.action === action).length
  const strategyCounts = {
    roadmaps: { insert: strategy.roadmap?.action === 'INSERT' ? 1 : 0, update: strategy.roadmap?.action === 'UPDATE' ? 1 : 0 },
    horizons: { insert: countActions(strategy.horizons, 'INSERT'), update: countActions(strategy.horizons, 'UPDATE'), remove: strategy.removedHorizons.length },
    goals: { insert: countActions(strategy.goals, 'INSERT'), update: countActions(strategy.goals, 'UPDATE') },
  }
  const projectCounts = projects.reduce(
    (sum, project) => ({
      inserts: sum.inserts + (project.preview?.summary.insertCount ?? 0),
      updates: sum.updates + (project.preview?.summary.updateCount ?? 0),
      conflicts: sum.conflicts + (project.preview?.summary.conflictCount ?? 0),
    }),
    { inserts: 0, updates: 0, conflicts: 0 }
  )

  const valid = errors.length === 0 && projects.every((project) => project.valid)

  return {
    valid,
    errors,
    bundle,
    business: { id: business.id, code: business.code, name: business.name },
    defaultWorkspace: defaultWorkspace
      ? { id: defaultWorkspace.id, code: defaultWorkspace.code, name: defaultWorkspace.name }
      : null,
    strategy,
    projects,
    dependencies,
    preview: {
      target: {
        businessCode: business.code,
        defaultWorkspaceCode: defaultWorkspace?.code ?? null,
      },
      strategy: {
        roadmap: strategy.roadmap,
        horizons: strategy.horizons,
        removedHorizons: strategy.removedHorizons.map(({ key }) => ({ key })),
        goals: strategy.goals,
      },
      symbols: {
        goals: Object.fromEntries(
          [...strategy.goalsByRef.entries()].map(([ref, symbol]) => [ref, { status: symbol.status, id: symbol.id ?? null, code: symbol.code }])
        ),
        projects: Object.fromEntries(
          projects.map((project) => [project.bundleProjectRef, { code: project.projectCode }])
        ),
      },
      projects: projects.map((project) => ({
        bundleProjectRef: project.bundleProjectRef,
        projectCode: project.projectCode,
        workspaceId: project.workspaceId ?? null,
        valid: project.valid,
        preview: project.preview,
        pendingGoalRefs: project.pendingGoalRefs,
        errors: project.errors,
      })),
      dependencies,
      counts: {
        strategy: strategyCounts,
        projects: { count: projects.length, ...projectCounts },
        dependencies: dependencies.length,
      },
      conflicts: errors,
      summary: {
        insertCount: projectCounts.inserts + strategyCounts.roadmaps.insert + strategyCounts.horizons.insert + strategyCounts.goals.insert,
        updateCount: projectCounts.updates + strategyCounts.roadmaps.update + strategyCounts.horizons.update + strategyCounts.goals.update,
        conflictCount: errors.length + projectCounts.conflicts,
      },
    },
  }
}
