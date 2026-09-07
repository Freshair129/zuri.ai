import { describe, expect, it } from 'vitest'
import { createMspMemoryPort } from '@/modules/agent/msp-memory-port'

// @req FR-171 — authorized reads and writes retain real source revision provenance.
// @spec ADR-070, ADR-022 — no extra authority, no reconstructed write acknowledgement.
// @tested this file

function authorization() {
  const scope = { tenantId: 'tenant', businessId: 'business', workspaceId: 'workspace', projectId: 'project' }
  return {
    authContext: { scope, actor: { principalId: 'person' }, request: { agentId: 'agent' },
      conversation: { sessionId: 'caller-session', instanceId: 'worker', threadId: 'thread' },
      policy: { decision: 'ALLOW', privateMemoryAllowed: true } },
    authorizedVaults: [{ scope: 'private', ...scope, principalId: 'person', agentId: 'agent' }],
  }
}

function entity(version, value) {
  return { entity_id: 'msp:entity-1', vault_id: 'opaque-vault', category: 'agent-memory', key: 'fact',
    current_version: version, body_json: { value }, source_hash: 'a'.repeat(64), recorded_at: '2026-09-07T12:00:00Z' }
}

function fixture(transport) {
  let resolutions = 0
  const port = createMspMemoryPort({ transport, vaultSetResolver: { resolve: async () => {
    resolutions += 1
    return { workspacePrivateVaultId: 'opaque-vault', globalPrivateVaultIds: [], sharedVaultIds: [],
      permissions: { read: true, writePrivate: true, writeShared: false, policyVersion: 'v1' } }
  } } })
  return { port, resolutions: () => resolutions }
}

describe('MSP memory lineage at the authorized port', () => {
  it.each([
    'tenant:other/principal:person',
    'tenant:tenant/principal:other',
    'tenant:tenant/principal:person/principal:other',
    'prefix-tenant:tenant/principal:person',
  ])('rejects a compatibility resolver scope substitution before transport: %s', async vault => {
    let calls = 0
    const port = createMspMemoryPort({ compatibilityMode: true, vaultResolver: () => vault,
      transport: async () => { calls += 1; return { entities: [] } } })
    await expect(port.recallAuthorized(authorization())).rejects.toThrow(/does not match AuthContext/)
    await expect(port.rememberAuthorized(authorization(), { key: 'fact' })).rejects.toThrow(/does not match AuthContext/)
    expect(calls).toBe(0)
  })
  it('retains page indexes and scope for each explicitly authorized compatibility vault', async () => {
    const auth = authorization()
    auth.authorizedVaults = ['a', 'b'].map(suffix => ({ ...auth.authorizedVaults[0],
      scopeKey: `tenant:tenant/principal:person/vault:${suffix}` }))
    const port = createMspMemoryPort({ compatibilityMode: true,
      transport: async (_, args) => ({ entities: [{ ...entity(1, args.vault_id), vault_id: args.vault_id }] }) })
    const result = await port.recallAuthorized(auth)
    expect(result.evidence.selection).toBe('RETURNED_PAGES')
    expect(result.evidence.pages.map(page => [page.entryOffset, page.evidence.vaultId]))
      .toEqual(auth.authorizedVaults.map((scope, index) => [index, scope.scopeKey]))
    expect(result.entries.map(entry => entry.value)).toEqual(auth.authorizedVaults.map(scope => scope.scopeKey))
    expect(Object.isFrozen(result.evidence.pages)).toBe(true)
  })

  it('rejects a foreign vault even when its entity body is missing, on both reads and writes', async () => {
    const badEntity = { entity_id: 'other', vault_id: 'foreign-vault' }
    const { port } = fixture(async name => name === 'msp_memory_upsert'
      ? { entity: badEntity } : { entities: [badEntity] })
    await expect(port.recallAuthorized(authorization())).rejects.toMatchObject({ code: 'MSP_MEMORY_EVIDENCE_SCOPE_MISMATCH' })
    await expect(port.rememberAuthorized(authorization(), { key: 'fact' })).rejects.toMatchObject({
      code: 'MSP_MEMORY_EVIDENCE_SCOPE_MISMATCH', writeOutcome: 'UNKNOWN',
    })
  })
  it('does not acknowledge another key in the authorized vault as the requested write', async () => {
    const { port } = fixture(async () => ({ entity: { ...entity(2, 'other'), key: 'other-fact' }, changed: true }))
    await expect(port.rememberAuthorized(authorization(), { key: 'fact' })).rejects.toMatchObject({
      code: 'MSP_MEMORY_WRITE_TARGET_MISMATCH', writeOutcome: 'UNKNOWN',
    })
  })
  it('captures one returned page and source version without another retrieval', async () => {
    const calls = []
    const source = entity(3, 'at recall')
    const { port } = fixture(async (name, args) => {
      calls.push({ name, args })
      return { entities: [source], next_page_token: 'another-page' }
    })
    const recall = await port.recallAuthorized(authorization())
    source.body_json.value = 'changed later'
    expect(recall.entries).toEqual([{ value: 'at recall' }])
    expect(recall.evidence).toMatchObject({ hasMore: true, sessionAuthority: 'NOT_ATTESTED_BY_API_009',
      callerContext: { sessionId: 'caller-session', instanceId: 'worker' },
      references: [{ memoryId: 'msp:entity-1', version: 3, entryIndex: 0 }] })
    expect(calls).toEqual([{ name: 'msp_memory_list', args: { vault_id: 'opaque-vault' } }])
  })

  it('keeps the upsert revision distinct from a later recall revision and rechecks vault permission', async () => {
    const { port, resolutions } = fixture(async name => name === 'msp_memory_upsert'
      ? { entity: entity(2, 'my write'), created: false, changed: true }
      : { entities: [entity(3, 'another write')], next_page_token: null })
    const result = await port.rememberAuthorized(authorization(), { key: 'fact', value: 'my write' })
    expect(result.writeReceipt).toMatchObject({ status: 'ACKNOWLEDGED', reference: { version: 2 }, entry: { value: 'my write' } })
    expect(result.evidence.references[0].version).toBe(3)
    expect(result.entries).toEqual([{ value: 'another write' }])
    expect(resolutions()).toBe(2)
  })

  it('preserves the acknowledgement if post-write recall fails, without exposing provider error text', async () => {
    let writes = 0
    const { port } = fixture(async name => {
      if (name === 'msp_memory_upsert') { writes += 1; return { entity: entity(2, 'committed'), created: false, changed: true } }
      throw new Error('provider secret marker')
    })
    await expect(port.rememberAuthorized(authorization(), { key: 'fact' })).rejects.toMatchObject({
      message: 'MSP_MEMORY_POST_WRITE_RECALL_FAILED', writeOutcome: 'ACKNOWLEDGED',
      writeReceipt: { reference: { version: 2 }, entry: { value: 'committed' } },
    })
    expect(writes).toBe(1)
  })

  it('refuses conflicting returned vault identity instead of loading another principal memory', async () => {
    const { port } = fixture(async () => ({ entities: [{ ...entity(1, 'foreign'), vault_id: 'foreign-vault' }] }))
    await expect(port.recallAuthorized(authorization())).rejects.toMatchObject({ code: 'MSP_MEMORY_EVIDENCE_SCOPE_MISMATCH' })
  })

  it('denies before transport when current private-memory policy is revoked', async () => {
    let calls = 0
    const { port } = fixture(async () => { calls += 1; return { entities: [] } })
    const denied = authorization()
    denied.authContext.policy.privateMemoryAllowed = false
    await expect(port.recallAuthorized(denied)).rejects.toThrow(/ALLOW/)
    await expect(port.rememberAuthorized(denied, {})).rejects.toThrow(/ALLOW/)
    expect(calls).toBe(0)
  })
})
