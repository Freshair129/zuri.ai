import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createWorkspace,
} from '../factories/scope'
import {
  createProject,
  updateProject,
  archiveProject,
  createWorkstream,
  updateWorkstream,
} from '@/modules/project-manager/application/project-service'
import { createContainer, createItem, updateItem } from '@/modules/project-manager/application/work-service'
import { createMilestone, createGate, updateGate } from '@/modules/project-manager/application/milestone-gate-service'
import { createDependency, wouldCreateCycle, evaluateBlocked } from '@/modules/project-manager/application/dependency-service'
import { createRepository, linkRepository } from '@/modules/project-manager/application/repository-service'
import { computeProjectProgress, computeWorkstreamProgress } from '@/modules/project-manager/application/progress-service'

// @req FR-072 — the services exercised here authorize their writes against a
// resolved viewer. `viewer` below is an owner of this file's fixture Business and
// is threaded through every guarded call, so these cases keep asserting what an
// authorized caller gets. The refusal side lives in the per-wave
// `fr072-*-authorization.test.js` files, not here.
//
// Deliberately NOT threaded: `createPortfolio`, `createTenant`, `createBusiness`,
// `createWorkspace` and `createRepository`. Those writes have no declared
// authority yet (`.brain/waves/route-viewer-plan.md` §BLOCKED B1/B3) and stay
// unguarded; passing them a viewer would imply a contract nobody has declared.

let workspace, project, wsDev, wsMig, viewer, businessId

describe('project core', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Core Group', code: 'PF-CORE' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Core Tenant', code: 'TNT-CORE' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'Core Business', code: 'BUS-CORE' })
    businessId = business.id
    workspace = await createWorkspace({ name: 'Core WS', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-CORE' })
    viewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    project = await createProject({ workspaceId: workspace.id, name: 'Core Project', code: 'PRJ-CORE' }, { viewer })
  })

  it('project CRUD with audit + version increments', async () => {
    const updated = await updateProject(project.id, { status: 'ACTIVE', description: 'desc' }, { viewer })
    expect(updated.status).toBe('ACTIVE')
    expect(updated.version).toBe(2)
    const audits = await prisma.auditEvent.findMany({ where: { entityType: 'PROJECT', entityId: project.id } })
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(['CREATED', 'UPDATED']))
  })

  it('project supports mixed workstream execution modes', async () => {
    wsDev = await createWorkstream({
      projectId: project.id,
      name: 'Dev stream',
      executionMode: 'SOFTWARE_SPRINT',
      code: 'WST-CORE-DEV',
    }, { viewer })
    wsMig = await createWorkstream({
      projectId: project.id,
      name: 'Migration stream',
      executionMode: 'DATA_MIGRATION',
      code: 'WST-CORE-MIG',
    }, { viewer })
    expect(wsDev.progressStrategy).toBe('TASK_WEIGHT') // default per mode
    expect(wsMig.progressStrategy).toBe('RECORD_VALIDATION')
    const modes = await prisma.workstream.findMany({ where: { projectId: project.id } })
    expect(new Set(modes.map((m) => m.executionMode)).size).toBe(2)
  })

  it('rejects unknown execution mode', async () => {
    await expect(
      createWorkstream({ projectId: project.id, name: 'Bad', executionMode: 'SCRUMBAN' }, { viewer })
    ).rejects.toThrow()
  })

  it('containers and items enforce same-workstream integrity', async () => {
    const sprint = await createContainer({
      workstreamId: wsDev.id,
      subtype: 'SPRINT',
      title: 'Sprint 1',
      code: 'WC-CORE-S1',
    }, { viewer })
    const item = await createItem({
      workstreamId: wsDev.id,
      containerId: sprint.id,
      subtype: 'TASK',
      title: 'Task 1',
      code: 'WI-CORE-T1',
      weight: 3,
    }, { viewer })
    expect(item.containerId).toBe(sprint.id)
    await expect(
      createItem({ workstreamId: wsMig.id, containerId: sprint.id, subtype: 'DATASET', title: 'Bad' }, { viewer })
    ).rejects.toThrow(/same workstream/i)
  })

  it('milestones and gates persist and validate project linkage', async () => {
    const ms = await createMilestone({ projectId: project.id, workstreamId: wsDev.id, title: 'M1', code: 'MS-CORE-1' }, { viewer })
    const gate = await createGate({ projectId: project.id, workstreamId: wsMig.id, title: 'G1', code: 'GATE-CORE-1' }, { viewer })
    expect(ms.projectId).toBe(project.id)
    expect(gate.status).toBe('OPEN')
  })

  it('repository links are many-to-many', async () => {
    // @req FR-073 — a Repository now carries its owning Business, so these are
    // threaded like every other guarded create. Before FR-073 they were not,
    // because nothing could govern them.
    const repoA = await createRepository({ businessId, provider: 'github', fullName: 'org/repo-a', code: 'REP-CORE-A' }, { viewer })
    const repoB = await createRepository({ businessId, provider: 'gitlab', fullName: 'org/repo-b', code: 'REP-CORE-B' }, { viewer })
    await linkRepository({ projectId: project.id, repoId: repoA.id, role: 'PRIMARY' }, { viewer })
    await linkRepository({ projectId: project.id, repoId: repoB.id, role: 'REFERENCE' }, { viewer })
    // Same repo can link to another project too.
    const p2 = await createProject({ workspaceId: workspace.id, name: 'Second', code: 'PRJ-CORE-2' }, { viewer })
    await linkRepository({ projectId: p2.id, repoId: repoA.id, role: 'PRIMARY' }, { viewer })
    const links = await prisma.projectRepository.findMany({ where: { repoId: repoA.id } })
    expect(links.length).toBe(2)
  })

  it('dependencies: no self-dependency, no cycles, blocked evaluation', async () => {
    await expect(
      createDependency({
        sourceType: 'WORKSTREAM',
        sourceId: wsDev.id,
        targetType: 'WORKSTREAM',
        targetId: wsDev.id,
        dependencyType: 'BLOCKS',
      }, { viewer })
    ).rejects.toThrow(/self-dependency/i)

    await createDependency({
      sourceType: 'WORKSTREAM',
      sourceId: wsMig.id,
      targetType: 'WORKSTREAM',
      targetId: wsDev.id,
      dependencyType: 'BLOCKS',
    }, { viewer })
    // Reverse edge would create a cycle.
    expect(await wouldCreateCycle('WORKSTREAM', wsDev.id, 'WORKSTREAM', wsMig.id)).toBe(true)
    await expect(
      createDependency({
        sourceType: 'WORKSTREAM',
        sourceId: wsDev.id,
        targetType: 'WORKSTREAM',
        targetId: wsMig.id,
        dependencyType: 'REQUIRES',
      }, { viewer })
    ).rejects.toThrow(/cycle/i)

    // wsDev is blocked because wsMig (ACTIVE, not DONE) blocks it.
    const evalResult = await evaluateBlocked('WORKSTREAM', wsDev.id)
    expect(evalResult.blocked).toBe(true)
    expect(evalResult.blockers[0].id).toBe(wsMig.id)
  })

  it('progress engine computes deterministic per-stream + rollup', async () => {
    await createItem({
      workstreamId: wsMig.id,
      subtype: 'DATASET',
      title: 'DS',
      code: 'WI-CORE-DS',
      metrics: { recordsTotal: 100, validated: 40 },
    }, { viewer })
    const dev = await computeWorkstreamProgress(wsDev.id)
    expect(dev.percent).toBe(0) // task not done
    await updateItem((await prisma.workItem.findUnique({ where: { code: 'WI-CORE-T1' } })).id, { status: 'DONE' }, { viewer })
    const dev2 = await computeWorkstreamProgress(wsDev.id)
    expect(dev2.percent).toBe(100)
    const mig = await computeWorkstreamProgress(wsMig.id)
    expect(mig.percent).toBe(40)
    const rollup = await computeProjectProgress(project.id)
    // both weight 1 → (100 + 40)/2 = 70
    expect(rollup.percent).toBe(70)
    expect(rollup.workstreams.length).toBe(2)
  })

  it('gate status change affects milestone readiness evidence chain', async () => {
    const gate = await prisma.gate.findUnique({ where: { code: 'GATE-CORE-1' } })
    const updated = await updateGate(gate.id, { status: 'PASSED', evidence: { approvedBy: 'owner' } }, { viewer })
    expect(updated.status).toBe('PASSED')
    expect(JSON.parse(updated.evidenceJson).approvedBy).toBe('owner')
  })

  it('archive project soft-deletes', async () => {
    const p3 = await createProject({ workspaceId: workspace.id, name: 'Archive me', code: 'PRJ-CORE-3' }, { viewer })
    await archiveProject(p3.id, { viewer })
    const found = await prisma.project.findUnique({ where: { id: p3.id } })
    expect(found.deletedAt).not.toBeNull()
    expect(found.status).toBe('ARCHIVED')
  })

  it('workstream update changes strategy + weight', async () => {
    const updated = await updateWorkstream(wsDev.id, { progressWeight: 2.5 }, { viewer })
    expect(updated.progressWeight).toBe(2.5)
  })
})
