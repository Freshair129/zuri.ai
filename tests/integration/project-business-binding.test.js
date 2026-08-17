// @req FR-043 - Project has a direct Business owner and a secondary Space context.
// @spec ADR-014, SDD-021, BR-001, SEC-001
// @tested tests/integration/project-business-binding.test.js
// @req FR-072 — repaid: every createProject/updateProject call below now
// carries a viewer that owns both fixture Businesses, per the file-local
// asOwner wrapper (route-viewer-design.md §6).
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import {
  createBusiness,
  createPortfolio,
  createTenant,
  createWorkspace,
} from '../factories/scope'
import { createProject, listProjects, updateProject } from '@/modules/project-manager/application/project-service'
import { makeViewer } from '../factories/viewer'

let businessA
let businessB
let businessSpace
let sharedSpace
let project
let sharedProject
let owner

describe('Project Business ownership and Space context', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Binding Group', code: 'PF-BINDING' })
    const tenantA = await createTenant({ portfolioId: portfolio.id, name: 'Binding Tenant A', code: 'TNT-BIND-A' })
    const tenantB = await createTenant({ portfolioId: portfolio.id, name: 'Binding Tenant B', code: 'TNT-BIND-B' })
    businessA = await createBusiness({ tenantId: tenantA.id, name: 'Binding Business A', code: 'BUS-BIND-A' })
    businessB = await createBusiness({ tenantId: tenantB.id, name: 'Binding Business B', code: 'BUS-BIND-B' })
    businessSpace = await createWorkspace({ name: 'Business Space', code: 'WS-BIND-BUS', scopeType: 'BUSINESS', businessId: businessA.id })
    sharedSpace = await createWorkspace({ name: 'Shared Space', code: 'WS-BIND-SHARED', scopeType: 'PORTFOLIO', portfolioId: portfolio.id })
    // Owns both fixture Businesses so the pre-existing business-mismatch and
    // null-owner assertions below still exercise the rule they were written
    // for, rather than tripping the new FR-072 guard instead.
    owner = makeViewer({
      visibleBusinessIds: [businessA.id, businessB.id],
      ownedBusinessIds: [businessA.id, businessB.id],
    })
  })

  const asOwner = (fn) => (...args) => fn(...args, { viewer: owner })

  it('derives the direct Business owner from a Business Space', async () => {
    project = await asOwner(createProject)({ workspaceId: businessSpace.id, name: 'Owned Project', code: 'PRJ-BIND-OWNED' })
    expect(project.businessId).toBe(businessA.id)
  })

  it('rejects an owner that differs from the Space owner', async () => {
    await expect(
      asOwner(createProject)({ workspaceId: businessSpace.id, businessId: businessB.id, name: 'Mismatch', code: 'PRJ-BIND-MISMATCH' })
    ).rejects.toThrow(/business.*space|space.*business|mismatch/i)
  })

  it('rejects an explicit null owner in a Business Space', async () => {
    await expect(
      asOwner(createProject)({ workspaceId: businessSpace.id, businessId: null, name: 'Null owner', code: 'PRJ-BIND-NULL' })
    ).rejects.toThrow(/business.*space|owner/i)
  })

  // FR-072(b): a shared (PORTFOLIO-scoped) Workspace is governed by no
  // Business, so no principal — even one owning every fixture Business — can
  // be authorized to create directly into it. This is a capability removal:
  // before this wave, creating an explicitly-ownerless Project here succeeded.
  it('refuses to create a Project directly in a shared (PORTFOLIO) Space, for every principal', async () => {
    await expect(
      asOwner(createProject)({ workspaceId: sharedSpace.id, name: 'Shared Project (refused)', code: 'PRJ-BIND-SHARED-REFUSED' })
    ).rejects.toMatchObject({ status: 403 })
  })

  it('filters Business project reads by the direct owner', async () => {
    // The negative half of this proof needs a real ownerless shared-Space
    // Project to exclude — createProject can no longer produce one (the test
    // above), so it is planted directly with Prisma, matching the arrangement
    // move used for the same reason in project-authorization.test.js and
    // fr059-business-strategy-mutation.test.js. This is a genuine row the
    // filter must exclude, not a create-path assertion.
    sharedProject = await prisma.project.create({
      data: { code: 'PRJ-BIND-SHARED', workspaceId: sharedSpace.id, name: 'Shared Project' },
    })
    expect(sharedProject.businessId).toBeNull()

    const projects = await listProjects({ businessId: businessA.id })
    expect(projects.some((item) => item.id === project.id)).toBe(true)
    expect(projects.some((item) => item.id === sharedProject.id)).toBe(false)
  })

  it('rejects moving a Business project to another Business Space', async () => {
    const otherSpace = await createWorkspace({ name: 'Other Business Space', code: 'WS-BIND-OTHER', scopeType: 'BUSINESS', businessId: businessB.id })
    await expect(asOwner(updateProject)(project.id, { workspaceId: otherSpace.id })).rejects.toThrow(/business|space/i)
  })
})
