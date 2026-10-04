import { describe, expect, it } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { createMspVaultResolver } from '@/modules/agent/msp-vault-resolver'

// @req FR-057 — API-010 is the canonical per-turn vault resolution boundary.
// @spec ADR-022, SDD-030, SEC-013 — required server scope and fail-closed transport.
// @tested this file

const SERVICE_KEY = 'msp-test-service-key-0123456789012345'

function authorizedContext(overrides = {}) {
  return {
    authContext: {
      transport: { signatureVerified: true },
      actor: { principalId: 'person-1', identityVerified: true },
      scope: {
        tenantId: 'tenant-1',
        businessId: 'business-1',
        workspaceId: 'workspace-1',
        projectId: 'project-1',
      },
      request: { agentId: 'agent-1', capability: 'READ' },
      conversation: { threadId: 'thread-1', sessionId: 'session-1', instanceId: 'instance-1' },
      policy: { decision: 'ALLOW', privateMemoryAllowed: true, episodicMemoryAllowed: true, version: 'FR-057.v2' },
    },
    authorizedVaults: [{
      scope: 'private',
      tenantId: 'tenant-1',
      principalId: 'person-1',
      agentId: 'agent-1',
      workspaceId: 'workspace-1',
      projectId: 'project-1',
    }],
    ...overrides,
  }
}

const resolved = {
  workspacePrivateVaultId: 'vault_workspace_private_1',
  globalPrivateVaultIds: ['vault_global_1'],
  sharedVaultIds: ['vault_shared_1'],
  permissions: {
    read: true,
    writePrivate: false,
    writeShared: false,
    policyVersion: 'FR-057.v2',
  },
}

describe('createMspVaultResolver (FR-057, API-010)', () => {
  it('calls msp_vault_resolve with server-derived canonical wire fields', async () => {
    const calls = []
    const transport = async (name, input) => {
      calls.push({ name, input })
      return resolved
    }
    const resolver = createMspVaultResolver({ transport, actor: 'zuri-test', serviceKey: SERVICE_KEY })

    await expect(resolver.resolve(authorizedContext())).resolves.toEqual(resolved)
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({ name: 'msp_vault_resolve' })
    const { legacy_access: legacyAccess, ...payload } = calls[0].input
    expect(payload).toEqual({
      actor: 'zuri-test',
      access_context: {
        tenant_id: 'tenant-1',
        business_id: 'business-1',
        principal_id: 'person-1',
        agent_id: 'agent-1',
        instance_id: 'instance-1',
        project_id: 'project-1',
        workspace_id: 'workspace-1',
        thread_id: 'thread-1',
        session_id: 'session-1',
        policy_version: 'FR-057.v2',
      },
      authorization: {
        membership_active: true,
        allowed: true,
        allow_global_private: false,
        allow_tenant_global_private: false,
        allow_shared: false,
        read: true,
        write_private: false,
        write_shared: false,
      },
    })
    expect(legacyAccess.grant).toMatchObject({
      operation: 'msp_vault_resolve_legacy',
      tenantId: 'tenant-1', principalId: 'person-1', agentId: 'agent-1',
      workspaceId: 'workspace-1', projectId: 'project-1',
      payloadHash: createHash('sha256').update(JSON.stringify(payload)).digest('hex'),
    })
    expect(legacyAccess.grant.nonce).toMatch(/^[a-f0-9]{32}$/)
    expect(legacyAccess.grant.expiresAt).toBeGreaterThan(Date.now())
    expect(legacyAccess.signature).toBe(createHmac('sha256', SERVICE_KEY)
      .update(JSON.stringify(legacyAccess.grant)).digest('hex'))
  })

  it('fails closed before transport when canonical scope is incomplete', async () => {
    const calls = []
    const resolver = createMspVaultResolver({
      transport: async (...args) => { calls.push(args); return resolved }, serviceKey: SERVICE_KEY,
    })
    const base = authorizedContext()
    const context = authorizedContext({
      authContext: {
        ...base.authContext,
        scope: { tenantId: 'tenant-1', workspaceId: 'workspace-1', projectId: null },
      },
    })

    await expect(resolver.resolve(context)).rejects.toThrow(/projectId|project_id/)
    expect(calls).toHaveLength(0)
  })

  it('fails closed before transport when episodic authorization is absent', async () => {
    const calls = []
    const resolver = createMspVaultResolver({ transport: async (...args) => { calls.push(args); return resolved } })
    const context = authorizedContext()
    context.authContext.policy.episodicMemoryAllowed = false

    await expect(resolver.resolve(context)).rejects.toThrow(/episodic-memory ALLOW AuthContext/)
    expect(calls).toHaveLength(0)
  })

  it('does not replace an MSP denial or malformed response with a local scope key', async () => {
    const denied = createMspVaultResolver({ transport: async () => { throw new Error('vault_scope_denied') }, serviceKey: SERVICE_KEY })
    await expect(denied.resolve(authorizedContext())).rejects.toThrow('vault_scope_denied')

    const malformed = createMspVaultResolver({ transport: async () => ({ globalPrivateVaultIds: [] }), serviceKey: SERVICE_KEY })
    await expect(malformed.resolve(authorizedContext())).rejects.toThrow(/workspacePrivateVaultId/)
  })

  it('rejects an unsupported operation before transport', async () => {
    const calls = []
    const resolver = createMspVaultResolver({
      transport: async (...args) => { calls.push(args); return resolved },
    })

    await expect(resolver.resolve(authorizedContext(), { operation: 'delete' })).rejects.toThrow(/operation/)
    expect(calls).toHaveLength(0)
  })
})
