// @req FR-043 - Project has a direct Business owner and a secondary Space context.
// @spec ADR-014, SDD-021, BR-001, SEC-001
// @tested tests/integration/project-business-binding.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import {
  createBusiness,
  createPortfolio,
  createTenant,
  createWorkspace,
} from '@/modules/project-manager/application/scope-service'
import { createProject, listProjects, updateProject } from '@/modules/project-manager/application/project-service'

let businessA
let businessB
let businessSpace
let sharedSpace
let project

describe('Project Business ownership and Space context', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Binding Group', code: 'PF-BINDING' })
    const tenantA = await createTenant({ portfolioId: portfolio.id, name: 'Binding Tenant A', code: 'TNT-BIND-A' })
    const tenantB = await createTenant({ portfolioId: portfolio.id, name: 'Binding Tenant B', code: 'TNT-BIND-B' })
    businessA = await createBusiness({ tenantId: tenantA.id, name: 'Binding Business A', code: 'BUS-BIND-A' })
    businessB = await createBusiness({ tenantId: tenantB.id, name: 'Binding Business B', code: 'BUS-BIND-B' })
    businessSpace = await createWorkspace({ name: 'Business Space', code: 'WS-BIND-BUS', scopeType: 'BUSINESS', businessId: businessA.id })
    sharedSpace = await createWorkspace({ name: 'Shared Space', code: 'WS-BIND-SHARED', scopeType: 'PORTFOLIO', portfolioId: portfolio.id })
  })

  it('derives the direct Business owner from a Business Space', async () => {
    project = await createProject({ workspaceId: businessSpace.id, name: 'Owned Project', code: 'PRJ-BIND-OWNED' })
    expect(project.businessId).toBe(businessA.id)
  })

  it('rejects an owner that differs from the Space owner', async () => {
    await expect(
      createProject({ workspaceId: businessSpace.id, businessId: businessB.id, name: 'Mismatch', code: 'PRJ-BIND-MISMATCH' })
    ).rejects.toThrow(/business.*space|space.*business|mismatch/i)
  })

  it('rejects an explicit null owner in a Business Space', async () => {
    await expect(
      createProject({ workspaceId: businessSpace.id, businessId: null, name: 'Null owner', code: 'PRJ-BIND-NULL' })
    ).rejects.toThrow(/business.*space|owner/i)
  })

  it('keeps explicit shared projects ownerless', async () => {
    const shared = await createProject({ workspaceId: sharedSpace.id, name: 'Shared Project', code: 'PRJ-BIND-SHARED' })
    expect(shared.businessId).toBeNull()
  })

  it('filters Business project reads by the direct owner', async () => {
    const projects = await listProjects({ businessId: businessA.id })
    expect(projects.some((item) => item.id === project.id)).toBe(true)
    expect(projects.some((item) => item.code === 'PRJ-BIND-SHARED')).toBe(false)
  })

  it('rejects moving a Business project to another Business Space', async () => {
    const otherSpace = await createWorkspace({ name: 'Other Business Space', code: 'WS-BIND-OTHER', scopeType: 'BUSINESS', businessId: businessB.id })
    await expect(updateProject(project.id, { workspaceId: otherSpace.id })).rejects.toThrow(/business|space/i)
  })
})
