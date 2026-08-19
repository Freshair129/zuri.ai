// @req FR-086 — the Projects Dashboard composes one authorized read model over
// real data: the band sums, the scope refuses rather than filters, progress is
// read-only, and the query count does not grow with the number of Projects.
// @spec SDD-047, ADR-036, SEC-001, SDD-045
// @tested tests/integration/projects-dashboard.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { PROJECT_PRIORITIES, PROJECT_STATUSES, WORK_STATUSES } from '@/lib/validation/enums'
import { makeViewer, ownsElsewhere } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { createItem } from '@/modules/project-manager/application/work-service'
import { getProjectsDashboard } from '@/modules/project-manager/application/projects-dashboard-read-model'

/**
 * A `db` that records every Prisma model call and exposes no `$transaction`, so
 * the read runs directly against it and every query it issues is countable.
 * SDD-047 exists to remove an N+1; a design whose cost is unmeasured is a design
 * whose regression is undetectable.
 */
function countingDb() {
  const calls = []
  const models = new Map()
  const db = new Proxy({}, {
    get(_target, key) {
      if (typeof key !== 'string' || key.startsWith('$')) return undefined
      if (!models.has(key)) {
        models.set(key, new Proxy({}, {
          get: (_t, method) => (...args) => {
            calls.push(`${key}.${String(method)}`)
            return prisma[key][String(method)](...args)
          },
        }))
      }
      return models.get(key)
    },
  })
  return { db, calls }
}

let businessA
let businessB
let workspaceA
let workspaceA2
let viewerA
let viewerB
let projects = {}
let workstreamIds = []
let teamIds = []

describe('FR-086 Projects Dashboard', () => {
  beforeAll(async () => {
    const suffix = String(Date.now())
    const portfolio = await createPortfolio({ name: `Dash Group ${suffix}`, code: `PF-DASH-${suffix}` })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: `Dash Tenant ${suffix}`, code: `TNT-DASH-${suffix}` })
    businessA = await createBusiness({ tenantId: tenant.id, name: `Dash Business A ${suffix}`, code: `BUS-DASH-A-${suffix}` })
    businessB = await createBusiness({ tenantId: tenant.id, name: `Dash Business B ${suffix}`, code: `BUS-DASH-B-${suffix}` })
    workspaceA = await createWorkspace({ name: `Dash Space A ${suffix}`, scopeType: 'BUSINESS', businessId: businessA.id, code: `WS-DASH-A-${suffix}` })
    workspaceA2 = await createWorkspace({ name: `Dash Space A2 ${suffix}`, scopeType: 'BUSINESS', businessId: businessA.id, code: `WS-DASH-A2-${suffix}` })
    const workspaceB = await createWorkspace({ name: `Dash Space B ${suffix}`, scopeType: 'BUSINESS', businessId: businessB.id, code: `WS-DASH-B-${suffix}` })

    viewerA = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id] })
    viewerB = makeViewer({ visibleBusinessIds: [businessB.id], ownedBusinessIds: [businessB.id] })

    // Three Projects in Business A, one in Business B. Statuses chosen so the
    // band cannot be right by accident: two of the five values are used, and
    // ON_HOLD is one of the two the original ask never named.
    projects.alpha = await createProject({ workspaceId: workspaceA.id, name: 'Dash Alpha', code: `PRJ-DASH-A1-${suffix}`, status: 'ACTIVE' }, { viewer: viewerA })
    projects.beta = await createProject({ workspaceId: workspaceA.id, name: 'Dash Beta', code: `PRJ-DASH-A2-${suffix}`, status: 'ON_HOLD' }, { viewer: viewerA })
    projects.gamma = await createProject({ workspaceId: workspaceA2.id, name: 'Dash Gamma', code: `PRJ-DASH-A3-${suffix}`, status: 'ACTIVE' }, { viewer: viewerA })
    projects.outside = await createProject({ workspaceId: workspaceB.id, name: 'Dash Outside', code: `PRJ-DASH-B1-${suffix}`, status: 'ACTIVE' }, { viewer: viewerB })

    const alphaOne = await createWorkstream({ projectId: projects.alpha.id, name: 'Alpha Delivery', code: `WST-DASH-A1-${suffix}`, executionMode: 'SOFTWARE_SPRINT' }, { viewer: viewerA })
    const alphaTwo = await createWorkstream({ projectId: projects.alpha.id, name: 'Alpha Ops', code: `WST-DASH-A2-${suffix}`, executionMode: 'OPERATIONS' }, { viewer: viewerA })
    const betaOne = await createWorkstream({ projectId: projects.beta.id, name: 'Beta Delivery', code: `WST-DASH-B1-${suffix}`, executionMode: 'SOFTWARE_SPRINT' }, { viewer: viewerA })
    const outsideOne = await createWorkstream({ projectId: projects.outside.id, name: 'Outside Delivery', code: `WST-DASH-O1-${suffix}`, executionMode: 'SOFTWARE_SPRINT' }, { viewer: viewerA === viewerB ? viewerA : viewerB })
    workstreamIds = [alphaOne.id, alphaTwo.id, betaOne.id]

    const item = (workstreamId, key, status, assigneeRef, viewer) => createItem({
      workstreamId, subtype: 'TASK', title: `Dash ${key}`, code: `WI-DASH-${key}-${suffix}`, status, assigneeRef,
    }, { viewer })

    // Alpha: 4 live items (2 DONE, 1 IN_PROGRESS, 1 PLANNED) + 1 soft-deleted.
    await item(alphaOne.id, 'A1', 'DONE', 'person-1', viewerA)
    await item(alphaOne.id, 'A2', 'DONE', 'person-2', viewerA)
    await item(alphaOne.id, 'A3', 'IN_PROGRESS', 'person-1', viewerA)
    await item(alphaTwo.id, 'A4', 'PLANNED', null, viewerA)
    const removed = await item(alphaTwo.id, 'A5', 'PLANNED', 'person-9', viewerA)
    await prisma.workItem.update({ where: { id: removed.id }, data: { deletedAt: new Date() } })
    // Beta: 2 live items, one assignee already seen on Alpha.
    await item(betaOne.id, 'B1', 'BLOCKED', 'person-3', viewerA)
    await item(betaOne.id, 'B2', 'REVIEW', 'person-1', viewerA)
    // Business B's Project carries an assignee nobody in A should ever see.
    await item(outsideOne.id, 'O1', 'DONE', 'person-outside', viewerB)

    // Teams: two Teams in Business A, attached so that the team count and the
    // headcount are provably different figures (ADR-036 D5 / ADR-037 D4).
    const teamOne = await prisma.team.create({ data: { code: `TEAM-DASH-1-${suffix}`, businessId: businessA.id, name: 'Platform' } })
    const teamTwo = await prisma.team.create({ data: { code: `TEAM-DASH-2-${suffix}`, businessId: businessA.id, name: 'Design' } })
    const retired = await prisma.team.create({ data: { code: `TEAM-DASH-3-${suffix}`, businessId: businessA.id, name: 'Retired', deletedAt: new Date() } })
    teamIds = [teamOne.id, teamTwo.id]
    await prisma.projectTeam.createMany({ data: [
      { projectId: projects.alpha.id, teamId: teamOne.id },
      { projectId: projects.alpha.id, teamId: teamTwo.id },
      // The same Team on a second Project must not be counted twice.
      { projectId: projects.beta.id, teamId: teamOne.id },
      { projectId: projects.beta.id, teamId: retired.id },
    ] })
  })

  it('answers the band and the list from one identical scope filter', async () => {
    const dto = await getProjectsDashboard({ viewer: viewerA, businessId: businessA.id })

    expect(dto.readModel).toBe('PROJECTS_DASHBOARD')
    expect(dto.scope).toEqual({ readScope: 'BUSINESS', workspaceId: null, businessId: businessA.id })
    expect(dto.counts.projects.total).toBe(3)
    expect(dto.counts.projects.byStatus.ACTIVE).toBe(2)
    expect(dto.counts.projects.byStatus.ON_HOLD).toBe(1)
    expect(Object.keys(dto.counts.projects.byStatus).sort()).toEqual([...PROJECT_STATUSES].sort())

    const projectSum = Object.values(dto.counts.projects.byStatus).reduce((a, b) => a + b, 0)
    expect(projectSum).toBe(dto.counts.projects.total)
    expect(dto.rows.items).toHaveLength(dto.counts.projects.total)
    expect(dto.rows.truncated).toBe(false)

    // Six live WorkItems across Business A; the soft-deleted one is gone and
    // Business B's is not in scope.
    expect(dto.counts.work.total).toBe(6)
    expect(Object.keys(dto.counts.work.byStatus).sort()).toEqual([...WORK_STATUSES].sort())
    const workSum = Object.values(dto.counts.work.byStatus).reduce((a, b) => a + b, 0)
    expect(workSum).toBe(dto.counts.work.total)
    expect(dto.counts.work.byStatus.DONE).toBe(2)
    expect(dto.counts.work.byStatus.CANCELLED).toBe(0)
    expect(dto.meta.warnings).toEqual([])
  })

  it('counts people and teams as two different figures', async () => {
    const dto = await getProjectsDashboard({ viewer: viewerA, businessId: businessA.id })
    // person-1, person-2, person-3 — the unassigned item is nobody and the
    // soft-deleted item's assignee (person-9) is not working here.
    expect(dto.counts.people.withWorkAssigned).toBe(3)
    // Two live Teams across two Projects, the duplicate link counted once and
    // the retired Team not counted at all.
    expect(dto.counts.teams.onProjects).toBe(teamIds.length)
    expect(dto.counts.teams.onProjects).not.toBe(dto.counts.people.withWorkAssigned)
  })

  it('sizes a row by its non-deleted WorkItems, and streams by its non-deleted Workstreams', async () => {
    const dto = await getProjectsDashboard({ viewer: viewerA, businessId: businessA.id })
    const byId = Object.fromEntries(dto.rows.items.map((row) => [row.id, row]))

    expect(byId[projects.alpha.id].size).toBe(4)
    expect(byId[projects.alpha.id].streams).toBe(2)
    expect(byId[projects.beta.id].size).toBe(2)
    expect(byId[projects.beta.id].streams).toBe(1)
    expect(byId[projects.gamma.id].size).toBe(0)
    expect(byId[projects.gamma.id].streams).toBe(0)
    // Size sums to the Work band, so the list reconciles with the band above it.
    const sizes = dto.rows.items.reduce((total, row) => total + row.size, 0)
    expect(sizes).toBe(dto.counts.work.total)
  })

  it('carries progress from the pure calculators without writing progressCache', async () => {
    const before = await prisma.workstream.findMany({
      where: { id: { in: workstreamIds } },
      select: { id: true, progressCache: true, updatedAt: true },
      orderBy: { id: 'asc' },
    })

    const dto = await getProjectsDashboard({ viewer: viewerA, businessId: businessA.id })
    const alpha = dto.rows.items.find((row) => row.id === projects.alpha.id)
    // Two of Alpha's four live items are DONE.
    expect(alpha.progress.percent).toBeGreaterThan(0)
    expect(alpha.progress.totalWeight).toBeGreaterThan(0)
    const gamma = dto.rows.items.find((row) => row.id === projects.gamma.id)
    expect(gamma.progress.percent).toBe(0)
    expect(gamma.progress.warnings.join(' ')).toMatch(/no workstreams/i)

    const after = await prisma.workstream.findMany({
      where: { id: { in: workstreamIds } },
      select: { id: true, progressCache: true, updatedAt: true },
      orderBy: { id: 'asc' },
    })
    expect(after).toEqual(before)
  })

  it('refuses an out-of-scope Business rather than returning an empty page', async () => {
    await expect(getProjectsDashboard({ viewer: viewerB, businessId: businessA.id }))
      .rejects.toMatchObject({ status: 404, message: 'Business not found' })
    await expect(getProjectsDashboard({ viewer: viewerB, workspaceId: workspaceA.id }))
      .rejects.toMatchObject({ status: 404, message: 'Workspace not found' })
  })

  it('never leaks an out-of-scope Project into any figure on the page', async () => {
    const dto = await getProjectsDashboard({ viewer: viewerB, businessId: businessB.id })
    expect(dto.rows.items.map((row) => row.id)).toEqual([projects.outside.id])
    expect(dto.counts.projects.total).toBe(1)
    expect(dto.counts.work.total).toBe(1)
    expect(dto.counts.people.withWorkAssigned).toBe(1)
    expect(dto.counts.teams.onProjects).toBe(0)
    expect(JSON.stringify(dto)).not.toContain(projects.alpha.id)
    expect(JSON.stringify(dto)).not.toContain('person-1')
  })

  it('fails closed when no viewer was resolved at all', async () => {
    await expect(getProjectsDashboard({ businessId: businessA.id })).rejects.toThrow(/viewer is required/)
  })

  it('narrows to a picked Space, and the band narrows with it', async () => {
    const dto = await getProjectsDashboard({ viewer: viewerA, workspaceId: workspaceA2.id })
    expect(dto.scope.readScope).toBe('BUSINESS')
    expect(dto.counts.projects.total).toBe(1)
    expect(dto.rows.items.map((row) => row.id)).toEqual([projects.gamma.id])
    // The band followed the same filter: Gamma holds no work.
    expect(dto.counts.work.total).toBe(0)
    expect(dto.counts.teams.onProjects).toBe(0)
  })

  it('issues a constant number of queries regardless of how many Projects are in scope', async () => {
    const wide = countingDb()
    await getProjectsDashboard({ db: wide.db, viewer: viewerA, businessId: businessA.id })
    const narrow = countingDb()
    await getProjectsDashboard({ db: narrow.db, viewer: viewerB, businessId: businessB.id })

    // Measured 2026-08-19: seven Prisma calls for three Projects and seven for
    // one. No `findMany`/`count` inside a per-Project loop, which is the whole
    // point of SDD-047 — a progress call per row is the N+1 it replaces.
    expect(wide.calls).toHaveLength(7)
    expect(narrow.calls).toHaveLength(7)
    expect(wide.calls.filter((call) => call.startsWith('project.')).length).toBe(3)
    expect(wide.calls).toContain('workstream.findMany')

    // A picked Space costs exactly one more — the Workspace lookup that
    // authorizes the scope before anything is composed. One, not one per row.
    const spaced = countingDb()
    await getProjectsDashboard({ db: spaced.db, viewer: viewerA, workspaceId: workspaceA.id })
    expect(spaced.calls).toHaveLength(8)
    expect(spaced.calls[0]).toBe('workspace.findUnique')
  })

  it('renders an honest empty Top 5 until a priority is set, then ranks by the enum order', async () => {
    const before = await getProjectsDashboard({ viewer: viewerA, businessId: businessA.id })
    expect(before.topPriority).toMatchObject({ state: 'EMPTY', reasonCode: 'NO_PRIORITY_SET', items: [] })
    // The empty state is not a deadline list wearing a Priority heading.
    expect(before.topPriority.prioritizedTotal).toBe(0)

    const person = await prisma.person.create({
      data: { code: `PER-DASH-${Date.now()}`, displayName: 'Dash PIC' },
    })
    await prisma.project.update({ where: { id: projects.beta.id }, data: { priority: 'LOW' } })
    await prisma.project.update({ where: { id: projects.gamma.id }, data: { priority: 'MEDIUM' } })
    await prisma.project.update({
      where: { id: projects.alpha.id },
      data: { priority: 'CRITICAL', picPersonId: person.id },
    })

    const after = await getProjectsDashboard({ viewer: viewerA, businessId: businessA.id })
    expect(after.topPriority.state).toBe('READY')
    expect(after.topPriority.reasonCode).toBeNull()
    expect(after.topPriority.items.map((entry) => entry.priority)).toEqual(['CRITICAL', 'MEDIUM', 'LOW'])
    expect(after.topPriority.items.map((entry) => entry.rank))
      .toEqual(['CRITICAL', 'MEDIUM', 'LOW'].map((value) => PROJECT_PRIORITIES.indexOf(value)))
    expect(after.topPriority.items[0].id).toBe(projects.alpha.id)
    expect(after.topPriority.items[0].pic).toEqual({ id: person.id, code: person.code, displayName: 'Dash PIC' })
    expect(after.topPriority.prioritizedTotal).toBe(3)

    const alphaRow = after.rows.items.find((row) => row.id === projects.alpha.id)
    expect(alphaRow.priority).toBe('CRITICAL')
    expect(alphaRow.pic.displayName).toBe('Dash PIC')
  })
})
