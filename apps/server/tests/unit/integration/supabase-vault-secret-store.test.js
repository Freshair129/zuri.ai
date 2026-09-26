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
import {
  errorTrace,
  generateLineChannelBundle,
  generateModelProviderKeyBundle,
  generateNotionOauthTokenBundle,
  generateOauthClientBundle,
} from '../../helpers/credential-vault-fixtures'

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

describe('OAUTH_CLIENT and MODEL_PROVIDER_KEY dispatch to the provider_secret_* functions', () => {
  it('writes OAUTH_CLIENT through provider_secret_write, never channel_secret_write', async () => {
    const bundle = generateOauthClientBundle()
    const sql = recorder([{ secret_ref: `supabase-vault:${randomUUID()}`, version_number: 1 }])
    const store = createSupabaseVaultSecretStore({ sql })
    const written = await store.write({ ...scope, kind: 'OAUTH_CLIENT', bundle, createdVia: 'BROWSER_MFA' })
    expect(written.versionNumber).toBe(1)
    const [call] = sql.calls
    expect(call.text).toBe(CHANNEL_SECRET_SQL.writeProvider)
    expect(call.text).not.toBe(CHANNEL_SECRET_SQL.write)
    expect(call.text).not.toContain(bundle.clientSecret)
    expect(JSON.parse(call.params[4])).toEqual(bundle)
    expect(call.params.slice(0, 4)).toEqual(['c1', 't1', 'b1', 'OAUTH_CLIENT'])
  })

  it('writes MODEL_PROVIDER_KEY through provider_secret_write', async () => {
    const bundle = generateModelProviderKeyBundle()
    const sql = recorder([{ secret_ref: `supabase-vault:${randomUUID()}`, version_number: 1 }])
    const store = createSupabaseVaultSecretStore({ sql })
    await store.write({ ...scope, kind: 'MODEL_PROVIDER_KEY', bundle, createdVia: 'OPERATOR_CLI' })
    expect(sql.calls[0].text).toBe(CHANNEL_SECRET_SQL.writeProvider)
    expect(JSON.parse(sql.calls[0].params[4])).toEqual(bundle)
  })

  it('resolves OAUTH_CLIENT and MODEL_PROVIDER_KEY through provider_secret_resolve, with kind as the last parameter and no destination', async () => {
    for (const kind of ['OAUTH_CLIENT', 'MODEL_PROVIDER_KEY']) {
      const material = kind === 'OAUTH_CLIENT' ? JSON.stringify(generateOauthClientBundle()) : JSON.stringify(generateModelProviderKeyBundle())
      const reader = recorder([{ secret_material: material, version: 'credential-v1', expires_at: new Date(Date.now() + 60_000) }])
      const resolved = await createSupabaseVaultSecretStore({ sql: reader }).resolve(`supabase-vault:${randomUUID()}`, { ...scope, kind })
      expect(reader.calls[0].role).toBe('zuri_channel_vault_reader')
      expect(reader.calls[0].text).toBe(CHANNEL_SECRET_SQL.resolveProvider)
      expect(reader.calls[0].params.at(-1)).toBe(kind)
      expect(resolved.material).toBe(material)
    }
  })

  it('never resolves without a recognized kind, and never falls through to the LINE function', async () => {
    const empty = recorder([])
    const store = createSupabaseVaultSecretStore({ sql: empty })
    await expect(store.resolve(`supabase-vault:${randomUUID()}`, { ...scope, kind: 'NOT_A_KIND' })).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
    expect(empty.calls).toHaveLength(0)
  })

  it('a LINE-shaped write default (no kind override in scope) still calls channel_secret_write unchanged', async () => {
    const bundle = generateLineChannelBundle()
    const sql = recorder([{ secret_ref: `supabase-vault:${randomUUID()}`, version_number: 1 }])
    await createSupabaseVaultSecretStore({ sql }).write({ ...scope, kind: 'LINE_CHANNEL', bundle, createdVia: 'BROWSER_MFA' })
    expect(sql.calls[0].text).toBe(CHANNEL_SECRET_SQL.write)
  })

  // Regression: provider_secret_write's own kind-mismatch guard (a connectionId
  // already holding a different-kind credential) raises CREDENTIAL_KIND_MISMATCH
  // from the database; the adapter must surface it as a 409, not fall through to
  // the generic 503 CHANNEL_SECRET_STORE_UNAVAILABLE the way an unrecognized code
  // would.
  it('maps provider_secret_write\'s CREDENTIAL_KIND_MISMATCH to a 409, for both new kinds', async () => {
    for (const [kind, bundle] of [['OAUTH_CLIENT', generateOauthClientBundle()], ['MODEL_PROVIDER_KEY', generateModelProviderKeyBundle()]]) {
      const failing = { run: async () => { throw new Error('P0001: CREDENTIAL_KIND_MISMATCH') } }
      const error = await createSupabaseVaultSecretStore({ sql: failing }).write({ ...scope, kind, bundle, createdVia: 'BROWSER_MFA' }).catch(e => e)
      expect(error).toMatchObject({ code: 'CREDENTIAL_KIND_MISMATCH', status: 409 })
    }
  })
})

describe('NOTION_OAUTH_TOKEN uses dedicated Vault functions', () => {
  it('writes and resolves through notion_secret_* without passing a kind the function can widen', async () => {
    const bundle = generateNotionOauthTokenBundle()
    const writer = recorder([{ secret_ref: `supabase-vault:${randomUUID()}`, version_number: 1 }])
    const store = createSupabaseVaultSecretStore({ sql: writer })
    await store.write({ ...scope, kind: 'NOTION_OAUTH_TOKEN', bundle, createdVia: 'BROWSER_MFA', actorPersonId: 'p1' })
    expect(writer.calls[0].text).toBe(CHANNEL_SECRET_SQL.writeNotion)
    expect(writer.calls[0].params).toEqual(['c1', 't1', 'b1', JSON.stringify(bundle), null, 'p1', 'BROWSER_MFA'])
    expect(writer.calls[0].text).not.toContain(bundle.accessToken)

    const material = JSON.stringify(bundle)
    const reader = recorder([{ secret_material: material, version: 'credential-v1', expires_at: new Date(Date.now() + 60_000) }])
    const resolved = await createSupabaseVaultSecretStore({ sql: reader }).resolve(`supabase-vault:${randomUUID()}`, { ...scope, kind: 'NOTION_OAUTH_TOKEN' })
    expect(reader.calls[0].text).toBe(CHANNEL_SECRET_SQL.resolveNotion)
    expect(reader.calls[0].params).toEqual([expect.any(String), 't1', 'b1', 'c1'])
    expect(resolved.material).toBe(material)
  })

  it('maps the dedicated write function cross-kind refusal to a 409', async () => {
    const failing = { run: async () => { throw new Error('P0001: CREDENTIAL_KIND_MISMATCH') } }
    const error = await createSupabaseVaultSecretStore({ sql: failing }).write({
      ...scope, kind: 'NOTION_OAUTH_TOKEN', bundle: generateNotionOauthTokenBundle(), createdVia: 'BROWSER_MFA',
    }).catch(e => e)
    expect(error).toMatchObject({ code: 'CREDENTIAL_KIND_MISMATCH', status: 409 })
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
