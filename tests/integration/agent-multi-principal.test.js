import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '@/modules/project-manager/application/scope-service'
import { createProject } from '@/modules/project-manager/application/project-service'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { assembleAgentContext, createInMemoryMemory, createMspMemoryPort } from '@/modules/agent'
import { makeViewer } from '../factories/viewer'

// @req FR-057 — multi-principal group threads use separate authorized private vaults.
// @spec ADR-022, SDD-030, SEC-013 — policy-before-retrieval, no client/model vault injection,
//   and next-turn Membership revocation.
// @tested this file

let tenant
let business
let alice
let bob
let salesWorkspace
let supportWorkspace
let salesProject
let archivedProject
let foreignBusiness
let foreignWorkspace
let foreignProject
let crossTenantBusiness
let crossTenantWorkspace
let crossTenantProject

async function linkedStaff(code, lineUserId) {
  const person = await prisma.person.create({ data: { code, displayName: code } })
  await prisma.membership.create({
    data: { personId: person.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER' },
  })
  const token = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
  await redeemLinkToken({ tenantId: tenant.id, token: token.token, lineUserId })
  return person
}

describe('FR-057 multi-principal agent context', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Vault Group', code: 'PF-FR057' })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'Vault Tenant', code: 'TNT-FR057' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Vault Business', code: 'BUS-FR057' })
    salesWorkspace = await createWorkspace({ scopeType: 'BUSINESS', businessId: business.id, name: 'Sales Vault', code: 'WS-FR057-SALES' })
    supportWorkspace = await createWorkspace({ scopeType: 'BUSINESS', businessId: business.id, name: 'Support Vault', code: 'WS-FR057-SUPPORT' })
    const ownerOfBusiness = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    salesProject = await createProject({ workspaceId: salesWorkspace.id, businessId: business.id, name: 'Sales Project', code: 'PRJ-FR057-SALES' }, { viewer: ownerOfBusiness })
    archivedProject = await createProject({ workspaceId: salesWorkspace.id, businessId: business.id, name: 'Archived Project', code: 'PRJ-FR057-ARCHIVED' }, { viewer: ownerOfBusiness })
    await prisma.project.update({ where: { id: archivedProject.id }, data: { status: 'ARCHIVED' } })
    foreignBusiness = await createBusiness({ tenantId: tenant.id, name: 'Foreign Vault Business', code: 'BUS-FR057-FOREIGN' })
    foreignWorkspace = await createWorkspace({ scopeType: 'BUSINESS', businessId: foreignBusiness.id, name: 'Foreign Vault', code: 'WS-FR057-FOREIGN' })
    const ownerOfForeignBusiness = makeViewer({ visibleBusinessIds: [foreignBusiness.id], ownedBusinessIds: [foreignBusiness.id] })
    foreignProject = await createProject({ workspaceId: foreignWorkspace.id, businessId: foreignBusiness.id, name: 'Foreign Project', code: 'PRJ-FR057-FOREIGN' }, { viewer: ownerOfForeignBusiness })
    const crossTenant = await createTenant({ portfolioId: portfolio.id, name: 'Cross Tenant', code: 'TNT-FR057-CROSS' })
    crossTenantBusiness = await createBusiness({ tenantId: crossTenant.id, name: 'Cross Tenant Business', code: 'BUS-FR057-CROSS' })
    crossTenantWorkspace = await createWorkspace({ scopeType: 'BUSINESS', businessId: crossTenantBusiness.id, name: 'Cross Tenant Vault', code: 'WS-FR057-CROSS' })
    const ownerOfCrossTenantBusiness = makeViewer({ visibleBusinessIds: [crossTenantBusiness.id], ownedBusinessIds: [crossTenantBusiness.id] })
    crossTenantProject = await createProject({ workspaceId: crossTenantWorkspace.id, businessId: crossTenantBusiness.id, name: 'Cross Tenant Project', code: 'PRJ-FR057-CROSS' }, { viewer: ownerOfCrossTenantBusiness })
    alice = await linkedStaff('PSN-FR057-ALICE', 'UFR057-alice')
    bob = await linkedStaff('PSN-FR057-BOB', 'UFR057-bob')
  })

  it('isolates private memory for two principals in the same group thread', async () => {
    const memory = createInMemoryMemory()
    const serverScope = {
      transportVerified: true,
      businessId: business.id,
      agentId: 'sales-agent',
      workspaceId: salesWorkspace.id,
    }
    const common = { tenantId: tenant.id, businessId: business.id, threadId: 'group-FR057', serverScope }

    const aliceFirst = await assembleAgentContext({ ...common, lineUserId: 'UFR057-alice', memory })
    const bobFirst = await assembleAgentContext({ ...common, lineUserId: 'UFR057-bob', memory })

    expect(aliceFirst.authContext.conversation.threadId).toBe('group-FR057')
    expect(aliceFirst.policy.decision).toBe('ALLOW')
    expect(bobFirst.policy.decision).toBe('ALLOW')
    expect(aliceFirst.authorizedVaults[0].principalId).toBe(alice.id)
    expect(bobFirst.authorizedVaults[0].principalId).toBe(bob.id)
    expect(aliceFirst.authorizedVaults[0].scopeKey).not.toBe(bobFirst.authorizedVaults[0].scopeKey)

    await memory.rememberAuthorized(aliceFirst, { key: 'alice-private', note: 'Alice only' })
    const aliceAgain = await assembleAgentContext({ ...common, lineUserId: 'UFR057-alice', memory })
    const bobAgain = await assembleAgentContext({ ...common, lineUserId: 'UFR057-bob', memory })
    expect(aliceAgain.memory.entries).toEqual([{ key: 'alice-private', note: 'Alice only' }])
    expect(bobAgain.memory.entries).toEqual([])
  })

  it('keeps a first-contact identity pending and withholds private memory', async () => {
    const context = await assembleAgentContext({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'UFR057-pending', threadId: 'group-FR057',
      serverScope: { transportVerified: true, businessId: business.id },
    })
    expect(context.identity.verified).toBe(false)
    expect(context.policy.decision).toBe('DENY')
    expect(context.policy.reason).toBe('IDENTITY_PENDING')
    expect(context.authorizedVaults).toEqual([])
    expect(context.memory.entries).toEqual([])
  })

  it('changes the scope when the same principal uses another agent or workspace', async () => {
    const first = await assembleAgentContext({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'UFR057-alice', threadId: 'group-FR057',
      serverScope: { transportVerified: true, businessId: business.id, agentId: 'sales-agent', workspaceId: salesWorkspace.id },
    })
    const second = await assembleAgentContext({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'UFR057-alice', threadId: 'group-FR057',
      serverScope: { transportVerified: true, businessId: business.id, agentId: 'support-agent', workspaceId: supportWorkspace.id },
    })
    expect(first.authorizedVaults[0].principalId).toBe(second.authorizedVaults[0].principalId)
    expect(first.authorizedVaults[0].scopeKey).not.toBe(second.authorizedVaults[0].scopeKey)
  })

  it('denies the next turn after Membership revocation', async () => {
    await prisma.membership.deleteMany({ where: { tenantId: tenant.id, personId: bob.id } })
    const context = await assembleAgentContext({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'UFR057-bob', threadId: 'group-FR057',
      serverScope: { transportVerified: true, businessId: business.id, agentId: 'sales-agent', workspaceId: salesWorkspace.id },
    })
    expect(context.policy.decision).toBe('DENY')
    expect(context.policy.reason).toBe('MEMBERSHIP_SCOPE_DENIED')
    expect(context.authorizedVaults).toEqual([])
    expect(context.memory.entries).toEqual([])
  })

  it('rejects an unauthorized vault set before an MSP round-trip', async () => {
    const calls = []
    const port = createMspMemoryPort({
      transport: async (name, input) => {
        calls.push({ name, input })
        return { entities: [] }
      },
      vaultSetResolver: {
        resolve: async () => ({
          workspacePrivateVaultId: 'unused',
          globalPrivateVaultIds: [],
          sharedVaultIds: [],
          permissions: { read: true, writePrivate: true, writeShared: false, policyVersion: 'FR-057.v2' },
        }),
      },
    })
    const aliceContext = await assembleAgentContext({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'UFR057-alice', threadId: 'group-FR057',
      serverScope: { transportVerified: true, businessId: business.id, agentId: 'sales-agent', workspaceId: salesWorkspace.id },
    })
    const bobContext = {
      ...aliceContext,
      authorizedVaults: [{ ...aliceContext.authorizedVaults[0], principalId: bob.id }],
    }
    await expect(port.recallAuthorized(bobContext)).rejects.toThrow(/does not match AuthContext/)
    expect(calls).toEqual([])
  })

  it('rejects an authorized scope from another workspace before an MSP round-trip', async () => {
    const calls = []
    const port = createMspMemoryPort({
      transport: async (name, input) => {
        calls.push({ name, input })
        return { entities: [] }
      },
      vaultSetResolver: {
        resolve: async () => ({
          workspacePrivateVaultId: 'unused',
          globalPrivateVaultIds: [],
          sharedVaultIds: [],
          permissions: { read: true, writePrivate: true, writeShared: false, policyVersion: 'FR-057.v2' },
        }),
      },
    })
    const aliceContext = await assembleAgentContext({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'UFR057-alice', threadId: 'group-FR057',
      serverScope: { transportVerified: true, businessId: business.id, agentId: 'sales-agent', workspaceId: salesWorkspace.id },
    })
    const forgedWorkspaceContext = {
      ...aliceContext,
      authorizedVaults: [{ ...aliceContext.authorizedVaults[0], workspaceId: supportWorkspace.id }],
    }
    await expect(port.recallAuthorized(forgedWorkspaceContext)).rejects.toThrow(/does not match AuthContext/)
    expect(calls).toEqual([])
  })

  it('denies private memory when the trusted runtime omits transport verification', async () => {
    const context = await assembleAgentContext({
      tenantId: tenant.id,
      businessId: business.id,
      lineUserId: 'UFR057-alice',
      serverScope: { businessId: business.id, workspaceId: salesWorkspace.id },
    })
    expect(context.policy).toMatchObject({ decision: 'DENY', reason: 'TRANSPORT_UNVERIFIED' })
    expect(context.authorizedVaults).toEqual([])
  })

  it.each([
    ['caller business differs from trusted business', 'business', 'BUSINESS_SCOPE_MISMATCH'],
    ['workspace belongs to another business', 'workspace', 'WORKSPACE_SCOPE_DENIED'],
    ['project belongs to another business', 'project', 'WORKSPACE_SCOPE_DENIED'],
  ])('denies %s before selecting a vault', async (_label, scenario, reason) => {
    const scope = scenario === 'business'
      ? { businessId: foreignBusiness.id, workspaceId: salesWorkspace.id }
      : scenario === 'workspace'
        ? { businessId: business.id, workspaceId: foreignWorkspace.id }
        : { businessId: business.id, projectId: foreignProject.id }
    const context = await assembleAgentContext({
      tenantId: tenant.id,
      businessId: business.id,
      lineUserId: 'UFR057-alice',
      serverScope: { transportVerified: true, ...scope },
    })
    expect(context.policy).toMatchObject({ decision: 'DENY', reason })
    expect(context.authorizedVaults).toEqual([])
  })

  it('accepts a persisted project only when it belongs to the trusted workspace and business', async () => {
    const context = await assembleAgentContext({
      tenantId: tenant.id,
      businessId: business.id,
      lineUserId: 'UFR057-alice',
      serverScope: {
        transportVerified: true,
        businessId: business.id,
        workspaceId: salesWorkspace.id,
        projectId: salesProject.id,
      },
    })
    expect(context.policy.decision).toBe('ALLOW')
    expect(context.authorizedVaults[0]).toMatchObject({
      workspaceId: salesWorkspace.id,
      projectId: salesProject.id,
    })
  })

  it('denies an archived project before selecting a vault', async () => {
    const context = await assembleAgentContext({
      tenantId: tenant.id,
      businessId: business.id,
      lineUserId: 'UFR057-alice',
      serverScope: {
        transportVerified: true,
        businessId: business.id,
        projectId: archivedProject.id,
      },
    })
    expect(context.policy).toMatchObject({ decision: 'DENY', reason: 'PROJECT_SCOPE_DENIED' })
    expect(context.authorizedVaults).toEqual([])
  })

  it.each([
    ['business', 'BUSINESS_SCOPE_DENIED'],
    ['workspace', 'WORKSPACE_SCOPE_DENIED'],
    ['project', 'WORKSPACE_SCOPE_DENIED'],
  ])('denies a persisted %s from another tenant before selecting a vault', async (scenario, reason) => {
    const inputBusinessId = scenario === 'business' ? crossTenantBusiness.id : business.id
    const scope = scenario === 'business'
      ? { businessId: crossTenantBusiness.id }
      : scenario === 'workspace'
        ? { businessId: business.id, workspaceId: crossTenantWorkspace.id }
        : { businessId: business.id, projectId: crossTenantProject.id }
    const context = await assembleAgentContext({
      tenantId: tenant.id,
      businessId: inputBusinessId,
      lineUserId: 'UFR057-alice',
      serverScope: { transportVerified: true, ...scope },
    })
    expect(context.policy).toMatchObject({ decision: 'DENY', reason })
    expect(context.authorizedVaults).toEqual([])
  })
})
