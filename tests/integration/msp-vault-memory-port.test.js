import { describe, expect, it } from 'vitest'
import { createMspMemoryPort } from '@/modules/agent/msp-memory-port'
import { createMspVaultResolver } from '@/modules/agent/msp-vault-resolver'

// @req FR-057 — canonical API-010 resolution precedes private API-009 access.
// @spec ADR-022, SDD-030, SEC-013 — opaque MSP IDs, permission checks, and no fallback.
// @tested this file

function authorization({ writePrivate = false } = {}) {
  return {
    authContext: {
      actor: { principalId: 'person-api010' },
      scope: {
        tenantId: 'tenant-api010',
        businessId: 'business-api010',
        workspaceId: 'workspace-api010',
        projectId: 'project-api010',
      },
      request: { agentId: 'agent-api010', capability: 'READ' },
      conversation: { threadId: 'thread-api010', sessionId: 'session-api010' },
      policy: {
        decision: 'ALLOW',
        privateMemoryAllowed: true,
        version: 'FR-057.v2',
        ...(writePrivate ? { mspAuthorization: { writePrivate: true } } : {}),
      },
    },
    authorizedVaults: [{
      scope: 'private',
      tenantId: 'tenant-api010',
      principalId: 'person-api010',
      agentId: 'agent-api010',
      workspaceId: 'workspace-api010',
      projectId: 'project-api010',
    }],
  }
}

const readOnlyVaultSet = {
  workspacePrivateVaultId: 'opaque-workspace-vault',
  globalPrivateVaultIds: ['opaque-global-vault'],
  sharedVaultIds: ['opaque-shared-vault'],
  permissions: { read: true, writePrivate: false, writeShared: false, policyVersion: 'FR-057.v2' },
}

function transportFor(vaultSet = readOnlyVaultSet) {
  const calls = []
  const transport = async (name, input) => {
    calls.push({ name, input })
    if (name === 'msp_vault_resolve') return vaultSet
    if (name === 'msp_memory_list') return { entities: [{ body_json: { key: 'fact-1', value: 'canonical' } }] }
    return { ok: true }
  }
  transport.calls = calls
  return transport
}

describe('API-010 canonical MSP memory boundary (FR-057)', () => {
  it('resolves the canonical set first and reads API-009 by opaque Workspace Private ID', async () => {
    const transport = transportFor()
    const port = createMspMemoryPort({
      transport,
      vaultSetResolver: createMspVaultResolver({ transport, actor: 'zuri-api010-test' }),
    })

    const result = await port.recallAuthorized(authorization())
    expect(result.entries).toEqual([{ key: 'fact-1', value: 'canonical' }])
    expect(result.vaultSet).toEqual(readOnlyVaultSet)
    expect(transport.calls.map((call) => call.name)).toEqual(['msp_vault_resolve', 'msp_memory_list'])
    expect(transport.calls[1].input).toEqual({ vault_id: 'opaque-workspace-vault' })
  })

  it('uses canonical write permission and never writes when MSP denies it', async () => {
    const deniedTransport = transportFor(readOnlyVaultSet)
    const deniedPort = createMspMemoryPort({
      transport: deniedTransport,
      vaultSetResolver: createMspVaultResolver({ transport: deniedTransport }),
    })
    await expect(deniedPort.rememberAuthorized(authorization(), { key: 'fact-2', value: 'nope' }))
      .rejects.toThrow(/write|permission|denied/i)
    expect(deniedTransport.calls.map((call) => call.name)).toEqual(['msp_vault_resolve'])

    const writableVaultSet = {
      ...readOnlyVaultSet,
      permissions: { ...readOnlyVaultSet.permissions, writePrivate: true },
    }
    const writableTransport = transportFor(writableVaultSet)
    const writablePort = createMspMemoryPort({
      transport: writableTransport,
      vaultSetResolver: createMspVaultResolver({ transport: writableTransport }),
    })
    await writablePort.rememberAuthorized(authorization({ writePrivate: true }), { key: 'fact-3', value: 'yes' })
    const upsert = writableTransport.calls.find((call) => call.name === 'msp_memory_upsert')
    expect(upsert.input.vault.vault_id).toBe('opaque-workspace-vault')
    expect(upsert.input.vault.vault_id).not.toContain('tenant:')
  })

  it('fails closed on an unavailable or malformed API-010 response before API-009', async () => {
    const transport = transportFor({ globalPrivateVaultIds: [] })
    const port = createMspMemoryPort({
      transport,
      vaultSetResolver: createMspVaultResolver({ transport }),
    })

    await expect(port.recallAuthorized(authorization())).rejects.toThrow(/workspacePrivateVaultId/)
    expect(transport.calls.map((call) => call.name)).toEqual(['msp_vault_resolve'])
  })

  it('validates a custom resolver response before API-009', async () => {
    const transport = transportFor()
    const port = createMspMemoryPort({
      transport,
      vaultSetResolver: { resolve: async () => ({
        workspacePrivateVaultId: 'opaque-workspace-vault',
        permissions: { read: true, writePrivate: false, writeShared: false, policyVersion: 'FR-057.v2' },
      }) },
    })

    await expect(port.recallAuthorized(authorization())).rejects.toThrow(/globalPrivateVaultIds/)
    expect(transport.calls.map((call) => call.name)).toEqual([])
  })
})
