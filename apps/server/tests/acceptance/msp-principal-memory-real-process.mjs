import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerHooks } from 'node:module'
import { test } from 'node:test'

// @req FR-057 — real signed API-010 to API-009 principal-private isolation.
// @spec SDD-030, SEC-013 — never fall back to legacy Workspace storage.
// @tested this file
// Explicitly selected MSP artifact; synthetic keys and disposable SQLite only.
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context) } catch (error) {
    if (error.code === 'ERR_MODULE_NOT_FOUND' && specifier.startsWith('.') && context.parentURL?.includes('/src/modules/agent/')) {
      return next(specifier + '.js', context)
    }
    throw error
  }
} })
const { createMspTransportFromEnvironment } = await import('../../src/modules/agent/msp-stdio-transport.js')
const { createMspVaultResolver } = await import('../../src/modules/agent/msp-vault-resolver.js')
const { createMspMemoryPort } = await import('../../src/modules/agent/msp-memory-port.js')
const { createMspThreadMemoryPort } = await import('../../src/modules/agent/msp-thread-memory-port.js')

test('real principal memory: signed private access, isolation, replay and erasure', async t => {
  assert.ok(process.env.MSP_REPO_PATH, 'MSP_REPO_PATH is required; missing artifacts are not PASS')
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'msp-principal-'))
  const key = randomBytes(32).toString('hex')
  const transport = createMspTransportFromEnvironment({ ...process.env,
    ZURI_MSP_COMMAND: process.execPath,
    ZURI_MSP_ARGS: JSON.stringify([path.join(process.env.MSP_REPO_PATH, 'apps/msp-server/bin/msp-server.mjs')]),
    ZURI_MSP_CWD: process.env.MSP_REPO_PATH, MSP_DB_PATH: path.join(scratch, 'memory.sqlite'),
    MSP_THREAD_SERVICE_KEY: '', MSP_THREAD_SERVICE_KEYRING: JSON.stringify({ 'tenant-one': key }),
    MSP_IDENTITY_HMAC_KEY: randomBytes(32).toString('hex'), MSP_IDENTITY_HMAC_KEY_VERSION: 'acceptance-v1',
    MSP_IDENTITY_HMAC_KEYRING: '', MSP_GKS_COMMAND: '',
  })
  const resolver = createMspVaultResolver({ transport, serviceKey: key })
  const memory = createMspMemoryPort({ transport, vaultSetResolver: resolver })
  function authorization(principalId = 'person-one', workspaceId = 'workspace-one', tenantId = 'tenant-one') {
    return { authContext: { transport: { signatureVerified: true }, actor: { principalId, identityVerified: true },
      scope: { tenantId, businessId: 'business-one', workspaceId, projectId: 'project-one' },
      request: { agentId: 'agent-one' }, conversation: { threadId: 'thread-one' },
      policy: { decision: 'ALLOW', privateMemoryAllowed: true, episodicMemoryAllowed: true, version: 'acceptance-v1',
        mspAuthorization: { read: true, writePrivate: true, dataSubjectAccess: true } } },
      authorizedVaults: [{ scope: 'private', tenantId, businessId: 'business-one', principalId,
        workspaceId, projectId: 'project-one', agentId: 'agent-one' }] }
  }
  let vault
  try {
    await t.test('principal vault differs from shared legacy Workspace vault', async () => {
      vault = await resolver.resolve(authorization(), { principalPrivate: true })
      assert.ok(vault.principalPrivateVaultId)
      assert.notEqual(vault.principalPrivateVaultId, vault.workspacePrivateVaultId)
    })
    await t.test('signed write and subsequent fresh-process recall', async () => {
      const written = await memory.rememberAuthorized(authorization(), { key: 'private-preference', value: 'blue' })
      assert.equal(written.key, vault.principalPrivateVaultId)
      assert.ok(written.writeReceipt)
      const recalled = await memory.recallAuthorized(authorization())
      assert.ok(recalled.entries.some(row => row.key === 'private-preference' && row.value === 'blue'))
    })
    await t.test('another principal in the same Workspace cannot read that memory', async () => {
      const other = await memory.recallAuthorized(authorization('person-two'))
      assert.notEqual(other.key, vault.principalPrivateVaultId)
      assert.deepEqual(other.entries, [])
    })
    await t.test('Workspace isolation and fail-closed tenant keyring', async () => {
      assert.deepEqual((await memory.recallAuthorized(authorization('person-one', 'workspace-two'))).entries, [])
      await assert.rejects(memory.recallAuthorized(authorization('person-one', 'workspace-one', 'tenant-two')), /grant_unconfigured/)
    })
    await t.test('unsigned reads, tampered writes and nonce replay are refused', async () => {
      await assert.rejects(transport('msp_memory_list', { vault_id: vault.principalPrivateVaultId }), /not_found|unknown vault_id/)
      const signed = await resolver.authorizeMemoryTool(authorization(), { operation: 'msp_memory_upsert', input: {
        vault: { vault_id: vault.principalPrivateVaultId, vault_type: 'principal_private' },
        category: 'agent-memory', key: 'replay-record', body_json: { value: 'original' },
      } })
      await assert.rejects(transport('msp_memory_upsert', { ...signed, body_json: { value: 'tampered' } }), /not_found|unknown vault_id/)
      await transport('msp_memory_upsert', signed)
      await assert.rejects(transport('msp_memory_upsert', signed), /not_found|unknown vault_id/)
      assert.ok(!(await memory.recallAuthorized(authorization())).entries.some(row => row.value === 'tampered'))
    })
    await t.test('principal-vault erasure invalidates the old signed vault handle', async () => {
      const thread = createMspThreadMemoryPort({ transport, serviceKey: key, workspaceId: 'workspace-one', agentId: 'agent-one' })
      await thread.erasePrincipalInTenant({ tenantId: 'tenant-one', principalId: 'person-one',
        idempotencyKey: 'synthetic-vault-erasure', eraseVault: true, authorization: authorization() })
      const oldRead = await resolver.authorizeMemoryTool(authorization(), { operation: 'msp_memory_list', input: { vault_id: vault.principalPrivateVaultId } })
      await assert.rejects(transport('msp_memory_list', oldRead), /not_found|unknown vault_id/)
    })
  } finally {
    assert.equal(path.dirname(scratch), os.tmpdir())
    assert.ok(path.basename(scratch).startsWith('msp-principal-'))
    await new Promise(resolve => setTimeout(resolve, 100))
    fs.rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})
