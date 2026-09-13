// @req FR-223 — the Supabase Vault adapter: one bound call per method, made as the
//   NOLOGIN role that alone may execute it, with database errors reduced to codes.
// @spec SDD-097, SEC-030, ADR-089 D1
// @tested tests/unit/integration/supabase-vault-secret-store.test.js
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  CHANNEL_SECRET_SQL,
  createPgRoleSql,
  createPrismaRoleSql,
  createSupabaseVaultSecretStore,
} from '@/platform/integrations/core/secret-store/supabase-vault-secret-store'
import { errorTrace, generateLineChannelBundle } from '../../helpers/credential-vault-fixtures'

vi.mock('@/lib/db', () => ({ default: {} }))

const scope = { tenantId: 't1', businessId: 'b1', connectionId: 'c1' }

function recorder(rows) {
  const calls = []
  return { calls, run: async (role, text, params) => { calls.push({ role, text, params }); return typeof rows === 'function' ? rows() : rows } }
}

describe('each port method is one bound call under its role', () => {
  it('writes as the writer, passing the bundle only as a parameter', async () => {
    const bundle = generateLineChannelBundle()
    const sql = recorder([{ secret_ref: `supabase-vault:${randomUUID()}`, version_number: 1 }])
    const store = createSupabaseVaultSecretStore({ sql })
    const written = await store.write({ ...scope, kind: 'LINE_CHANNEL', bundle, createdVia: 'BROWSER_MFA', actorPersonId: 'p1' })
    expect(written.versionNumber).toBe(1)
    const [call] = sql.calls
    expect(call.role).toBe('zuri_channel_vault_writer')
    expect(call.text).toBe(CHANNEL_SECRET_SQL.write)
    expect(call.text).not.toContain(bundle.channelSecret)
    expect(JSON.parse(call.params[4])).toEqual(bundle)
    expect(call.params.slice(0, 4)).toEqual(['c1', 't1', 'b1', 'LINE_CHANNEL'])
  })

  it('activates and revokes as the writer, resolves as the reader', async () => {
    const sql = recorder(() => [{ secret_ref: 'x', version_number: 2, superseded_count: 1, purge_failed_count: 0, credential_status: 'REVOKED', revoked_count: 2, purged_count: 2 }])
    const store = createSupabaseVaultSecretStore({ sql })
    await store.activate({ ...scope, versionNumber: 2, validationCode: 'LINE_OK' })
    await store.revoke({ ...scope, reason: 'owner request' })
    await store.revoke({ ...scope, reason: 'validation failed', versionNumber: 3 })
    expect(sql.calls.map(c => c.role)).toEqual(['zuri_channel_vault_writer', 'zuri_channel_vault_writer', 'zuri_channel_vault_writer'])
    expect(sql.calls[1].params[4]).toBeNull()
    expect(sql.calls[2].params[4]).toBe(3)

    const material = JSON.stringify(generateLineChannelBundle())
    const reader = recorder([{ secret_material: material, version: 'credential-v2', expires_at: new Date(Date.now() + 60_000) }])
    const resolved = await createSupabaseVaultSecretStore({ sql: reader }).resolve(`supabase-vault:${randomUUID()}`, { ...scope, destination: 'U1' })
    expect(reader.calls[0].role).toBe('zuri_channel_vault_reader')
    expect(resolved.material).toBe(material)
    expect(JSON.stringify(resolved)).not.toContain(material)
  })

  it('answers every refusal to resolve the same way, and never calls without a destination', async () => {
    const empty = recorder([])
    const store = createSupabaseVaultSecretStore({ sql: empty })
    await expect(store.resolve(`supabase-vault:${randomUUID()}`, { ...scope, destination: 'U1' })).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
    await expect(store.resolve(`supabase-vault:${randomUUID()}`, scope)).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
    await expect(store.resolve(`envelope:${randomUUID()}`, { ...scope, destination: 'U1' })).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
    expect(empty.calls).toHaveLength(1)
  })

  it('maps a raised database code and drops the rest of the message', async () => {
    const bundle = generateLineChannelBundle()
    const failing = { run: async () => { throw new Error(`P0001: CHANNEL_SECRET_SCOPE_MISMATCH near "${bundle.channelSecret}"`) } }
    const error = await createSupabaseVaultSecretStore({ sql: failing }).write({ ...scope, kind: 'LINE_CHANNEL', bundle, createdVia: 'BROWSER_MFA' }).catch(e => e)
    expect(error).toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH', status: 404 })
    expect(errorTrace(error)).not.toContain(bundle.channelSecret)
  })

  it('refuses a bundle before any database call', async () => {
    const sql = recorder([])
    await expect(createSupabaseVaultSecretStore({ sql }).write({ ...scope, kind: 'LINE_CHANNEL', bundle: { channelId: '1' }, createdVia: 'BROWSER_MFA' }))
      .rejects.toMatchObject({ code: 'CHANNEL_SECRET_BUNDLE_INVALID' })
    expect(sql.calls).toHaveLength(0)
  })
})

describe('role-scoped executors', () => {
  it('only ever set a role from the two vault roles, locally to one transaction', async () => {
    const statements = []
    const tx = { $executeRawUnsafe: async (text) => statements.push(text), $queryRawUnsafe: async (text, ...params) => { statements.push([text, params]); return [] } }
    const db = { $transaction: async (work) => work(tx) }
    await createPrismaRoleSql(db).run('zuri_channel_vault_reader', 'select 1 where $1 = $1', ['x'])
    expect(statements[0]).toBe('set local role zuri_channel_vault_reader')
    await expect(createPrismaRoleSql(db).run('postgres', 'select 1', [])).rejects.toMatchObject({ code: 'SECRET_STORE_CONFIGURATION_INVALID' })

    const queries = []
    const client = { query: async (text) => { queries.push(text); return { rows: [] } }, release: () => queries.push('release') }
    await createPgRoleSql({ connect: async () => client }).run('zuri_channel_vault_writer', 'select 1', [])
    expect(queries).toEqual(['begin', 'set local role zuri_channel_vault_writer', 'select 1', 'commit', 'release'])
  })
})
