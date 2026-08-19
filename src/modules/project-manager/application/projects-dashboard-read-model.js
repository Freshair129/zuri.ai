import { z } from 'zod'
import prisma from '@/lib/db'
import { PROJECT_PRIORITIES, PROJECT_STATUSES, WORK_STATUSES } from '@/lib/validation/enums'
import { seesBusiness } from '@/modules/identity/viewer-authority'
import { requireViewer } from './project-authorization'
import { activeWorkstream } from './active-filters'
import { safeParse } from './audit'
import { calculateWorkstreamProgress } from '../progress/strategies'
import { rollupProject } from '../progress/rollup'

// @req FR-086 — one composed, authorized, read-only DTO behind
// `GET /api/projects/overview`: the KPI band, the enriched list rows and the
// Top-5-by-priority panel in a single response.
// @spec SDD-047, ADR-036, SEC-001, SDD-045, ADR-034
// @tested tests/unit/projects-dashboard-read-model.test.js, tests/integration/projects-dashboard.test.js
//
// **Why this file exists at all.** A progress bar on every row means one
// `/api/progress/project/{id}` call per project — an N+1 across the page's main
// content (ADR-036 D6). Every figure here is produced by a query count that is
// *constant in the number of Projects*: seven Prisma calls whether the scope
// holds one Project or five hundred (see `readDashboardSources`, which states
// what each one buys). If a change to this file introduces a query inside a
// `map` over Projects, it has rebuilt the exact problem SDD-047 exists to avoid.
//
// **It decides nothing the surface should decide.** `PROJECT_STATUSES` has five
// values and `WORK_STATUSES` has seven; the ask named three of each. This model
// returns *every* count, so the band's parts add up to the list beneath it and
// FR-086's open question 3 — "is done `DONE`, or `DONE` + `ARCHIVED`?" — is
// answered by the surface out of complete data rather than pre-answered here out
// of incomplete data.
//
// **It never writes.** Progress comes from the pure calculators and
// `progressCache` is not touched: a read that repairs a cache is a write with a
// GET in front of it, and SDD-045 forbids it in as many words.

export const PROJECTS_DASHBOARD_VERSION = '1.0'
export const DASHBOARD_ROW_LIMIT = 500
export const DASHBOARD_PRIORITY_SCAN_LIMIT = 500
export const TOP_PRIORITY_SIZE = 5

const SHARED_SCOPE_TYPES = new Set(['TENANT', 'PORTFOLIO'])

// --- Query contract ---------------------------------------------------------

const optionalTrimmed = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    return trimmed || undefined
  },
  z.string().min(1).optional(),
)

const optionalLimit = z.preprocess(
  (value) => value === '' || value === undefined ? undefined : value,
  z.coerce.number().int().positive()
    .transform((value) => Math.min(value, DASHBOARD_ROW_LIMIT))
    .optional(),
)

/**
 * Deliberately narrower than `zProjectListQuery`: no `status`, no `q`.
 *
 * FR-086 open question 1 requires the band and the rows to use the *identical*
 * filter, and a free-text or status filter is a filter only one half of the page
 * would sensibly apply. Leaving them out means there is one scope, resolved
 * once, and no way to express a page whose two halves disagree.
 */
export const zProjectsDashboardQuery = z.object({
  workspaceId: optionalTrimmed,
  businessId: optionalTrimmed,
  limit: optionalLimit,
}).strict()

export function parseProjectsDashboardQuery(query = {}) {
  const parsed = zProjectsDashboardQuery.parse(query)
  return {
    workspaceId: parsed.workspaceId ?? null,
    businessId: parsed.businessId ?? null,
    limit: parsed.limit ?? DASHBOARD_ROW_LIMIT,
  }
}

// --- Response contract ------------------------------------------------------

const nullableIsoDate = z.string().datetime().nullable()
const count = z.number().int().nonnegative()

/**
 * A record with one key per enum value, all required.
 *
 * Built from the enum rather than hand-listed, so a status added to
 * `enums.js` fails this contract until the surface accounts for it — which is
 * the only mechanism that keeps "the numbers sum" true a year from now.
 */
const zCountsByStatus = (statuses) =>
  z.object(Object.fromEntries(statuses.map((status) => [status, count]))).strict()

const zPerson = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  displayName: z.string().min(1),
}).strict()

const zWorkspaceRef = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  scopeType: z.string().min(1),
}).strict()

const zProgress = z.object({
  percent: z.number(),
  totalWeight: z.number(),
  warnings: z.array(z.string()),
}).strict()

export const zProjectsDashboardRow = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  // ADR-036 D2 — the count of non-deleted WorkItem rows under the Project.
  // Not effort, not weight: `WorkItem.weight` and `numericValue` are neither
  // hours nor comparable across workstreams, so an effort-based "size" would be
  // a number the data cannot honestly produce.
  size: count,
  workspaceId: z.string().min(1),
  workspace: zWorkspaceRef.nullable(),
  streams: count,
  status: z.string().min(1),
  progress: zProgress,
  targetAt: nullableIsoDate,
  pic: zPerson.nullable(),
  priority: z.enum(PROJECT_PRIORITIES).nullable(),
}).strict()

export const zTopPriorityEntry = z.object({
  id: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(1),
  status: z.string().min(1),
  priority: z.enum(PROJECT_PRIORITIES),
  // The rank the panel is ordered by: the index of `priority` in
  // `PROJECT_PRIORITIES`. The array order IS the contract (most urgent first),
  // so the surface never re-derives an ordering from the label.
  rank: count,
  targetAt: nullableIsoDate,
  pic: zPerson.nullable(),
}).strict()

export const zProjectsDashboardResponse = z.object({
  readModel: z.literal('PROJECTS_DASHBOARD'),
  schemaVersion: z.literal(PROJECTS_DASHBOARD_VERSION),
  scope: z.object({
    readScope: z.enum(['BUSINESS', 'TENANT_SHARED', 'PORTFOLIO_SHARED', 'PLATFORM', 'VISIBLE_BUSINESSES']),
    workspaceId: z.string().nullable(),
    businessId: z.string().nullable(),
  }).strict(),
  counts: z.object({
    projects: z.object({ total: count, byStatus: zCountsByStatus(PROJECT_STATUSES) }).strict(),
    work: z.object({ total: count, byStatus: zCountsByStatus(WORK_STATUSES) }).strict(),
    // Two figures, never one derived from the other (ADR-036 D5, ADR-037 D4).
    // A Team can be attached to a Project with nobody assigned yet, and a person
    // can hold work while belonging to no Team.
    people: z.object({ withWorkAssigned: count }).strict(),
    teams: z.object({ onProjects: count }).strict(),
  }).strict(),
  rows: z.object({
    items: z.array(zProjectsDashboardRow),
    total: count,
    limit: z.number().int().positive(),
    truncated: z.boolean(),
  }).strict(),
  topPriority: z.object({
    state: z.enum(['READY', 'EMPTY']),
    // ADR-036 D3: when nothing carries a priority the panel must say so and
    // must NOT fall back to a `targetAt` ordering the reader would misread as
    // priority. The reason travels with the empty state so the surface can
    // render the sentence and the action that fixes it.
    reasonCode: z.enum(['NO_PROJECTS_IN_SCOPE', 'NO_PRIORITY_SET']).nullable(),
    items: z.array(zTopPriorityEntry).max(TOP_PRIORITY_SIZE),
    prioritizedTotal: count,
  }).strict(),
  meta: z.object({
    generatedAt: z.string().datetime(),
    warnings: z.array(z.string()),
  }).strict(),
}).strict()

// --- Refusals ---------------------------------------------------------------

/**
 * A scope the viewer may not read is answered exactly as a scope that does not
 * exist. Anything else turns the refusal into an enumeration oracle over other
 * tenants' Workspace and Business ids — the Tier A disclosure decision
 * `project-authorization.js` already made for writes, applied to this read.
 */
function notFound(message) {
  const error = new Error(message)
  error.status = 404
  return error
}

// --- Scope authorization ----------------------------------------------------

/**
 * Resolve the requested scope into ONE Prisma `where` fragment, refusing before
 * anything is composed.
 *
 * This is the SEC-001 / FR-072 shape applied to a read: the scope is authorized
 * *first*, and every subsequent query is constrained by the fragment returned
 * here. Nothing is fetched and then filtered — an out-of-scope Project is
 * refused at the scope, so it never enters a query at all.
 *
 * `.brain/rca/2026-08-17-read-scope-outran-the-write-scope.md` is the record of
 * the two mistakes this avoids. First, the returned fragment never contains a
 * bare `{ businessId: null }` branch: a nullable foreign key means "belongs to a
 * wider scope", and including it unconditionally crosses Tenant isolation
 * silently. Business-scoped reads use `businessId: { in: [...] }`, which no
 * ownerless row can match. Ownerless (shared-Space) Projects are readable only
 * through the explicit shared branch below, which names the wider scope it is
 * asking about. Second, the predicate is `seesBusiness` — the same *read*
 * authority `assertProjectReadable` uses for Project Inventory — because this is
 * a read model that renders nothing editable. FR-086 open question 2 leaves who
 * may *set* PIC and priority to FR-087/FR-088; when those land, the editable
 * cell authorizes on `ownsBusiness`, and it must not be this filter that is
 * widened to meet it.
 */
export async function resolveDashboardScope(viewer, { workspaceId = null, businessId = null } = {}, { db = prisma } = {}) {
  // A missing viewer is a wiring bug in the caller, not a client error: a plain
  // Error becomes a 500 rather than a quiet empty dashboard.
  requireViewer(viewer, 'resolveDashboardScope')

  const visibleBusinessIds = Array.isArray(viewer.visibleBusinessIds) ? viewer.visibleBusinessIds : []

  // A picked Space wins over the Business, matching `/projects` exactly
  // (`src/app/(pm)/projects/page.jsx` sets `workspaceId` OR `businessId`, never
  // both). Honouring one and ignoring the other keeps this endpoint's scope
  // identical to the list's rather than merely similar to it.
  if (workspaceId) {
    const workspace = await db.workspace.findUnique({
      where: { id: workspaceId },
      select: { id: true, scopeType: true, businessId: true, tenantId: true, portfolioId: true },
    })
    if (!workspace) throw notFound('Workspace not found')

    if (workspace.scopeType === 'BUSINESS') {
      if (!workspace.businessId || !seesBusiness(viewer, workspace.businessId)) throw notFound('Workspace not found')
      return {
        readScope: 'BUSINESS',
        workspaceId,
        businessId: workspace.businessId,
        where: { deletedAt: null, workspaceId, businessId: workspace.businessId },
      }
    }

    if (!SHARED_SCOPE_TYPES.has(workspace.scopeType)) throw notFound('Workspace not found')

    // A shared Space holds ownerless Projects. Readable only inside an explicit
    // tenant/portfolio relationship — the wider scope is named, never assumed.
    const readScope = `${workspace.scopeType}_SHARED`
    const sharedWhere = { deletedAt: null, workspaceId, businessId: null }
    if (viewer.isPlatform === true) {
      return { readScope: 'PLATFORM', workspaceId, businessId: null, where: sharedWhere }
    }
    if (!visibleBusinessIds.length) throw notFound('Workspace not found')
    if (workspace.scopeType === 'TENANT' && !workspace.tenantId) throw notFound('Workspace not found')
    if (workspace.scopeType === 'PORTFOLIO' && !workspace.portfolioId) throw notFound('Workspace not found')
    const related = await db.business.count({
      where: workspace.scopeType === 'TENANT'
        ? { id: { in: visibleBusinessIds }, tenantId: workspace.tenantId }
        : { id: { in: visibleBusinessIds }, tenant: { portfolioId: workspace.portfolioId } },
    })
    if (!related) throw notFound('Workspace not found')
    return { readScope, workspaceId, businessId: null, where: sharedWhere }
  }

  if (businessId) {
    if (!seesBusiness(viewer, businessId)) throw notFound('Business not found')
    return {
      readScope: 'BUSINESS',
      workspaceId: null,
      businessId,
      where: { deletedAt: null, businessId },
    }
  }

  // No selection: everything the viewer may see, and nothing else. A viewer with
  // no visible Business gets `in: []` — an honest empty dashboard, and still no
  // path by which an ownerless Project could appear.
  return {
    readScope: 'VISIBLE_BUSINESSES',
    workspaceId: null,
    businessId: null,
    where: { deletedAt: null, businessId: { in: visibleBusinessIds } },
  }
}

// --- Pure composition -------------------------------------------------------

const isoDate = (value) => value == null ? null : new Date(value).toISOString()

function zeroed(statuses) {
  return Object.fromEntries(statuses.map((status) => [status, 0]))
}

/**
 * Fold `groupBy` rows into a complete per-status record.
 *
 * A status the database holds that the enum does not know about is counted into
 * the total but has nowhere to live in `byStatus`, so it would make the band
 * stop summing. It is reported as a warning instead of being dropped silently —
 * the drift is a data problem, and a band that quietly disagrees with the list
 * beneath it is exactly the failure ADR-036's Consequences section names.
 */
function foldStatusCounts(rows, statuses, label, warnings) {
  const byStatus = zeroed(statuses)
  let total = 0
  for (const row of rows || []) {
    const value = Number(row.count) || 0
    total += value
    if (Object.prototype.hasOwnProperty.call(byStatus, row.status)) byStatus[row.status] += value
    else warnings.push(`${label}: ${value} row(s) hold unknown status "${row.status}" and are counted in the total only`)
  }
  return { total, byStatus }
}

function personDto(person) {
  return person
    ? { id: person.id, code: person.code, displayName: person.displayName }
    : null
}

function knownPriority(value) {
  return PROJECT_PRIORITIES.includes(value) ? value : null
}

function rowDto(project, { size = 0, progress = null } = {}) {
  return {
    id: project.id,
    code: project.code,
    name: project.name,
    size,
    workspaceId: project.workspaceId,
    workspace: project.workspace
      ? {
        id: project.workspace.id,
        code: project.workspace.code,
        name: project.workspace.name,
        scopeType: project.workspace.scopeType,
      }
      : null,
    streams: Array.isArray(project.workstreams) ? project.workstreams.length : 0,
    status: project.status,
    progress: progress || { percent: 0, totalWeight: 0, warnings: [] },
    targetAt: isoDate(project.targetAt),
    pic: personDto(project.pic),
    // An unrecognised value is surfaced as unset rather than as itself: the
    // column renders "—" instead of teaching a word the enum does not define.
    priority: knownPriority(project.priority),
  }
}

const priorityRank = (value) => PROJECT_PRIORITIES.indexOf(value)
const targetKey = (value) => value == null ? Number.POSITIVE_INFINITY : new Date(value).getTime()

/**
 * Order by `PROJECT_PRIORITIES` index — the array order IS the contract — then
 * by `targetAt` inside a tie, then by code so the panel is deterministic.
 *
 * A Project with no priority, or with a priority outside the enum, is NOT
 * ranked in. That is the whole point of ADR-036 D3: the one substitution the
 * design forbids is quietly filling this panel with a `targetAt` ordering under
 * a heading that says "Priority".
 */
export function rankTopPriority(projects = [], size = TOP_PRIORITY_SIZE) {
  return projects
    .map((project) => ({ project, priority: knownPriority(project.priority) }))
    .filter((entry) => entry.priority !== null)
    .sort((a, b) =>
      priorityRank(a.priority) - priorityRank(b.priority)
      || targetKey(a.project.targetAt) - targetKey(b.project.targetAt)
      || String(a.project.code).localeCompare(String(b.project.code)))
    .slice(0, size)
    .map(({ project, priority }) => ({
      id: project.id,
      code: project.code,
      name: project.name,
      status: project.status,
      priority,
      rank: priorityRank(priority),
      targetAt: isoDate(project.targetAt),
      pic: personDto(project.pic),
    }))
}

/**
 * Pure DTO builder over already-authorized aggregates.
 *
 * It takes counts rather than rows for the band on purpose: the band is
 * authoritative over the whole scope even when the row list is capped, so the
 * two can never be composed from different populations by accident.
 */
export function buildProjectsDashboardReadModel({
  scope = { readScope: 'VISIBLE_BUSINESSES', workspaceId: null, businessId: null },
  projectStatusCounts = [],
  workStatusCounts = [],
  headcount = 0,
  teamCount = 0,
  projects = [],
  sizeByProjectId = {},
  progressByProjectId = {},
  prioritized = [],
  limit = DASHBOARD_ROW_LIMIT,
} = {}) {
  const warnings = []
  const projectCounts = foldStatusCounts(projectStatusCounts, PROJECT_STATUSES, 'Projects', warnings)
  const workCounts = foldStatusCounts(workStatusCounts, WORK_STATUSES, 'Work items', warnings)

  const items = projects.map((project) => rowDto(project, {
    size: Number(sizeByProjectId[project.id] || 0),
    progress: progressByProjectId[project.id] || null,
  }))
  const truncated = projectCounts.total > items.length
  if (truncated) {
    warnings.push(
      `Showing ${items.length} of ${projectCounts.total} Projects — the band counts every Project in scope, ` +
      'the list is capped. Narrow the Space or Business selection to make the two match.',
    )
  }

  const topItems = rankTopPriority(prioritized, TOP_PRIORITY_SIZE)
  const prioritizedTotal = prioritized.filter((project) => knownPriority(project.priority) !== null).length

  return zProjectsDashboardResponse.parse({
    readModel: 'PROJECTS_DASHBOARD',
    schemaVersion: PROJECTS_DASHBOARD_VERSION,
    scope: {
      readScope: scope.readScope,
      workspaceId: scope.workspaceId ?? null,
      businessId: scope.businessId ?? null,
    },
    counts: {
      projects: projectCounts,
      work: workCounts,
      people: { withWorkAssigned: headcount },
      teams: { onProjects: teamCount },
    },
    rows: { items, total: projectCounts.total, limit, truncated },
    topPriority: {
      state: topItems.length ? 'READY' : 'EMPTY',
      reasonCode: topItems.length
        ? null
        : projectCounts.total === 0 ? 'NO_PROJECTS_IN_SCOPE' : 'NO_PRIORITY_SET',
      items: topItems,
      prioritizedTotal,
    },
    meta: { generatedAt: new Date().toISOString(), warnings },
  })
}

// --- Reads ------------------------------------------------------------------

/**
 * Recompute progress for the fetched rows through the pure calculators.
 *
 * READ-ONLY, and that is not a stylistic preference: `progress-service.js`
 * writes `progressCache` on every calculation, so reusing it here would make a
 * GET mutate rows. `progressCache` is advisory (CLAUDE.md), the calculators are
 * the truth, and SDD-045 states the rule this function keeps.
 *
 * One query for every row on the page, grouped in memory — never one per row.
 */
function progressByProject(projectIds, workstreams) {
  // Seeded with every fetched row, so a Project with no Workstream gets a real
  // `rollupProject([])` — percent 0 *and* the calculator's own "no workstreams"
  // warning. A `{ percent: 0 }` literal at the call site would render the same
  // bar while silently dropping the reason, which is how a zero that means
  // "nothing to measure" becomes indistinguishable from one that means "nothing
  // done yet".
  const grouped = new Map(projectIds.map((id) => [id, []]))
  for (const workstream of workstreams) {
    if (!grouped.has(workstream.projectId)) grouped.set(workstream.projectId, [])
    grouped.get(workstream.projectId).push({
      workstreamId: workstream.id,
      progressWeight: Number(workstream.progressWeight),
      ...calculateWorkstreamProgress(workstream.progressStrategy, {
        workstream,
        viewConfig: safeParse(workstream.viewConfigJson, {}),
        items: (workstream.items || []).map((item) => ({
          ...item,
          metrics: safeParse(item.metricDataJson, {}),
          metadata: safeParse(item.metadataJson, {}),
        })),
        containers: workstream.containers || [],
        milestones: workstream.milestones || [],
        gates: (workstream.gates || []).map((gate) => ({ ...gate, evidence: safeParse(gate.evidenceJson, {}) })),
      }),
    })
  }
  const out = {}
  for (const [projectId, rows] of grouped) {
    const rollup = rollupProject(rows)
    out[projectId] = { percent: rollup.percent, totalWeight: rollup.totalWeight, warnings: rollup.warnings }
  }
  return out
}

/**
 * Every source the DTO needs, in a query count that does not grow with the
 * number of Projects.
 *
 * Measured shape — seven Prisma calls, always:
 *   1. `project.findMany`   the capped row window (+ its Space, PIC and the
 *                           non-deleted Workstream ids that give both `streams`
 *                           and the workstream→project map used for `size`)
 *   2. `project.groupBy`    Projects by status over the WHOLE scope, so the band
 *                           stays authoritative when the window is capped
 *   3. `workItem.groupBy`   WorkItems by (workstream, status) — one query that
 *                           buys the whole Work band AND every row's `size`
 *   4. `workItem.groupBy`   distinct `assigneeRef` → the headcount
 *   5. `projectTeam.findMany` distinct `teamId` → the team count
 *   6. `project.findMany`   the prioritized Projects for the Top 5, over the
 *                           whole scope rather than the capped window
 *   7. `workstream.findMany` every Workstream of the fetched rows, with its
 *                           items/containers/milestones/gates, for progress
 *
 * Six of the seven run concurrently; 7 depends on 1 only because it is bounded
 * to the rows actually rendered. Nothing here is inside a loop over Projects.
 *
 * Every query is filtered by the SAME `where` fragment the scope resolver
 * returned — reached through the `workstream.project` / `project` relation where
 * the model is not `Project` itself. FR-086 open question 1: two halves of one
 * page disagreeing is worse than either choice, so there is only one filter to
 * disagree with.
 */
async function readDashboardSources(db, where, { limit }) {
  // `deletedAt: null` on the Workstream, not `activeWorkstream()`: `Streams` and
  // `Size` sit next to each other in the list and must count the same
  // population, and the existing list's `workstreamCount` is non-deleted
  // (`serializeProjectListItem`). Progress deliberately uses the narrower
  // `activeWorkstream()` — that difference is pre-existing and intended
  // (see `active-filters.js`), which is exactly why it is stated here.
  const workItemWhere = { deletedAt: null, workstream: { deletedAt: null, project: where } }

  const [projects, projectStatusRows, itemRows, assigneeRows, teamRows, prioritized] = await Promise.all([
    db.project.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: {
        workspace: { select: { id: true, code: true, name: true, scopeType: true } },
        pic: { select: { id: true, code: true, displayName: true } },
        workstreams: { where: { deletedAt: null }, select: { id: true } },
      },
    }),
    db.project.groupBy({ by: ['status'], where, _count: { _all: true } }),
    db.workItem.groupBy({ by: ['workstreamId', 'status'], where: workItemWhere, _count: { _all: true } }),
    db.workItem.groupBy({ by: ['assigneeRef'], where: workItemWhere }),
    db.projectTeam.findMany({
      where: { project: where, team: { deletedAt: null } },
      distinct: ['teamId'],
      select: { teamId: true },
    }),
    db.project.findMany({
      where: { ...where, priority: { in: PROJECT_PRIORITIES } },
      orderBy: [{ code: 'asc' }],
      take: DASHBOARD_PRIORITY_SCAN_LIMIT,
      select: {
        id: true, code: true, name: true, status: true, priority: true, targetAt: true,
        pic: { select: { id: true, code: true, displayName: true } },
      },
    }),
  ])

  const projectIdByWorkstreamId = new Map()
  for (const project of projects) {
    for (const workstream of project.workstreams || []) projectIdByWorkstreamId.set(workstream.id, project.id)
  }

  const sizeByProjectId = {}
  const workStatusTotals = new Map()
  for (const row of itemRows) {
    const rowCount = Number(row._count?._all) || 0
    workStatusTotals.set(row.status, (workStatusTotals.get(row.status) || 0) + rowCount)
    // A workstream outside the fetched window still counts toward the Work band
    // (it is in scope) and simply has no row to size.
    const projectId = projectIdByWorkstreamId.get(row.workstreamId)
    if (projectId) sizeByProjectId[projectId] = (sizeByProjectId[projectId] || 0) + rowCount
  }

  const workstreams = projects.length
    ? await db.workstream.findMany({
      where: { projectId: { in: projects.map((project) => project.id) }, ...activeWorkstream() },
      include: {
        items: { where: { deletedAt: null } },
        containers: true,
        milestones: true,
        gates: true,
      },
    })
    : []

  return {
    projects,
    projectStatusCounts: projectStatusRows.map((row) => ({ status: row.status, count: Number(row._count?._all) || 0 })),
    workStatusCounts: [...workStatusTotals].map(([status, value]) => ({ status, count: value })),
    // ADR-036 D5 option 1 — people with work assigned. A null/blank assignee is
    // not a person, so it is not counted as one.
    headcount: assigneeRows.filter((row) => typeof row.assigneeRef === 'string' && row.assigneeRef.trim()).length,
    // ADR-037 D4 — a separate figure, never derived from the headcount above.
    teamCount: teamRows.length,
    sizeByProjectId,
    progressByProjectId: progressByProject(projects.map((project) => project.id), workstreams),
    prioritized,
  }
}

/**
 * The one entry point behind `GET /api/projects/overview`.
 *
 * Additive by design: `/api/projects` and its list service are untouched. The
 * cost of changing that contract instead is recorded in
 * `.brain/rca/2026-08-18-project-list-envelope-broke-relation-consumers.md`.
 */
export async function getProjectsDashboard({
  db = prisma,
  viewer,
  workspaceId = null,
  businessId = null,
  limit = DASHBOARD_ROW_LIMIT,
} = {}) {
  const query = parseProjectsDashboardQuery({
    workspaceId: workspaceId ?? undefined,
    businessId: businessId ?? undefined,
    limit,
  })
  const read = async (tx) => {
    const scope = await resolveDashboardScope(viewer, query, { db: tx })
    const source = await readDashboardSources(tx, scope.where, { limit: query.limit })
    return buildProjectsDashboardReadModel({ ...source, scope, limit: query.limit })
  }
  return typeof db.$transaction === 'function' ? db.$transaction(read) : read(db)
}
