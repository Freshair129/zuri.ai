// @req FR-003, FR-043 — Project list filtering, archive visibility, ordering,
// and disclosed truncation are proven against the local SQLite authority.
// @spec ADR-014, BR-001, BR-004, SDD-021, SEC-001, SEC-008
// @tested tests/integration/project-list-contract.test.js

import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import {
  createBusiness,
  createPortfolio,
  createTenant,
  createWorkspace,
} from '@/modules/project-manager/application/scope-service'
import { archiveProject, createProject, listProjects } from '@/modules/project-manager/application/project-service'
import { PROJECT_LIST_LIMIT } from '@/modules/project-manager/application/project-list-read-model'
import { makeViewer } from '../factories/viewer'

let business
let tenant
let workspace
let owner
let activeProject
let archivedProject

describe('Project list contract', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Project list group', code: 'PF-PROJECT-LIST' })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'Project list tenant', code: 'TNT-PROJECT-LIST' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Project list business', code: 'BUS-PROJECT-LIST' })
    workspace = await createWorkspace({
      name: 'Project list Space',
      code: 'WS-PROJECT-LIST',
      scopeType: 'BUSINESS',
      businessId: business.id,
    })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    activeProject = await createProject({
      workspaceId: workspace.id,
      name: 'Active project',
      code: 'PRJ-PROJECT-LIST-ACTIVE',
      targetAt: '2026-09-01',
    }, { viewer: owner })
    archivedProject = await createProject({
      workspaceId: workspace.id,
      name: 'Archived project',
      code: 'PRJ-PROJECT-LIST-ARCHIVED',
    }, { viewer: owner })
    await archiveProject(archivedProject.id, { viewer: owner })
  })

  it('returns a projected DTO, excludes archived rows, and discloses the active window', async () => {
    const result = await listProjects({ businessId: business.id, tenantId: tenant.id })

    expect(result.limit).toBe(PROJECT_LIST_LIMIT)
    expect(result.truncated).toBe(false)
    expect(result.items.map((item) => item.id)).toContain(activeProject.id)
    expect(result.items.map((item) => item.id)).not.toContain(archivedProject.id)
    expect(result.items.find((item) => item.id === activeProject.id)).toMatchObject({
      id: activeProject.id,
      businessId: business.id,
      workspaceId: workspace.id,
      workspace: { code: workspace.code, name: workspace.name, scopeType: 'BUSINESS' },
      workstreamCount: 0,
    })
    expect(result.items[0]).not.toHaveProperty('milestones')
    expect(result.items[0]).not.toHaveProperty('gates')
  })

  it('applies scope, status, and query filters together', async () => {
    const result = await listProjects({
      workspaceId: workspace.id,
      businessId: business.id,
      tenantId: tenant.id,
      status: 'PLANNED',
      q: 'ACTIVE',
    })

    expect(result.items).toHaveLength(1)
    expect(result.items[0].id).toBe(activeProject.id)
  })

  it('returns no rows for an archived-only status because archived rows are soft-deleted', async () => {
    const result = await listProjects({ businessId: business.id, status: 'ARCHIVED' })

    expect(result.items).toEqual([])
    expect(result.truncated).toBe(false)
  })

  it('never returns more than the hard cap and marks a truncated window', async () => {
    await prisma.project.createMany({
      data: Array.from({ length: PROJECT_LIST_LIMIT + 2 }, (_, index) => ({
        code: `PRJ-PROJECT-LIST-BULK-${index}`,
        businessId: business.id,
        workspaceId: workspace.id,
        name: `Bulk project ${index}`,
        status: 'PLANNED',
      })),
    })

    const result = await listProjects({ businessId: business.id })

    expect(result.items).toHaveLength(PROJECT_LIST_LIMIT)
    expect(result.limit).toBe(PROJECT_LIST_LIMIT)
    expect(result.truncated).toBe(true)
  })
})
