// @req FR-068 — an authorized Project Roadmap returns Business Goals and the
// same neutral execution records without leaking another Business's Goal.
// @spec SDD-039, ADR-028, FR-070
// @tested tests/integration/project-roadmap.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant, createWorkspace } from '../factories/scope'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { createContainer, createItem } from '@/modules/project-manager/application/work-service'
import { getProjectRoadmap } from '@/modules/project-manager/application/project-roadmap-read-model'

let project
let viewerA
let viewerB
let goalA
let goalB

describe('FR-068 Project Execution Roadmap', () => {
  beforeAll(async () => {
    const suffix = String(Date.now())
    const portfolio = await createPortfolio({ name: `Roadmap Group ${suffix}`, code: `PF-RM-${suffix}` })
    const tenantA = await createTenant({ portfolioId: portfolio.id, name: `Roadmap Tenant A ${suffix}`, code: `TNT-RM-A-${suffix}` })
    const tenantB = await createTenant({ portfolioId: portfolio.id, name: `Roadmap Tenant B ${suffix}`, code: `TNT-RM-B-${suffix}` })
    const businessA = await createBusiness({ tenantId: tenantA.id, name: `Roadmap Business A ${suffix}`, code: `BUS-RM-A-${suffix}` })
    const businessB = await createBusiness({ tenantId: tenantB.id, name: `Roadmap Business B ${suffix}`, code: `BUS-RM-B-${suffix}` })
    const workspaceA = await createWorkspace({
      name: `Roadmap Space A ${suffix}`,
      scopeType: 'BUSINESS',
      businessId: businessA.id,
      code: `WS-RM-A-${suffix}`,
    })

    viewerA = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id] })
    viewerB = makeViewer({ visibleBusinessIds: [businessB.id], ownedBusinessIds: [businessB.id] })
    project = await createProject({ workspaceId: workspaceA.id, name: 'Roadmap Project', code: `PRJ-RM-${suffix}`, description: 'Roadmap outcome' }, { viewer: viewerA })

    goalA = await prisma.businessGoal.create({
      data: { businessId: businessA.id, code: `GOAL-RM-A-${suffix}`, title: 'Business A Goal', status: 'ACTIVE', progress: 37 },
    })
    goalB = await prisma.businessGoal.create({
      data: { businessId: businessB.id, code: `GOAL-RM-B-${suffix}`, title: 'Business B Secret Goal', status: 'ACTIVE', progress: 99 },
    })
    await prisma.projectGoal.createMany({ data: [{ projectId: project.id, goalId: goalA.id }, { projectId: project.id, goalId: goalB.id }] })
    await prisma.gate.create({
      data: { projectId: project.id, code: `GATE-RM-${suffix}`, title: 'Roadmap approval', status: 'OPEN', required: true },
    })

    const workstream = await createWorkstream({
      projectId: project.id,
      name: 'Sales execution',
      code: `WST-RM-${suffix}`,
      executionMode: 'B2B_SALES',
    }, { viewer: viewerA })
    const container = await createContainer({
      workstreamId: workstream.id,
      code: `PIPE-RM-${suffix}`,
      subtype: 'SALES_PIPELINE',
      title: 'Pipeline',
      status: 'ACTIVE',
    }, { viewer: viewerA })
    await createItem({
      workstreamId: workstream.id,
      containerId: container.id,
      code: `DEAL-RM-${suffix}`,
      subtype: 'DEAL',
      title: 'Close deal',
      status: 'DONE',
      numericValue: 100,
      probability: 1,
    }, { viewer: viewerA })
  })

  it('returns the authorized Business Goal and execution hierarchy', async () => {
    const result = await getProjectRoadmap(project.id, { viewer: viewerA, now: new Date('2026-08-18T00:00:00.000Z') })

    expect(result.readModel).toBe('EXECUTION_ROADMAP')
    expect(result.project.goalIds).toEqual([goalA.id])
    expect(result.goals.map((goal) => goal.code)).toEqual([goalA.code])
    expect(result.goals.map((goal) => goal.title)).not.toContain('Business B Secret Goal')
    expect(result.plans).toHaveLength(1)
    expect(result.plans[0].executionModeId).toBe('B2B_SALES')
    expect(result.containers).toHaveLength(1)
    expect(result.items).toHaveLength(1)
    expect(result.summary.completed).toBe(1)
    expect(result.closure.gates.map((gate) => gate.title)).toContain('Roadmap approval')
    expect(result.meta.readScope).toBe('BUSINESS')
  })

  it('fails closed for a viewer outside the Project Business', async () => {
    const result = await getProjectRoadmap(project.id, { viewer: viewerB }).catch((error) => error)
    expect(result.status).toBe(404)
    expect(result.message).toBe('Project not found')
  })
})
