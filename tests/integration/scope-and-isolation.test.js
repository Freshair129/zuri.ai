import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import {
  createPortfolio,
  createTenant,
  createBusiness,
  createBranch,
  createWorkspace,
  listWorkspacesForScope,
  assertWorkspaceInScope,
} from '../factories/scope'
import { createProject, listProjects } from '@/modules/project-manager/application/project-service'
import { makeViewer } from '../factories/viewer'

let portfolio, tenant1, tenant2, bus1, bus2, ws1, ws2, owner

describe('scope chain + tenant isolation', () => {
  beforeAll(async () => {
    portfolio = await createPortfolio({ name: 'Iso Group', code: 'PF-ISO' })
    tenant1 = await createTenant({ portfolioId: portfolio.id, name: 'Iso Tenant 1', code: 'TNT-ISO-1' })
    tenant2 = await createTenant({ portfolioId: portfolio.id, name: 'Iso Tenant 2', code: 'TNT-ISO-2' })
    bus1 = await createBusiness({ tenantId: tenant1.id, name: 'Iso Business 1', code: 'BUS-ISO-1' })
    bus2 = await createBusiness({ tenantId: tenant2.id, name: 'Iso Business 2', code: 'BUS-ISO-2' })
    ws1 = await createWorkspace({ name: 'Iso WS 1', scopeType: 'BUSINESS', businessId: bus1.id, code: 'WS-ISO-1' })
    ws2 = await createWorkspace({ name: 'Iso WS 2', scopeType: 'BUSINESS', businessId: bus2.id, code: 'WS-ISO-2' })
    owner = makeViewer({ visibleBusinessIds: [bus1.id], ownedBusinessIds: [bus1.id] })
  })

  it('creates the full chain portfolio → tenant → business → workspace → project', async () => {
    const project = await createProject({ workspaceId: ws1.id, name: 'Iso Project', code: 'PRJ-ISO-1' }, { viewer: owner })
    expect(project.id).toBeTruthy()
    expect(project.code).toBe('PRJ-ISO-1')
    const loaded = await prisma.project.findUnique({ where: { id: project.id }, include: { workspace: true } })
    expect(loaded.workspace.businessId).toBe(bus1.id)
    expect(loaded.workspace.tenantId).toBe(tenant1.id)
    expect(loaded.workspace.portfolioId).toBe(portfolio.id)
  })

  it('business records carry tenant ownership', async () => {
    const b = await prisma.business.findUnique({ where: { id: bus1.id } })
    expect(b.tenantId).toBe(tenant1.id)
  })

  it('tenant is never a branch: branch creation validates tenant match', async () => {
    await expect(
      createBranch({ tenantId: tenant2.id, businessId: bus1.id, name: 'Wrong Tenant Branch' })
    ).rejects.toThrow(/tenant/i)
    const branch = await createBranch({ tenantId: tenant1.id, businessId: bus1.id, name: 'Iso Branch' })
    expect(branch.tenantId).toBe(tenant1.id)
    expect(branch.id).not.toBe(tenant1.id)
  })

  it('BUS-ISO-1 workspace is not returned in BUS-ISO-2 scoped query', async () => {
    const wsForBus2 = await listWorkspacesForScope({ businessId: bus2.id })
    const codes = wsForBus2.map((w) => w.code)
    expect(codes).toContain('WS-ISO-2')
    expect(codes).not.toContain('WS-ISO-1')
  })

  it('projects are isolated per business scope', async () => {
    const bus2Projects = await listProjects({ businessId: bus2.id })
    expect(bus2Projects.find((p) => p.code === 'PRJ-ISO-1')).toBeUndefined()
    const bus1Projects = await listProjects({ businessId: bus1.id })
    expect(bus1Projects.find((p) => p.code === 'PRJ-ISO-1')).toBeTruthy()
  })

  it('cross-tenant scope assertion is rejected', async () => {
    await expect(assertWorkspaceInScope(ws1.id, { tenantId: tenant2.id })).rejects.toThrow(/cross-tenant/i)
    await expect(assertWorkspaceInScope(ws1.id, { businessId: bus2.id })).rejects.toThrow(/cross-business/i)
    await expect(assertWorkspaceInScope(ws1.id, { tenantId: tenant1.id })).resolves.toBeTruthy()
  })

  it('workspace requires explicit scope', async () => {
    await expect(createWorkspace({ name: 'No scope', scopeType: 'BUSINESS' })).rejects.toThrow(/businessId/)
  })
})
