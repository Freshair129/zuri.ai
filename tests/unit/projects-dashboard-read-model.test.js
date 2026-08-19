// @req FR-086 — the Projects Dashboard DTO is a contract, and in a repository
// with no TypeScript a contract is enforced by tests or not at all (SDD-008).
// @spec SDD-047, ADR-036, SEC-001
// @tested tests/unit/projects-dashboard-read-model.test.js
import { describe, expect, it } from 'vitest'
import { PROJECT_PRIORITIES, PROJECT_STATUSES, WORK_STATUSES } from '@/lib/validation/enums'
import {
  DASHBOARD_ROW_LIMIT,
  PROJECTS_DASHBOARD_VERSION,
  TOP_PRIORITY_SIZE,
  buildProjectsDashboardReadModel,
  parseProjectsDashboardQuery,
  rankTopPriority,
  resolveDashboardScope,
  zProjectsDashboardResponse,
} from '@/modules/project-manager/application/projects-dashboard-read-model'
import { makeViewer, ownsElsewhere, makeDevViewer } from '../factories/viewer'

const DATE = '2026-09-01T00:00:00.000Z'
const LATER = '2026-12-01T00:00:00.000Z'

function project(over = {}) {
  return {
    id: 'p-1',
    code: 'PRJ-1',
    name: 'Project One',
    status: 'ACTIVE',
    priority: null,
    targetAt: DATE,
    workspaceId: 'ws-1',
    workspace: { id: 'ws-1', code: 'WS-1', name: 'Space One', scopeType: 'BUSINESS' },
    pic: null,
    workstreams: [{ id: 'wst-1' }, { id: 'wst-2' }],
    ...over,
  }
}

function source(over = {}) {
  return {
    scope: { readScope: 'BUSINESS', workspaceId: null, businessId: 'b-1' },
    projectStatusCounts: [{ status: 'ACTIVE', count: 1 }],
    workStatusCounts: [{ status: 'IN_PROGRESS', count: 3 }],
    headcount: 2,
    teamCount: 1,
    projects: [project()],
    sizeByProjectId: { 'p-1': 7 },
    progressByProjectId: { 'p-1': { percent: 42, totalWeight: 3, warnings: [] } },
    prioritized: [],
    limit: DASHBOARD_ROW_LIMIT,
    ...over,
  }
}

describe('FR-086 Projects Dashboard DTO', () => {
  it('composes a response that satisfies its own schema', () => {
    const dto = buildProjectsDashboardReadModel(source())
    expect(() => zProjectsDashboardResponse.parse(dto)).not.toThrow()
    expect(dto.readModel).toBe('PROJECTS_DASHBOARD')
    expect(dto.schemaVersion).toBe(PROJECTS_DASHBOARD_VERSION)
  })

  it('carries every field the list is specified to render', () => {
    const dto = buildProjectsDashboardReadModel(source({
      projects: [project({
        priority: 'HIGH',
        pic: { id: 'per-1', code: 'PER-1', displayName: 'Ada' },
      })],
    }))
    const [row] = dto.rows.items
    // The ten columns of FR-086's list, by the names the surface renders.
    expect(Object.keys(row).sort()).toEqual([
      'code', 'id', 'name', 'pic', 'priority', 'progress', 'size', 'status',
      'streams', 'targetAt', 'workspace', 'workspaceId',
    ])
    expect(row.size).toBe(7)
    expect(row.streams).toBe(2)
    expect(row.workspace.code).toBe('WS-1')
    expect(row.progress).toEqual({ percent: 42, totalWeight: 3, warnings: [] })
    expect(row.pic.displayName).toBe('Ada')
    expect(row.priority).toBe('HIGH')
    expect(row.targetAt).toBe(DATE)
  })

  it('renders an unset PIC and priority as null rather than a guessed value', () => {
    const dto = buildProjectsDashboardReadModel(source())
    expect(dto.rows.items[0].pic).toBeNull()
    expect(dto.rows.items[0].priority).toBeNull()
  })

  it('refuses to carry a priority the enum does not define', () => {
    const dto = buildProjectsDashboardReadModel(source({
      projects: [project({ priority: 'URGENT-ISH' })],
      prioritized: [project({ priority: 'URGENT-ISH' })],
    }))
    expect(dto.rows.items[0].priority).toBeNull()
    expect(dto.topPriority.items).toEqual([])
    expect(dto.topPriority.reasonCode).toBe('NO_PRIORITY_SET')
  })
})

describe('FR-086 the band sums (ADR-036 Consequences)', () => {
  it('returns every PROJECT_STATUSES key, not the three that were asked for', () => {
    const dto = buildProjectsDashboardReadModel(source({
      projectStatusCounts: [
        { status: 'ACTIVE', count: 7 },
        { status: 'DONE', count: 3 },
        { status: 'ON_HOLD', count: 1 },
        { status: 'ARCHIVED', count: 1 },
      ],
      projects: [],
      sizeByProjectId: {},
      progressByProjectId: {},
    }))
    expect(Object.keys(dto.counts.projects.byStatus).sort()).toEqual([...PROJECT_STATUSES].sort())
    const summed = Object.values(dto.counts.projects.byStatus).reduce((a, b) => a + b, 0)
    expect(summed).toBe(dto.counts.projects.total)
    expect(dto.counts.projects.total).toBe(12)
    // PLANNED is absent from the input and still present, at zero: the surface
    // folds "other" out of complete data, it does not guess at a missing key.
    expect(dto.counts.projects.byStatus.PLANNED).toBe(0)
  })

  it('returns every WORK_STATUSES key and sums to the work total', () => {
    const dto = buildProjectsDashboardReadModel(source({
      workStatusCounts: WORK_STATUSES.map((status, index) => ({ status, count: index + 1 })),
    }))
    expect(Object.keys(dto.counts.work.byStatus).sort()).toEqual([...WORK_STATUSES].sort())
    const summed = Object.values(dto.counts.work.byStatus).reduce((a, b) => a + b, 0)
    expect(summed).toBe(dto.counts.work.total)
    expect(dto.counts.work.total).toBe(WORK_STATUSES.reduce((a, _s, i) => a + i + 1, 0))
  })

  it('keeps the row total equal to the Projects band total', () => {
    const dto = buildProjectsDashboardReadModel(source({
      projectStatusCounts: [{ status: 'ACTIVE', count: 1 }],
    }))
    expect(dto.rows.total).toBe(dto.counts.projects.total)
    expect(dto.rows.truncated).toBe(false)
  })

  it('warns rather than silently dropping a status the enum does not know', () => {
    const dto = buildProjectsDashboardReadModel(source({
      projectStatusCounts: [{ status: 'ACTIVE', count: 2 }, { status: 'MOTHBALLED', count: 5 }],
      projects: [],
      sizeByProjectId: {},
      progressByProjectId: {},
    }))
    expect(dto.counts.projects.total).toBe(7)
    expect(dto.meta.warnings.join(' ')).toMatch(/MOTHBALLED/)
  })

  it('says so when the list is capped below the band', () => {
    const dto = buildProjectsDashboardReadModel(source({
      projectStatusCounts: [{ status: 'ACTIVE', count: 40 }],
      limit: 1,
    }))
    expect(dto.rows.items).toHaveLength(1)
    expect(dto.rows.total).toBe(40)
    expect(dto.rows.truncated).toBe(true)
    expect(dto.meta.warnings.join(' ')).toMatch(/Showing 1 of 40/)
  })

  it('counts people and teams as two independent figures', () => {
    const dto = buildProjectsDashboardReadModel(source({ headcount: 9, teamCount: 4 }))
    expect(dto.counts.people.withWorkAssigned).toBe(9)
    expect(dto.counts.teams.onProjects).toBe(4)
  })
})

describe('FR-086 Top 5 by priority (ADR-036 D3)', () => {
  it('orders by the PROJECT_PRIORITIES index, not alphabetically', () => {
    const items = rankTopPriority(PROJECT_PRIORITIES.map((priority, index) => project({
      id: `p-${priority}`, code: `PRJ-${index}`, priority, targetAt: DATE,
    })))
    expect(items.map((entry) => entry.priority)).toEqual(PROJECT_PRIORITIES.slice(0, TOP_PRIORITY_SIZE))
    expect(items.map((entry) => entry.rank)).toEqual(items.map((_e, i) => i))
  })

  it('breaks a tie on targetAt, with no target last', () => {
    const items = rankTopPriority([
      project({ id: 'p-none', code: 'PRJ-C', priority: 'HIGH', targetAt: null }),
      project({ id: 'p-late', code: 'PRJ-B', priority: 'HIGH', targetAt: LATER }),
      project({ id: 'p-soon', code: 'PRJ-A', priority: 'HIGH', targetAt: DATE }),
    ])
    expect(items.map((entry) => entry.id)).toEqual(['p-soon', 'p-late', 'p-none'])
  })

  it('never ranks in a Project with no priority', () => {
    const items = rankTopPriority([
      project({ id: 'p-soon', code: 'PRJ-A', priority: null, targetAt: DATE }),
      project({ id: 'p-low', code: 'PRJ-B', priority: 'LOW', targetAt: LATER }),
    ])
    expect(items.map((entry) => entry.id)).toEqual(['p-low'])
  })

  it('takes at most five', () => {
    const items = rankTopPriority(Array.from({ length: 12 }, (_v, i) => project({
      id: `p-${i}`, code: `PRJ-${String(i).padStart(2, '0')}`, priority: 'MEDIUM', targetAt: DATE,
    })))
    expect(items).toHaveLength(TOP_PRIORITY_SIZE)
  })

  it('is an honest empty state when nothing carries a priority, never a deadline list', () => {
    const dto = buildProjectsDashboardReadModel(source({
      projectStatusCounts: [{ status: 'ACTIVE', count: 3 }],
      prioritized: [],
    }))
    expect(dto.topPriority.state).toBe('EMPTY')
    expect(dto.topPriority.reasonCode).toBe('NO_PRIORITY_SET')
    expect(dto.topPriority.items).toEqual([])
    expect(dto.topPriority.prioritizedTotal).toBe(0)
  })

  it('distinguishes "no Projects at all" from "no priority set"', () => {
    const dto = buildProjectsDashboardReadModel(source({
      projectStatusCounts: [],
      projects: [],
      sizeByProjectId: {},
      progressByProjectId: {},
      prioritized: [],
    }))
    expect(dto.topPriority.reasonCode).toBe('NO_PROJECTS_IN_SCOPE')
  })
})

describe('FR-086 query contract', () => {
  it('defaults to the whole visible scope with the row cap', () => {
    expect(parseProjectsDashboardQuery({})).toEqual({
      workspaceId: null, businessId: null, limit: DASHBOARD_ROW_LIMIT,
    })
  })

  it('clamps limit to the row cap and rejects an unknown parameter', () => {
    expect(parseProjectsDashboardQuery({ limit: '9999' }).limit).toBe(DASHBOARD_ROW_LIMIT)
    expect(() => parseProjectsDashboardQuery({ q: 'anything' })).toThrow()
    // No `status` filter: the band and the rows must use the identical filter,
    // and a status filter is one only half of the page would sensibly apply.
    expect(() => parseProjectsDashboardQuery({ status: 'ACTIVE' })).toThrow()
  })
})

describe('FR-086 scope authorization (SEC-001)', () => {
  const noDb = { workspace: { findUnique: async () => null }, business: { count: async () => 0 } }

  it('fails closed with no viewer at all', async () => {
    await expect(resolveDashboardScope(undefined, {}, { db: noDb })).rejects.toThrow(/viewer is required/)
    await expect(resolveDashboardScope(null, {}, { db: noDb })).rejects.toThrow(/viewer is required/)
  })

  it('scopes an unselected read to the Businesses the viewer can see, and never to an ownerless row', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-1', 'b-2'], ownedBusinessIds: ['b-1'] })
    const scope = await resolveDashboardScope(viewer, {}, { db: noDb })
    expect(scope.readScope).toBe('VISIBLE_BUSINESSES')
    expect(scope.where).toEqual({ deletedAt: null, businessId: { in: ['b-1', 'b-2'] } })
    // The RCA shape: a bare `{ businessId: null }` branch would cross Tenant
    // isolation silently, so the fragment must never contain one.
    expect(JSON.stringify(scope.where)).not.toMatch(/"businessId":null/)
  })

  it('refuses a Business the viewer cannot see, rather than filtering it away', async () => {
    const viewer = ownsElsewhere({ owns: 'b-owned', sees: 'b-target' })
    await expect(resolveDashboardScope(viewer, { businessId: 'b-elsewhere' }, { db: noDb }))
      .rejects.toMatchObject({ status: 404, message: 'Business not found' })
    // Visible-but-unowned is still readable: this is a read model, and FR-086
    // open question 2 leaves the *editing* authority to FR-087/FR-088.
    const scope = await resolveDashboardScope(viewer, { businessId: 'b-target' }, { db: noDb })
    expect(scope.where).toEqual({ deletedAt: null, businessId: 'b-target' })
  })

  it('lets a picked Space win over a Business, exactly as /projects does', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })
    const db = {
      ...noDb,
      workspace: { findUnique: async () => ({ id: 'ws-1', scopeType: 'BUSINESS', businessId: 'b-1' }) },
    }
    const scope = await resolveDashboardScope(viewer, { workspaceId: 'ws-1', businessId: 'b-other' }, { db })
    expect(scope.where).toEqual({ deletedAt: null, workspaceId: 'ws-1', businessId: 'b-1' })
    expect(scope.businessId).toBe('b-1')
  })

  it('refuses a Space whose Business the viewer cannot see, indistinguishably from a missing one', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })
    const db = {
      ...noDb,
      workspace: { findUnique: async () => ({ id: 'ws-x', scopeType: 'BUSINESS', businessId: 'b-elsewhere' }) },
    }
    await expect(resolveDashboardScope(viewer, { workspaceId: 'ws-x' }, { db }))
      .rejects.toMatchObject({ status: 404, message: 'Workspace not found' })
    await expect(resolveDashboardScope(viewer, { workspaceId: 'ws-missing' }, { db: noDb }))
      .rejects.toMatchObject({ status: 404, message: 'Workspace not found' })
  })

  it('reads a shared Space only through an explicitly named wider scope', async () => {
    const shared = { id: 'ws-t', scopeType: 'TENANT', businessId: null, tenantId: 't-1', portfolioId: null }
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })
    const unrelated = {
      workspace: { findUnique: async () => shared },
      business: { count: async () => 0 },
    }
    await expect(resolveDashboardScope(viewer, { workspaceId: 'ws-t' }, { db: unrelated }))
      .rejects.toMatchObject({ status: 404 })

    const related = { workspace: { findUnique: async () => shared }, business: { count: async () => 1 } }
    const scope = await resolveDashboardScope(viewer, { workspaceId: 'ws-t' }, { db: related })
    expect(scope.readScope).toBe('TENANT_SHARED')
    expect(scope.where).toEqual({ deletedAt: null, workspaceId: 'ws-t', businessId: null })

    const platform = await resolveDashboardScope(makeDevViewer(), { workspaceId: 'ws-t' }, { db: unrelated })
    expect(platform.readScope).toBe('PLATFORM')
  })

  it('refuses a Space whose scope type it does not recognise', async () => {
    const viewer = makeViewer({ visibleBusinessIds: ['b-1'], ownedBusinessIds: ['b-1'] })
    const db = {
      ...noDb,
      workspace: { findUnique: async () => ({ id: 'ws-?', scopeType: 'GALAXY', businessId: 'b-1' }) },
    }
    await expect(resolveDashboardScope(viewer, { workspaceId: 'ws-?' }, { db }))
      .rejects.toMatchObject({ status: 404 })
  })
})
