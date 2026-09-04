import { describe, expect, it, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import prisma from '@/lib/db'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '../factories/scope'
import { listWork, WORK_LIST_LIMIT } from '@/modules/project-manager/application/work-service'
import { listWorkForViewer } from '@/modules/project-manager/application/work-read-service'
import { archiveWorkstream } from '@/modules/project-manager/application/project-service'
import { computeProjectProgress } from '@/modules/project-manager/application/progress-service'
import { activeWorkstream } from '@/modules/project-manager/application/active-filters'
import { listAudit, listAuditEntityTypes, recordAudit, AUDIT_MAX_LIMIT } from '@/modules/project-manager/application/audit'
import { makeViewer } from '../factories/viewer'

// @req FR-005, FR-007, FR-014 — the global browser lists the population the
// calculators count, and says when it is showing a window.
// @spec BR-004, SDD-002
// @tested tests/integration/work-listing-scope.test.js
//
// Two W4 findings, one shape between them.
//
// 1. `{ deletedAt: null, status: { not: 'ARCHIVED' } }` was written by hand in
//    four places and omitted from `listWork`. So every progress figure excluded
//    archived workstreams while the Work browser listed their items WITH an
//    inline status editor: an edit that could not move any number the app shows.
//    Same defect W3 fixed between the cards and their calculators — one idea,
//    two populations.
// 2. The cap was a bare `take: 500` with no way for a caller to learn it had
//    applied. `AllWorkView` searches client-side over what it received, so past
//    the limit a query answered "no work items match" about work that exists.

let project
let liveStream
let archivedStream
let reader
let outsideReader

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'WLS', code: 'PF-WLS' })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: 'WLS T', code: 'TNT-WLS' })
  const business = await createBusiness({ tenantId: tenant.id, name: 'WLS B', code: 'BUS-WLS' })
  reader = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [] })
  outsideReader = makeViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
  const workspace = await createWorkspace({
    name: 'WLS WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-WLS',
  })
  project = await prisma.project.create({
    data: { code: 'PRJ-WLS', name: 'WLS', workspaceId: workspace.id, businessId: business.id },
  })
  const stream = (code) => prisma.workstream.create({
    data: {
      code, name: code, projectId: project.id,
      executionMode: 'SOFTWARE_SPRINT', progressStrategy: 'TASK_WEIGHT',
    },
  })
  liveStream = await stream('WST-WLS-LIVE')
  archivedStream = await stream('WST-WLS-ARCHIVED')
  await prisma.workItem.create({
    data: { code: 'WI-WLS-LIVE', workstreamId: liveStream.id, subtype: 'TASK', title: 'Live task', status: 'DONE', weight: 1 },
  })
  await prisma.workItem.create({
    data: { code: 'WI-WLS-GHOST', workstreamId: archivedStream.id, subtype: 'TASK', title: 'Ghost task', status: 'PLANNED', weight: 1 },
  })
  const owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
  await archiveWorkstream(archivedStream.id, { viewer: owner })
})

describe('the browser and the calculators share one population', () => {
  it('drops items whose workstream was archived', async () => {
    const { items } = await listWork({ projectId: project.id })
    const codes = items.map((i) => i.code)
    expect(codes).toContain('WI-WLS-LIVE')
    expect(codes).not.toContain('WI-WLS-GHOST')
  })

  it('drops them from the unfiltered global listing too', async () => {
    // The archived items were reachable from the GLOBAL Work browser, where no
    // projectId narrows the query — the surface the finding actually named.
    const { items } = await listWork({})
    expect(items.map((i) => i.code)).not.toContain('WI-WLS-GHOST')
  })

  it('agrees with the progress calculator about what exists', async () => {
    // The ghost item is PLANNED. If progress counted it, a project whose only
    // live item is DONE would not read 100.
    const progress = await computeProjectProgress(project.id)
    const { items } = await listWork({ projectId: project.id })
    expect(items).toHaveLength(1)
    expect(progress.percent).toBe(100)
  })

  it('still lists items of a workstream that is merely not started', async () => {
    const planned = await prisma.workstream.create({
      data: {
        code: 'WST-WLS-PLANNED', name: 'Planned', projectId: project.id,
        executionMode: 'SOFTWARE_SPRINT', progressStrategy: 'TASK_WEIGHT', status: 'PLANNED',
      },
    })
    await prisma.workItem.create({
      data: { code: 'WI-WLS-PLANNED', workstreamId: planned.id, subtype: 'TASK', title: 'Not started', status: 'PLANNED', weight: 1 },
    })
    const { items } = await listWork({ projectId: project.id })
    expect(items.map((i) => i.code)).toContain('WI-WLS-PLANNED')
  })
})

describe('the viewer-aware Work read boundary', () => {
  it('lets a visible member read by Project or Workstream scope', async () => {
    const projectResult = await listWorkForViewer(
      { projectId: project.id, status: 'DONE' },
      { viewer: reader },
    )
    expect(projectResult.items.map((item) => item.code)).toContain('WI-WLS-LIVE')

    const workstreamResult = await listWorkForViewer(
      { workstreamId: liveStream.id },
      { viewer: reader },
    )
    expect(workstreamResult.items.map((item) => item.code)).toContain('WI-WLS-LIVE')
  })

  it('hides a Project from a viewer without Business visibility', async () => {
    await expect(
      listWorkForViewer({ projectId: project.id }, { viewer: outsideReader }),
    ).rejects.toMatchObject({ status: 404, message: 'Project not found' })
  })
})

describe('the predicate has one definition', () => {
  it('excludes archived without using an inclusion list', () => {
    // `not: 'ARCHIVED'` and `in: [...active]` are NOT equivalent: a row holding
    // a value outside the enum passes the first and fails the second, so the
    // "tidier" rewrite silently hides rows. That substitution was made once by
    // automation during this review and reverted; this pins it.
    expect(activeWorkstream()).toEqual({ deletedAt: null, status: { not: 'ARCHIVED' } })
  })

  it('hands out a fresh object each call, so one caller cannot poison another', () => {
    const a = activeWorkstream()
    a.projectId = 'leaked'
    expect(activeWorkstream().projectId).toBeUndefined()
  })
})

describe('the caps are disclosed rather than silent', () => {
  it('reports the limit and that it did not truncate', async () => {
    const result = await listWork({ projectId: project.id })
    expect(result.limit).toBe(WORK_LIST_LIMIT)
    expect(result.truncated).toBe(false)
  })

  it('flags truncation, and never returns more than the limit', async () => {
    // Proven against the real cap rather than a stubbed one: the limit only
    // means something if crossing it is what sets the flag.
    const stream = await prisma.workstream.create({
      data: {
        code: 'WST-WLS-BULK', name: 'Bulk', projectId: project.id,
        executionMode: 'SOFTWARE_SPRINT', progressStrategy: 'TASK_WEIGHT',
      },
    })
    await prisma.workItem.createMany({
      data: Array.from({ length: WORK_LIST_LIMIT + 5 }, (_, i) => ({
        code: `WI-WLS-BULK-${i}`, workstreamId: stream.id, subtype: 'TASK', title: `Bulk ${i}`, status: 'PLANNED', weight: 1,
      })),
    })
    const result = await listWork({ projectId: project.id })
    expect(result.truncated).toBe(true)
    expect(result.items).toHaveLength(WORK_LIST_LIMIT)
  })
})

describe('the flag reaches a surface, not just the service', () => {
  // The three consumers are client components whose rendering is not exercised
  // by these suites. What must not regress is that each one reads the new shape
  // and renders the disclosure — a `truncated` nobody displays is the silent cap
  // with extra steps.
  const source = (p) => readFileSync(p, 'utf8')

  it.each([
    ['src/modules/project-manager/views/universal/AllWorkView.jsx', 'data?.items'],
    ['src/modules/project-manager/views/KanbanBoard.jsx', 'data?.items'],
    ['src/app/(pm)/audit/page.jsx', 'data?.events'],
  ])('%s reads the new shape and renders TruncationNotice', (file, accessor) => {
    const text = source(file)
    expect(text).toContain(accessor)
    expect(text).toContain('TruncationNotice')
    expect(text).toContain('truncated')
  })

  it('no consumer still treats the response as a bare array', () => {
    for (const file of [
      'src/modules/project-manager/views/universal/AllWorkView.jsx',
      'src/modules/project-manager/views/KanbanBoard.jsx',
      'src/app/(pm)/audit/page.jsx',
    ]) {
      expect(source(file)).not.toContain('data || []')
    }
  })
})

describe('the audit stream says when it is a window', () => {
  it('returns events with the limit it applied', async () => {
    const result = await listAudit(prisma, { limit: 5 })
    expect(result.limit).toBe(5)
    expect(result.events.length).toBeLessThanOrEqual(5)
    expect(typeof result.truncated).toBe('boolean')
  })

  it('flags truncation when more events exist than were asked for', async () => {
    // The suite has written plenty of audit rows by now; asking for one proves
    // the flag without depending on how many.
    const result = await listAudit(prisma, { limit: 1 })
    expect(result.events).toHaveLength(1)
    expect(result.truncated).toBe(true)
  })

  it('never honours a limit above the hard cap', async () => {
    const result = await listAudit(prisma, { limit: 10_000 })
    expect(result.limit).toBe(AUDIT_MAX_LIMIT)
  })
})

describe('the audit filter offers what the log actually contains', () => {
  // The page used to keep its own list of entityTypes: 15 of the 57 this
  // codebase writes. On an audit log a missing filter option is not a cosmetic
  // gap — it is indistinguishable from "that never happened".
  it('reports every entityType present, with a real count', async () => {
    await recordAudit(prisma, { entityType: 'AUDIT_FACET_PROBE', entityId: 'probe-1', action: 'PROBED' })
    await recordAudit(prisma, { entityType: 'AUDIT_FACET_PROBE', entityId: 'probe-2', action: 'PROBED' })

    const facets = await listAuditEntityTypes(prisma)
    const probe = facets.find((facet) => facet.value === 'AUDIT_FACET_PROBE')
    expect(probe).toBeDefined()
    expect(probe.count).toBe(2)

    // Whatever else the suite wrote is in there too — the point of deriving it.
    expect(facets.length).toBeGreaterThan(1)
    expect(facets.every((facet) => typeof facet.value === 'string' && facet.value.length > 0)).toBe(true)
    // By codepoint, not locale, and not the database's collation: SQLite and
    // Postgres disagree about where `_` sorts, so `WORK_ITEM` and `WORKSTREAM`
    // would swap places between dev and production if the engine ordered this.
    const byCodepoint = [...facets].sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0))
    expect(byCodepoint).toEqual(facets)
  })

  it('counts the whole log, not the filtered window', async () => {
    // A facet narrowed by its own filter would collapse to the single option
    // already chosen, and an operator could not get back to the others.
    const filtered = await listAudit(prisma, { entityType: 'AUDIT_FACET_PROBE', limit: 1, withEntityTypes: true })
    expect(filtered.events).toHaveLength(1)
    expect(filtered.entityTypes.length).toBeGreaterThan(1)
    expect(filtered.entityTypes.some((facet) => facet.value !== 'AUDIT_FACET_PROBE')).toBe(true)

    // And the counts outlive the window: the cap hid a row, the facet did not.
    const probe = filtered.entityTypes.find((facet) => facet.value === 'AUDIT_FACET_PROBE')
    expect(probe.count).toBeGreaterThan(filtered.events.length)
  })

  it('is opt-in, so an existing caller pays for no extra query', async () => {
    const plain = await listAudit(prisma, { limit: 1 })
    expect(plain).not.toHaveProperty('entityTypes')
  })
})
