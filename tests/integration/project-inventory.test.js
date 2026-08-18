// @req FR-077 — Project Inventory composes an authorized Project read model without cross-scope leakage.
// @spec SDD-045, ADR-034, ADR-012, ADR-014, ADR-016, ADR-017
// @tested tests/integration/project-inventory.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer } from '../factories/viewer'
import {
  createBusiness,
  createPortfolio,
  createTenant,
  createWorkspace,
} from '../factories/scope'
import { createProject, createWorkstream } from '@/modules/project-manager/application/project-service'
import { createContainer, createItem } from '@/modules/project-manager/application/work-service'
import { createGate, createMilestone } from '@/modules/project-manager/application/milestone-gate-service'
import { createProjectFile } from '@/modules/project-manager/application/project-file-service'
import { createRepository, linkRepository } from '@/modules/project-manager/application/repository-service'
import { getProjectInventory } from '@/modules/project-manager/application/project-inventory-read-model'

let projectA
let projectB
let sharedProject
let itemA
let viewerA
let viewerB

describe('FR-077 Project Inventory', () => {
  beforeAll(async () => {
    const suffix = String(Date.now())
    const portfolio = await createPortfolio({ name: `Inventory Group ${suffix}`, code: `PF-INV-${suffix}` })
    const tenantA = await createTenant({ portfolioId: portfolio.id, name: `Inventory Tenant A ${suffix}`, code: `TNT-INV-A-${suffix}` })
    const tenantB = await createTenant({ portfolioId: portfolio.id, name: `Inventory Tenant B ${suffix}`, code: `TNT-INV-B-${suffix}` })
    const businessA = await createBusiness({ tenantId: tenantA.id, name: `Inventory Business A ${suffix}`, code: `BUS-INV-A-${suffix}` })
    const businessB = await createBusiness({ tenantId: tenantB.id, name: `Inventory Business B ${suffix}`, code: `BUS-INV-B-${suffix}` })
    const workspaceA = await createWorkspace({
      name: `Inventory Space A ${suffix}`,
      scopeType: 'BUSINESS',
      businessId: businessA.id,
      code: `WS-INV-A-${suffix}`,
    })
    const workspaceB = await createWorkspace({
      name: `Inventory Space B ${suffix}`,
      scopeType: 'BUSINESS',
      businessId: businessB.id,
      code: `WS-INV-B-${suffix}`,
    })
    const sharedWorkspace = await createWorkspace({
      name: `Inventory Tenant Space ${suffix}`,
      scopeType: 'TENANT',
      tenantId: tenantA.id,
      code: `WS-INV-TENANT-${suffix}`,
    })

    viewerA = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id] })
    viewerB = makeViewer({ visibleBusinessIds: [businessB.id], ownedBusinessIds: [businessB.id] })
    const memberA = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [] })

    projectA = await createProject({ workspaceId: workspaceA.id, name: 'Inventory Project A', code: `PRJ-INV-A-${suffix}` }, { viewer: viewerA })
    projectB = await createProject({ workspaceId: workspaceB.id, name: 'Inventory Project B', code: `PRJ-INV-B-${suffix}` }, { viewer: viewerB })
    sharedProject = await prisma.project.create({
      data: { workspaceId: sharedWorkspace.id, name: 'Shared Inventory Project', code: `PRJ-INV-S-${suffix}` },
    })

    const workstreamA = await createWorkstream({
      projectId: projectA.id,
      name: 'Delivery A',
      code: `WST-INV-A-${suffix}`,
      executionMode: 'SOFTWARE_SPRINT',
    }, { viewer: viewerA })
    const workstreamA2 = await createWorkstream({
      projectId: projectA.id,
      name: 'Delivery A2',
      code: `WST-INV-A2-${suffix}`,
      executionMode: 'OPERATIONS',
    }, { viewer: viewerA })
    const workstreamB = await createWorkstream({
      projectId: projectB.id,
      name: 'Delivery B',
      code: `WST-INV-B-${suffix}`,
      executionMode: 'SOFTWARE_SPRINT',
    }, { viewer: viewerB })
    const containerA = await createContainer({
      workstreamId: workstreamA.id,
      subtype: 'SPRINT',
      title: 'Sprint A',
      code: `WC-INV-A-${suffix}`,
    }, { viewer: viewerA })
    itemA = await createItem({
      workstreamId: workstreamA.id,
      containerId: containerA.id,
      subtype: 'TASK',
      title: 'Build A',
      code: `WI-INV-A-${suffix}`,
      status: 'DONE',
      metrics: { secretMetric: 123 },
    }, { viewer: viewerA })
    await createItem({
      workstreamId: workstreamA2.id,
      subtype: 'TASK',
      title: 'Operate A',
      code: `WI-INV-A2-${suffix}`,
    }, { viewer: viewerA })
    const itemB = await createItem({
      workstreamId: workstreamB.id,
      subtype: 'TASK',
      title: 'Build B',
      code: `WI-INV-B-${suffix}`,
    }, { viewer: viewerB })

    await createMilestone({ projectId: projectA.id, title: 'Milestone A', code: `MS-INV-A-${suffix}`, workstreamId: workstreamA.id }, { viewer: viewerA })
    await createGate({ projectId: projectA.id, title: 'Gate A', code: `GATE-INV-A-${suffix}`, workstreamId: workstreamA.id }, { viewer: viewerA })
    // FR-073 — a Repository is owned by a Business, and creating one takes that
    // Business's authority. The link below is authorized against the Project's
    // Business, so the repo belongs to the same one.
    const repo = await createRepository(
      { businessId: businessA.id, provider: 'github', fullName: `org/inventory-${suffix}`, code: `REP-INV-${suffix}` },
      { viewer: viewerA },
    )
    await linkRepository({ projectId: projectA.id, repoId: repo.id, role: 'PRIMARY', pathScope: 'src', branch: 'main' }, { viewer: viewerA })
    await createProjectFile(projectA.id, {
      name: 'legacy-plan.pdf',
      mime: 'application/pdf',
      size: 10,
      url: 'https://example.test/legacy-plan.pdf',
      code: `FIL-INV-LEGACY-${suffix}`,
    }, { viewer: viewerA })
    await prisma.fileAsset.create({
      data: {
        code: `FIL-INV-MANAGED-${suffix}`,
        tenantId: tenantA.id,
        businessId: businessA.id,
        projectId: projectA.id,
        workItemId: itemA.id,
        storageKind: 'MANAGED_BLOB',
        blobRef: `blob-${suffix}`,
        name: 'managed-plan.pdf',
        mime: 'application/pdf',
        size: 20,
        sha256: 'sha-inventory',
        status: 'ACTIVE',
      },
    })
    const person = await prisma.person.create({ data: { code: `PER-INV-${suffix}`, displayName: 'Inventory Person', email: 'inventory@example.test' } })
    await prisma.membership.create({ data: { personId: person.id, tenantId: tenantA.id, businessId: businessA.id, role: 'MEMBER' } })
    await prisma.dependency.create({
      data: { sourceType: 'WORK_ITEM', sourceId: itemA.id, targetType: 'WORKSTREAM', targetId: workstreamA.id, dependencyType: 'BLOCKS' },
    })
    await prisma.dependency.create({
      data: { sourceType: 'WORK_ITEM', sourceId: itemA.id, targetType: 'WORK_ITEM', targetId: itemB.id, dependencyType: 'REQUIRES' },
    })
    await prisma.auditEvent.create({
      data: { entityType: 'PROJECT', entityId: projectA.id, action: 'INVENTORY_FIXTURE', payloadJson: JSON.stringify({ secret: 'redact' }) },
    })
    await prisma.workstream.update({ where: { id: workstreamA.id }, data: { progressCache: 17 } })

    // Keep the MEMBER fixture explicit after creating the database rows. The
    // same visible/read scope must work even when the viewer owns no Business.
    viewerA = memberA
  })

  it('returns the authorized complete inventory and excludes cross-project edges', async () => {
    const before = await prisma.workstream.findFirst({ where: { projectId: projectA.id }, orderBy: { code: 'asc' } })
    const result = await getProjectInventory(projectA.id, { viewer: viewerA })

    expect(result.project.id).toBe(projectA.id)
    expect(result.project.business.name).toContain('Inventory Business A')
    expect(result.sections.work.workstreams.items.length).toBe(2)
    expect(result.sections.work.items.items).toHaveLength(2)
    expect(result.sections.milestones.items).toHaveLength(1)
    expect(result.sections.gates.items).toHaveLength(1)
    expect(result.sections.dependencies.items).toHaveLength(1)
    expect(result.sections.dependencies.items[0].source.id).toContain(itemA.id)
    expect(result.sections.files.items.map((file) => file.name)).toEqual(expect.arrayContaining(['legacy-plan.pdf', 'managed-plan.pdf']))
    expect(result.sections.repositories.items[0].repo.fullName).toContain('org/inventory-')
    expect(result.sections.team.items[0].person.displayName).toBe('Inventory Person')
    expect(result.sections.activity.items[0]).not.toHaveProperty('payload')
    expect(result.sections.work.progress).toBeUndefined()
    expect(result.sections.progress.rollup.percent).toBeGreaterThan(0)
    expect(result.meta.readScope).toBe('BUSINESS')

    const after = await prisma.workstream.findUnique({ where: { id: before.id } })
    expect(after.progressCache).toBe(17)
  })

  it('paginates each repeated section and marks partial output', async () => {
    const result = await getProjectInventory(projectA.id, { viewer: viewerA, page: 1, limit: 1 })

    expect(result.meta.limit).toBe(1)
    expect(result.sections.work.workstreams.truncated).toBe(true)
    expect(result.sections.work.workstreams.status).toBe('PARTIAL')
    expect(result.sections.work.workstreams.nextPage).toBe(2)
    expect(result.sections.files.truncated).toBe(true)
  })

  it('fails closed for a viewer outside the Project Business and for a fabricated id', async () => {
    const real = await getProjectInventory(projectA.id, { viewer: viewerB }).catch((error) => error)
    const fake = await getProjectInventory('does-not-exist', { viewer: viewerB }).catch((error) => error)

    expect(real.status).toBe(404)
    expect(real.message).toBe('Project not found')
    expect(fake.status).toBe(404)
    expect(fake.message).toBe(real.message)
  })

  it('allows a visible tenant member to read an ownerless tenant Project without granting mutation authority', async () => {
    const result = await getProjectInventory(sharedProject.id, { viewer: viewerA })
    expect(result.project.business).toBeNull()
    expect(result.meta.readScope).toBe('TENANT_SHARED')
    expect(result.sections.team.status).toBe('READY')
  })
})
