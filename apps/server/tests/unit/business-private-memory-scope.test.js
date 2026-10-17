import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  businessFindUnique: vi.fn(),
  workspaceFindFirst: vi.fn(),
  workspaceFindUnique: vi.fn(),
  projectFindUnique: vi.fn(),
  customerFindUnique: vi.fn(),
  resolveLinePrincipal: vi.fn(),
  resolveAuthorizationContext: vi.fn(),
  recordAudit: vi.fn(),
  knowledge: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  default: {
    business: { findUnique: mocks.businessFindUnique },
    workspace: { findFirst: mocks.workspaceFindFirst, findUnique: mocks.workspaceFindUnique },
    project: { findUnique: mocks.projectFindUnique },
    customer: { findUnique: mocks.customerFindUnique },
  },
}))

vi.mock('@/modules/identity/gate', () => ({
  resolveLinePrincipal: mocks.resolveLinePrincipal,
}))

vi.mock('@/modules/identity/authorization-context', () => ({
  resolveAuthorizationContext: mocks.resolveAuthorizationContext,
}))

vi.mock('@/modules/project-manager/application/audit', () => ({
  recordAudit: mocks.recordAudit,
}))

vi.mock('@/modules/knowledge', () => ({
  queryKnowledge: mocks.knowledge,
}))

vi.mock('@/modules/agent/tools', () => ({
  defaultReadOnlyTools: () => ({ list: () => [] }),
}))

import { resolveAgentAuthorization } from '@/modules/agent/auth-context'
import { assembleAgentContext } from '@/modules/agent/context'
import { createInMemoryMemory } from '@/modules/agent/memory-port'
import { scopedMemoryKey } from '@/modules/agent/scoped-memory'

// @req TASK-ZAI-014 — generic private memory is bound to the server-resolved
// Business Space and fails closed when that scope is unavailable.
// @spec ADR-022 — ownership remains tenant/principal/agent/workspace/optional project.
// @tested this file

const TENANT_ID = 'tenant-1'
const PRINCIPAL_ID = 'person-1'
const WORKSPACE_BY_BUSINESS = {
  'business-1': {
    id: 'workspace-1', tenantId: TENANT_ID, businessId: 'business-1',
    scopeType: 'BUSINESS', provisioningKey: 'STANDARD_DEFAULT', status: 'ACTIVE',
  },
  'business-2': {
    id: 'workspace-2', tenantId: TENANT_ID, businessId: 'business-2',
    scopeType: 'BUSINESS', provisioningKey: 'STANDARD_DEFAULT', status: 'ACTIVE',
  },
}

function configureMocks() {
  mocks.businessFindUnique.mockImplementation(async ({ where }) => ({
    id: where.id,
    tenantId: TENANT_ID,
    status: 'ACTIVE',
  }))
  mocks.workspaceFindFirst.mockImplementation(async ({ where }) => WORKSPACE_BY_BUSINESS[where.businessId] ?? null)
  mocks.workspaceFindUnique.mockImplementation(async ({ where }) =>
    Object.values(WORKSPACE_BY_BUSINESS).find((workspace) => workspace.id === where.id) ?? null)
  mocks.projectFindUnique.mockResolvedValue(null)
  mocks.customerFindUnique.mockResolvedValue(null)
  mocks.resolveLinePrincipal.mockResolvedValue({
    personId: PRINCIPAL_ID,
    externalIdentityId: 'external-1',
    principalType: 'STAFF',
    customerId: null,
    roles: ['OWNER'],
    verifiedAt: new Date('2026-01-01T00:00:00.000Z'),
    linkedAt: new Date('2026-01-01T00:00:00.000Z'),
  })
  mocks.resolveAuthorizationContext.mockImplementation(async ({ businessId }) => ({
    decision: { allowed: true },
    memberships: [{ businessId }],
    roles: ['OWNER'],
    permissions: ['READ'],
  }))
  mocks.recordAudit.mockResolvedValue(undefined)
  mocks.knowledge.mockResolvedValue({ principalId: PRINCIPAL_ID, found: false, relations: [] })
}

async function authorizeBusiness(businessId, extraServerScope = {}) {
  return resolveAgentAuthorization({
    tenantId: TENANT_ID,
    businessId,
    lineUserId: 'line-subject-1',
    serverScope: {
      transportVerified: true,
      businessId,
      agentId: 'agent-1',
      ...extraServerScope,
    },
  })
}

describe('Business-scoped generic private memory (TASK-ZAI-014)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    configureMocks()
  })

  it('resolves a distinct server-owned Business Space for the same tenant and principal', async () => {
    const first = await authorizeBusiness('business-1')
    const second = await authorizeBusiness('business-2')

    expect(first.authContext.scope).toMatchObject({ businessId: 'business-1', workspaceId: 'workspace-1' })
    expect(second.authContext.scope).toMatchObject({ businessId: 'business-2', workspaceId: 'workspace-2' })
    expect(first.authorizedVaults[0]).toMatchObject({
      tenantId: TENANT_ID,
      businessId: 'business-1',
      principalId: PRINCIPAL_ID,
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      projectId: null,
    })
    expect(second.authorizedVaults[0]).toMatchObject({
      tenantId: TENANT_ID,
      businessId: 'business-2',
      principalId: PRINCIPAL_ID,
      agentId: 'agent-1',
      workspaceId: 'workspace-2',
      projectId: null,
    })
    expect(first.authorizedVaults[0].scopeKey).not.toBe(second.authorizedVaults[0].scopeKey)
    expect(mocks.workspaceFindFirst).toHaveBeenNthCalledWith(1, {
      where: {
        tenantId: TENANT_ID,
        businessId: 'business-1',
        scopeType: 'BUSINESS',
        provisioningKey: 'STANDARD_DEFAULT',
        status: 'ACTIVE',
      },
    })

    const memory = createInMemoryMemory()
    await memory.rememberAuthorized(first, { key: 'business-1-secret', value: 'private sentinel' })
    const firstContext = await assembleAgentContext({
      tenantId: TENANT_ID,
      businessId: 'business-1',
      lineUserId: 'line-subject-1',
      serverScope: { transportVerified: true, businessId: 'business-1', agentId: 'agent-1' },
      memory,
    })
    const secondContext = await assembleAgentContext({
      tenantId: TENANT_ID,
      businessId: 'business-2',
      lineUserId: 'line-subject-1',
      serverScope: { transportVerified: true, businessId: 'business-2', agentId: 'agent-1' },
      memory,
    })
    expect(firstContext.memory.entries).toEqual([{ key: 'business-1-secret', value: 'private sentinel' }])
    expect(secondContext.memory.entries).toEqual([])
  })

  it('denies private memory when the Business default Space is missing', async () => {
    mocks.workspaceFindFirst.mockResolvedValue(null)

    const authorization = await authorizeBusiness('business-1')

    expect(authorization.authContext.scope).toMatchObject({ businessId: 'business-1', workspaceId: null })
    expect(authorization.policy).toMatchObject({
      decision: 'DENY',
      reason: 'BUSINESS_WORKSPACE_SCOPE_UNAVAILABLE',
      privateMemoryAllowed: false,
    })
    expect(authorization.authorizedVaults).toEqual([])
    expect(JSON.stringify(authorization.authorizedVaults)).not.toContain('workspace:default')

    const memory = createInMemoryMemory()
    const recallAuthorized = vi.spyOn(memory, 'recallAuthorized')
    const context = await assembleAgentContext({
      tenantId: TENANT_ID,
      businessId: 'business-1',
      lineUserId: 'line-subject-1',
      serverScope: { transportVerified: true, businessId: 'business-1', agentId: 'agent-1' },
      memory,
    })
    expect(context.memory.entries).toEqual([])
    expect(recallAuthorized).not.toHaveBeenCalled()
  })

  it('rejects a trusted workspace that belongs to a different Business', async () => {
    const authorization = await authorizeBusiness('business-1', { workspaceId: 'workspace-2' })

    expect(authorization.policy).toMatchObject({ decision: 'DENY', reason: 'WORKSPACE_SCOPE_DENIED' })
    expect(authorization.authorizedVaults).toEqual([])
  })

  it('does not invent the default workspace in the ADR-022 scope key helper', () => {
    expect(() => scopedMemoryKey({ tenantId: TENANT_ID, principalId: PRINCIPAL_ID, agentId: 'agent-1' }))
      .toThrow(/server-authorized workspaceId is required/)
    expect(scopedMemoryKey({
      tenantId: TENANT_ID, principalId: PRINCIPAL_ID, agentId: 'agent-1', workspaceId: 'workspace-1',
    })).toBe(`tenant:${TENANT_ID}/principal:${PRINCIPAL_ID}/agent:agent-1/workspace:workspace-1`)
  })
})
