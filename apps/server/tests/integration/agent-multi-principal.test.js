import { authorizeMemoryToolFixture } from '../factories/msp-memory-authorizer'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness, createWorkspace } from '../factories/scope'
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
let switchBusiness
let switchWorkspace
let switchProject

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
    switchBusiness = await createBusiness({ tenantId: tenant.id, name: 'Switch Vault Business', code: 'BUS-FR057-SWITCH' })
    switchWorkspace = await createWorkspace({ scopeType: 'BUSINESS', businessId: switchBusiness.id,
      name: 'Switch Vault', code: 'WS-FR057-SWITCH' })
    const ownerOfSwitchBusiness = makeViewer({ visibleBusinessIds: [switchBusiness.id], ownedBusinessIds: [switchBusiness.id] })
    switchProject = await createProject({ workspaceId: switchWorkspace.id, businessId: switchBusiness.id,
      name: 'Switch Project', code: 'PRJ-FR057-SWITCH' }, { viewer: ownerOfSwitchBusiness })
    const crossTenant = await createTenant({ portfolioId: portfolio.id, name: 'Cross Tenant', code: 'TNT-FR057-CROSS' })
    crossTenantBusiness = await createBusiness({ tenantId: crossTenant.id, name: 'Cross Tenant Business', code: 'BUS-FR057-CROSS' })
    crossTenantWorkspace = await createWorkspace({ scopeType: 'BUSINESS', businessId: crossTenantBusiness.id, name: 'Cross Tenant Vault', code: 'WS-FR057-CROSS' })
    const ownerOfCrossTenantBusiness = makeViewer({ visibleBusinessIds: [crossTenantBusiness.id], ownedBusinessIds: [crossTenantBusiness.id] })
    crossTenantProject = await createProject({ workspaceId: crossTenantWorkspace.id, businessId: crossTenantBusiness.id, name: 'Cross Tenant Project', code: 'PRJ-FR057-CROSS' }, { viewer: ownerOfCrossTenantBusiness })
    alice = await linkedStaff('PSN-FR057-ALICE', 'UFR057-alice')
    bob = await linkedStaff('PSN-FR057-BOB', 'UFR057-bob')
    await prisma.membership.create({ data: { personId: alice.id, tenantId: tenant.id, businessId: switchBusiness.id, role: 'MEMBER' } })
    await prisma.customer.create({ data: { code: 'CUS-FR057-ALICE', tenantId: tenant.id, businessId: null,
      personId: alice.id, displayName: 'Consented Alice', consentStatus: 'GRANTED' } })
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

  it('keeps API-010 memory bound to the current Business across A to B to A turns', async () => {
    const calls = []
    const resolvedScopes = []
    const memory = createMspMemoryPort({
      vaultSetResolver: { authorizeMemoryTool: authorizeMemoryToolFixture, resolve: async authorization => {
        const scope = authorization.authContext.scope
        resolvedScopes.push({ ...scope, principalId: authorization.authContext.actor.principalId })
        return { workspacePrivateVaultId: 'legacy-workspace-unused', principalPrivateVaultId: `api010-${scope.businessId}`,
          globalPrivateVaultIds: ['api010-global-fallback'], sharedVaultIds: [],
          permissions: { read: true, writePrivate: false, writeShared: false, policyVersion: 'API-010.FR057' } }
      } },
      transport: async (name, input) => {
        calls.push({ name, input })
        if (name !== 'msp_memory_list') return {}
        const businessFact = input.vault_id === `api010-${business.id}` ? 'Business A private fact' : 'Business B private fact'
        return { entities: [{ entity_id: `episode-${input.vault_id}`, vault_id: input.vault_id, current_version: 1,
          body_json: { fact: businessFact }, source_hash: 'a'.repeat(64), recorded_at: '2026-10-04T00:00:00.000Z' }] }
      },
    })
    const assembleFor = (scopeBusiness, workspace, project, { episodicMemoryOptIn = true } = {}) => assembleAgentContext({
      tenantId: tenant.id, businessId: scopeBusiness.id, lineUserId: 'UFR057-alice', threadId: 'group-FR057-business-switch', memory,
      serverScope: { transportVerified: true, businessId: scopeBusiness.id, agentId: 'sales-agent',
        workspaceId: workspace.id, projectId: project?.id ?? null, episodicMemoryOptIn },
    })

    const firstA = await assembleFor(business, salesWorkspace, salesProject)
    const middleB = await assembleFor(switchBusiness, switchWorkspace, switchProject)
    const lastA = await assembleFor(business, salesWorkspace, salesProject)

    expect([firstA, middleB, lastA].map(context => context.identity.principalId)).toEqual([alice.id, alice.id, alice.id])
    expect([firstA, middleB, lastA].map(context => context.authContext.scope)).toEqual([
      { tenantId: tenant.id, businessId: business.id, workspaceId: salesWorkspace.id, projectId: salesProject.id },
      { tenantId: tenant.id, businessId: switchBusiness.id, workspaceId: switchWorkspace.id, projectId: switchProject.id },
      { tenantId: tenant.id, businessId: business.id, workspaceId: salesWorkspace.id, projectId: salesProject.id },
    ])
    expect([firstA.policy.episodicMemoryAllowed, middleB.policy.episodicMemoryAllowed, lastA.policy.episodicMemoryAllowed])
      .toEqual([true, true, true])
    expect(firstA.memory.entries).toEqual([{ fact: 'Business A private fact' }])
    expect(middleB.memory.entries).toEqual([{ fact: 'Business B private fact' }])
    expect(lastA.memory.entries).toEqual([{ fact: 'Business A private fact' }])
    expect(resolvedScopes).toEqual([
      { tenantId: tenant.id, businessId: business.id, workspaceId: salesWorkspace.id, projectId: salesProject.id, principalId: alice.id },
      { tenantId: tenant.id, businessId: switchBusiness.id, workspaceId: switchWorkspace.id, projectId: switchProject.id, principalId: alice.id },
      { tenantId: tenant.id, businessId: business.id, workspaceId: salesWorkspace.id, projectId: salesProject.id, principalId: alice.id },
    ])
    expect(calls.filter(call => call.name === 'msp_memory_list').map(call => call.input.vault_id))
      .toEqual([`api010-${business.id}`, `api010-${switchBusiness.id}`, `api010-${business.id}`])

    const callsBeforeDeniedScopes = calls.length
    const optedOut = await assembleFor(business, salesWorkspace, salesProject, { episodicMemoryOptIn: false })
    expect(optedOut.policy).toMatchObject({ episodicMemoryAllowed: false, episodicMemoryReason: 'EPISODIC_MEMORY_NOT_ENROLLED' })
    expect(optedOut.memory.entries).toEqual([])

    const missingProject = await assembleFor(business, salesWorkspace, null)
    expect(missingProject.policy).toMatchObject({ episodicMemoryAllowed: false, episodicMemoryReason: 'PRIVATE_MEMORY_SCOPE_UNAVAILABLE' })
    expect(missingProject.memory.entries).toEqual([])

    const customer = await prisma.customer.findUnique({ where: { tenantId_personId: { tenantId: tenant.id, personId: alice.id } } })
    await prisma.customer.update({ where: { id: customer.id }, data: { consentStatus: 'PENDING' } })
    let withoutConsent
    try {
      withoutConsent = await assembleFor(business, salesWorkspace, salesProject)
    } finally {
      await prisma.customer.update({ where: { id: customer.id }, data: { consentStatus: 'GRANTED' } })
    }
    expect(withoutConsent.policy).toMatchObject({ episodicMemoryAllowed: false, episodicMemoryReason: 'CUSTOMER_CONSENT_REQUIRED' })
    expect(withoutConsent.memory.entries).toEqual([])
    expect(calls).toHaveLength(callsBeforeDeniedScopes)

    const readsBeforeMismatch = calls.length
    const staleBusinessVault = { ...middleB, authorizedVaults: firstA.authorizedVaults }
    await expect(memory.recallAuthorized(staleBusinessVault)).rejects.toThrow(/scope does not match AuthContext/)
    expect(calls).toHaveLength(readsBeforeMismatch)
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
      vaultSetResolver: { authorizeMemoryTool: authorizeMemoryToolFixture,
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
    aliceContext.authContext = { ...aliceContext.authContext,
      policy: { ...aliceContext.authContext.policy, episodicMemoryAllowed: true } }
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
      vaultSetResolver: { authorizeMemoryTool: authorizeMemoryToolFixture,
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
    aliceContext.authContext = { ...aliceContext.authContext,
      policy: { ...aliceContext.authContext.policy, episodicMemoryAllowed: true } }
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
