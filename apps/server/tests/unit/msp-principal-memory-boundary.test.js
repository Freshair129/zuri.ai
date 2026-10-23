import { describe, expect, it } from 'vitest'
import { createHash, createHmac } from 'node:crypto'
import { createMspVaultResolver } from '@/modules/agent/msp-vault-resolver'
import { createMspMemoryPort } from '@/modules/agent/msp-memory-port'

// @req FR-057 — canonical private memory uses the Tenant/Principal/Agent/Workspace vault.
// @spec SDD-030, SEC-013 — legacy Workspace storage is not private principal memory.
// @tested this file
const key = 'synthetic-principal-memory-service-key-32-bytes'
function authorization() {
  return { authContext: { transport: { signatureVerified: true },
    actor: { principalId: 'person-one', identityVerified: true },
    scope: { tenantId: 'tenant-one', businessId: 'business-one', workspaceId: 'workspace-one', projectId: 'project-one' },
    request: { agentId: 'agent-one' }, conversation: { threadId: 'thread-one' },
    policy: { decision: 'ALLOW', privateMemoryAllowed: true, episodicMemoryAllowed: true,
      version: 'test-v1', mspAuthorization: { read: true, writePrivate: true } } },
    authorizedVaults: [{ scope: 'private', tenantId: 'tenant-one', businessId: 'business-one', principalId: 'person-one',
      agentId: 'agent-one', workspaceId: 'workspace-one', projectId: 'project-one' }] }
}
const result = { workspacePrivateVaultId: 'legacy-workspace', principalPrivateVaultId: 'opaque-principal-one',
  globalPrivateVaultIds: [], sharedVaultIds: [], permissions: { read: true, writePrivate: true, writeShared: false, policyVersion: 'test-v1' } }
function verifyAccess(name, input) {
  const { access, ...payload } = input
  expect(access.grant).toMatchObject({ operation: name, tenantId: 'tenant-one', principalId: 'person-one', agentId: 'agent-one', workspaceId: 'workspace-one' })
  expect(access.grant.payloadHash).toBe(createHash('sha256').update(JSON.stringify(payload)).digest('hex'))
  expect(access.signature).toBe(createHmac('sha256', key).update(JSON.stringify(access.grant)).digest('hex'))
  expect(access.grant.nonce).toMatch(/^[a-f0-9]{32}$/)
}
describe('private principal memory contract', () => {
  it('refuses unsupported operations and malformed or already-signed inputs', async () => {
    const resolver = createMspVaultResolver({ serviceKey: key, transport: async () => result })
    await expect(resolver.authorizeMemoryTool(authorization(), { operation: 'msp_memory_forget', input: {} }))
      .rejects.toThrow(/not supported/)
    for (const input of [undefined, null, [], { access: {} }]) {
      await expect(resolver.authorizeMemoryTool(authorization(), { operation: 'msp_memory_list', input }))
        .rejects.toThrow(/unsigned object/)
    }
  })
  it('requests the principal vault with both independently signed API-010 grants', async () => {
    let sent
    const resolver = createMspVaultResolver({ serviceKey: key, transport: async (_name, input) => { sent = input; return result } })
    const resolved = await resolver.resolve(authorization(), { principalPrivate: true })
    expect(resolved.principalPrivateVaultId).toBe('opaque-principal-one')
    const { legacy_access, ...principalPayload } = sent
    verifyAccess('msp_vault_resolve', principalPayload)
    const { access, ...payload } = principalPayload
    expect(legacy_access.grant.payloadHash).toBe(createHash('sha256').update(JSON.stringify(payload)).digest('hex'))
    expect(access.grant.allowPassport).toBe(false)
  })
  it('refuses a legacy-only or aliased response before any private memory access', async () => {
    for (const principalPrivateVaultId of [undefined, null, '', 'legacy-workspace']) {
      const calls = []
      const transport = async (name) => { calls.push(name); return { ...result, principalPrivateVaultId } }
      const port = createMspMemoryPort({ transport, vaultSetResolver: createMspVaultResolver({ transport, serviceKey: key }) })
      await expect(port.recallAuthorized(authorization())).rejects.toThrow(/principal.*vault/i)
      expect(calls).toEqual(['msp_vault_resolve'])
    }
  })
  it('signs API-009 reads and writes and selects only the principal vault', async () => {
    const calls = []
    const transport = async (name, input) => {
      calls.push({ name, input })
      if (name === 'msp_vault_resolve') return result
      verifyAccess(name, input)
      if (name === 'msp_memory_list') return { entities: [] }
      return { entity_id: 'entity-one', vault_id: 'opaque-principal-one', category: 'memory', key: 'preference', version: 1 }
    }
    const port = createMspMemoryPort({ transport, vaultSetResolver: createMspVaultResolver({ transport, serviceKey: key }) })
    await port.recallAuthorized(authorization())
    expect(calls.find(row => row.name === 'msp_memory_list').input.vault_id).toBe('opaque-principal-one')
    await port.rememberAuthorized(authorization(), { key: 'preference', value: 'blue' })
    expect(calls.find(row => row.name === 'msp_memory_upsert').input.vault).toEqual({ vault_id: 'opaque-principal-one', vault_type: 'principal_private' })
  })
})
