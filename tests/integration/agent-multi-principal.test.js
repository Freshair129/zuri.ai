import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '@/modules/project-manager/application/scope-service'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { assembleAgentContext, createInMemoryMemory, createMspMemoryPort } from '@/modules/agent'

// @req FR-057 — multi-principal group threads use separate authorized private vaults.
// @spec ADR-022, SDD-030, SEC-013 — policy-before-retrieval, no client/model vault injection,
//   and next-turn Membership revocation.
// @tested this file

let tenant
let business
let alice
let bob

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
    alice = await linkedStaff('PSN-FR057-ALICE', 'UFR057-alice')
    bob = await linkedStaff('PSN-FR057-BOB', 'UFR057-bob')
  })

  it('isolates private memory for two principals in the same group thread', async () => {
    const memory = createInMemoryMemory()
    const serverScope = { agentId: 'sales-agent', workspaceId: 'workspace-sales' }
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
      serverScope: { agentId: 'sales-agent', workspaceId: 'workspace-sales' },
    })
    const second = await assembleAgentContext({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'UFR057-alice', threadId: 'group-FR057',
      serverScope: { agentId: 'support-agent', workspaceId: 'workspace-support' },
    })
    expect(first.authorizedVaults[0].principalId).toBe(second.authorizedVaults[0].principalId)
    expect(first.authorizedVaults[0].scopeKey).not.toBe(second.authorizedVaults[0].scopeKey)
  })

  it('denies the next turn after Membership revocation', async () => {
    await prisma.membership.deleteMany({ where: { tenantId: tenant.id, personId: bob.id } })
    const context = await assembleAgentContext({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'UFR057-bob', threadId: 'group-FR057',
      serverScope: { agentId: 'sales-agent', workspaceId: 'workspace-sales' },
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
    })
    const aliceContext = await assembleAgentContext({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'UFR057-alice', threadId: 'group-FR057',
      serverScope: { agentId: 'sales-agent', workspaceId: 'workspace-sales' },
    })
    const bobContext = {
      ...aliceContext,
      authorizedVaults: [{ ...aliceContext.authorizedVaults[0], principalId: bob.id }],
    }
    await expect(port.recallAuthorized(bobContext)).rejects.toThrow(/does not match AuthContext/)
    expect(calls).toEqual([])
  })
})
