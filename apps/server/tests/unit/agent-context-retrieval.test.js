import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  auditCreate: vi.fn(),
  knowledge: vi.fn(),
  resolveAgentAuthorization: vi.fn(),
}))

vi.mock('@/lib/db', () => ({
  default: { auditEvent: { create: mocks.auditCreate } },
}))

vi.mock('@/modules/knowledge', () => ({
  queryKnowledge: mocks.knowledge,
}))

vi.mock('@/modules/agent/auth-context', () => ({
  resolveAgentAuthorization: mocks.resolveAgentAuthorization,
}))

import { assembleAgentContext } from '@/modules/agent/context'
import { ROLE_MEMORY_AUDIT_ENTITY, ROLE_MEMORY_ACTIONS } from '@/modules/agent/role-memory-partition'

// @req TASK-ZAI-024, FR-098 — private-memory retrieval is permission-scoped and denied reads are audited.
// @spec ADR-043 §D2, ADR-072 D4 — authorization is evaluated before the private partition is read.
// @tested tests/unit/agent-context-retrieval.test.js

const SCOPE = {
  tenantId: 'tenant-1',
  businessId: 'business-1',
  workspaceId: 'workspace-1',
  projectId: null,
}

function authorization({ privateMemoryAllowed, read = privateMemoryAllowed }) {
  const policy = {
    version: 'FR-098.v1',
    decision: privateMemoryAllowed ? 'ALLOW' : 'DENY',
    reason: privateMemoryAllowed ? 'ALLOW' : 'MEMBERSHIP_SCOPE_DENIED',
    privateMemoryAllowed,
    mspAuthorization: { read, writePrivate: false, writeShared: false },
  }
  const principal = {
    personId: 'person-1',
    principalType: 'STAFF',
    customerId: null,
    roles: ['MEMBER'],
    identityVerified: privateMemoryAllowed,
  }
  const authContext = {
    actor: { principalId: principal.personId, principalType: principal.principalType, roles: principal.roles },
    scope: SCOPE,
    request: { agentId: 'agent-1' },
    authorization: { roles: principal.roles, permissions: ['READ'] },
    policy,
  }

  return {
    principal,
    authContext,
    policy,
    authorizedVaults: privateMemoryAllowed
      ? [{ scope: 'private', ...SCOPE, principalId: principal.personId, agentId: 'agent-1', scopeKey: 'tenant:tenant-1/principal:staff:person-1' }]
      : [],
  }
}

function memoryPort() {
  return {
    recallAuthorized: vi.fn(),
    recall: vi.fn(),
  }
}

describe('assembleAgentContext private retrieval policy (TASK-ZAI-024)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.auditCreate.mockResolvedValue({ id: 'audit-1' })
    mocks.knowledge.mockResolvedValue({ principalId: 'person-1', found: false, relations: [] })
  })

  it('returns no private entries, audits the refusal, and skips private memory ports when permission is denied', async () => {
    const authorizationResult = authorization({ privateMemoryAllowed: false })
    const memory = memoryPort()
    const threadMemory = {
      resolveThread: vi.fn().mockResolvedValue({ thread: { threadId: 'thread-1' } }),
      context: vi.fn(),
      buildContextPacket: vi.fn(({ threadContext }) => ({ threadContext })),
    }
    mocks.resolveAgentAuthorization.mockResolvedValue(authorizationResult)

    const context = await assembleAgentContext({
      tenantId: SCOPE.tenantId,
      businessId: SCOPE.businessId,
      lineUserId: 'line-user-1',
      memory,
      threadMemory,
      threadRoute: { audienceKind: 'DIRECT' },
    })

    expect(memory.recallAuthorized).not.toHaveBeenCalled()
    expect(memory.recall).not.toHaveBeenCalled()
    expect(threadMemory.context).not.toHaveBeenCalled()
    expect(context.threadMemory.threadContext).toEqual({ thread: { threadId: 'thread-1' } })
    expect(context.memory.entries).toEqual([])
    expect(mocks.auditCreate).toHaveBeenCalledTimes(1)
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        entityType: ROLE_MEMORY_AUDIT_ENTITY,
        entityId: 'tenant:tenant-1/principal:staff:person-1',
        action: ROLE_MEMORY_ACTIONS.RETRIEVAL_DENIED,
        actorType: 'AGENT',
        actorId: 'person-1',
        tenantId: SCOPE.tenantId,
        businessId: SCOPE.businessId,
        reason: 'MEMBERSHIP_SCOPE_DENIED',
      }),
    })
    expect(JSON.parse(mocks.auditCreate.mock.calls[0][0].data.payloadJson)).toMatchObject({
      partition: 'private',
      agentId: 'agent-1',
      principalType: 'STAFF',
      roleIds: ['MEMBER'],
    })
  })

  it('reads only the authorized private partition and carries its returned key', async () => {
    const authorizationResult = authorization({ privateMemoryAllowed: true })
    const memory = memoryPort()
    memory.recallAuthorized.mockResolvedValue({
      key: 'opaque-private-vault',
      entries: [{ businessId: SCOPE.businessId, partition: 'private' }],
    })
    mocks.resolveAgentAuthorization.mockResolvedValue(authorizationResult)

    const context = await assembleAgentContext({
      tenantId: SCOPE.tenantId,
      businessId: SCOPE.businessId,
      lineUserId: 'line-user-1',
      memory,
    })

    expect(memory.recallAuthorized).toHaveBeenCalledWith(authorizationResult)
    expect(memory.recall).not.toHaveBeenCalled()
    expect(context.memory).toMatchObject({
      key: 'opaque-private-vault',
      entries: [{ businessId: SCOPE.businessId, partition: 'private' }],
    })
    expect(mocks.auditCreate).not.toHaveBeenCalled()
  })

  it('treats an explicit MSP read denial as a denied retrieval even when the outer policy is allowed', async () => {
    const authorizationResult = authorization({ privateMemoryAllowed: true, read: false })
    const memory = memoryPort()
    mocks.resolveAgentAuthorization.mockResolvedValue(authorizationResult)

    const context = await assembleAgentContext({
      tenantId: SCOPE.tenantId,
      businessId: SCOPE.businessId,
      lineUserId: 'line-user-1',
      memory,
    })

    expect(memory.recallAuthorized).not.toHaveBeenCalled()
    expect(context.memory.entries).toEqual([])
    expect(mocks.auditCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: ROLE_MEMORY_ACTIONS.RETRIEVAL_DENIED,
        reason: 'MEMORY_READ_PERMISSION_DENIED',
      }),
    })
  })
})
