// @req FR-223 — the credential vault on PostgreSQL: design migrations 1, 3 and 4
//   applied over the pre-vault schema with their backfill, the Supabase Vault
//   definer functions exercised through their NOLOGIN roles, the envelope store
//   through the Postgres Prisma client, and the same leak scan as SQLite.
// @req FR-226 — migration 2's backfill and live-only uniqueness, and the connection
//   flow refusing another Tenant's bot. @req FR-224 — migration 8, the write gate
//   and the limiter under concurrency.
// @spec ADR-089 D1, D2, D5 and proofs 1-3; SDD-097; SEC-030; ADR-057
// @tested tests/integration/credential-vault.postgres.test.js
//
// Supabase Vault is not available in a plain PostgreSQL cluster, so `vault` is
// emulated with the same object names and signatures (vault.secrets,
// vault.decrypted_secrets, vault.create_secret). The emulation stores plaintext;
// what this suite proves is the part this repository owns — scope checks, grants,
// roles, lifecycle and purge — not Supabase's encryption. The emulated table is
// the one place the leak scan does not look.
import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaClient as PostgresPrismaClient } from '@zuri/prisma-postgres'
import { createPgRoleSql, createSupabaseVaultSecretStore } from '@/platform/integrations/core/secret-store/supabase-vault-secret-store'
import { createEnvelopeSecretStore } from '@/platform/integrations/core/secret-store/envelope-secret-store'
import { createDispatchingSecretManager } from '@/platform/integrations/core/secret-store/dispatching-secret-manager'
import { storeValidatedCredential } from '@/platform/integrations/core/secret-store/credential-lifecycle'
import { connectLineChannelWithSecret } from '@/modules/integration/application/line-channel-connection-service'
import { makeViewer } from '../factories/viewer'
import { assertCredentialWriteAssurance } from '@/modules/identity/credential-write-gate'
import { consumeRateLimit } from '@/modules/identity/rate-limit'
import { errorTrace, findLeaks, generateLineChannelBundle, secretNeedles } from '../helpers/credential-vault-fixtures'
import { parseVaultPostgresTarget } from '../helpers/credential-vault-postgres-target'

const target = parseVaultPostgresTarget({
  databaseUrl: process.env.ZURI_VAULT_TEST_POSTGRES_URL,
  optIn: process.env.ZURI_VAULT_TEST_DESTRUCTIVE_OPT_IN,
})
const runPostgres = target.enabled ? describe : describe.skip
const LOGIN = 'zuri_web_login'
const loginPassword = randomBytes(24).toString('base64url')
const bundles = []
const bundle = (options) => { const b = generateLineChannelBundle(options); bundles.push(b); return b }

function migrationSql(suffix) {
  const directory = path.join(process.cwd(), 'supabase', 'migrations')
  const matches = fs.readdirSync(directory).filter(name => name.endsWith(suffix))
  if (matches.length !== 1) throw new Error(`EXPECTED_ONE_MIGRATION:${suffix}`)
  return fs.readFileSync(path.join(directory, matches[0]), 'utf8')
}

function schemaSql() {
  return execFileSync(process.execPath, [
    path.join(process.cwd(), 'node_modules', 'prisma', 'build', 'index.js'),
    'migrate', 'diff', '--from-empty', '--to-schema-datamodel', 'prisma/schema.postgres.prisma', '--script',
  ], { cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

const VAULT_EMULATION = `
  create schema vault;
  create table vault.secrets (
    id uuid primary key default gen_random_uuid(),
    name text unique,
    description text not null default '',
    secret text not null,
    created_at timestamptz not null default now()
  );
  create view vault.decrypted_secrets as
    select id, name, description, secret as decrypted_secret, created_at from vault.secrets;
  create function vault.create_secret(new_secret text, new_name text default null, new_description text default '', new_key_id uuid default null)
  returns uuid language sql as $$
    insert into vault.secrets (secret, name, description) values (new_secret, new_name, coalesce(new_description, '')) returning id
  $$;
  revoke all on schema vault from public;
  revoke all on all tables in schema vault from public;
  revoke all on function vault.create_secret(text, text, text, uuid) from public;
`

runPostgres('credential vault on PostgreSQL', () => {
  let admin
  let loginPool
  let adminPool
  let pgPrisma
  let vaultStore
  let envelopeStore
  const ids = {}

  const q = (text, params) => admin.query(text, params)
  const one = async (text, params) => (await q(text, params)).rows[0]
  const credential = async connectionId => one('select * from "IntegrationCredential" where "connectionId" = $1', [connectionId])
  const versions = async connectionId => (await q(`select v."versionNumber", v.status, v."createdVia", v.reason, v."secretRef"
    from "IntegrationCredentialVersion" v join "IntegrationCredential" c on c.id = v."credentialId"
    where c."connectionId" = $1 order by v."versionNumber"`, [connectionId])).rows
  const vaultRowsFor = async connectionId => Number((await one(`select count(*) from vault.secrets where name like $1`, [`zuri:%:${connectionId}:v%`])).count)

  async function connection(businessKey, { destination = `U${randomBytes(16).toString('hex')}`, providerId = ids.lineProvider, purpose = 'GENERAL' } = {}) {
    const id = randomUUID()
    const businessId = ids[businessKey]
    const tenantId = ids[`${businessKey}Tenant`]
    await q(`insert into "IntegrationConnection" (id, "tenantId", "businessId", "providerId", name, "externalAccountId", purpose, status, "updatedAt")
      values ($1, $2, $3, $4, $5, $6, $7, 'ACTIVE', now())`, [id, tenantId, businessId, providerId, `conn-${id.slice(0, 6)}`, destination, purpose])
    return { id, destination, scope: { tenantId, businessId, connectionId: id } }
  }

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: target.databaseUrl })
    await admin.connect()
    await q('drop schema if exists vault cascade')
    await q('drop schema if exists zuri_core cascade')
    await q('drop schema if exists public cascade')
    await q('create schema public')
    for (const role of ['zuri_app_runtime', 'anon', 'authenticated', 'service_role']) {
      await q(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$`)
    }
    await q(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${LOGIN}') then create role ${LOGIN} login; end if; end $$`)
    await q(`alter role ${LOGIN} login password '${loginPassword}'`)

    // The schema as it was before the vault: today's DDL minus what migrations 1 and 4 add.
    await q(schemaSql())
    await q('drop table "IntegrationCredentialVersion"')
    await q('drop table "IntegrationSecretEnvelope"')
    await q('drop table "ChannelAccountClaim"')
    await q('drop table "RateLimitBucket"')
    for (const column of ['secretStore', 'secretKind', 'displayHint', 'lastValidatedAt', 'lastValidationCode', 'revokedAt', 'revokeReason']) {
      await q(`alter table "IntegrationCredential" drop column "${column}"`)
    }

    ids.portfolio = randomUUID()
    await q(`insert into "Portfolio" (id, code, name, "updatedAt") values ($1, 'PF-PGV', 'PG vault', now())`, [ids.portfolio])
    for (const key of ['business', 'other']) {
      ids[`${key}Tenant`] = randomUUID()
      ids[key] = randomUUID()
      await q(`insert into "Tenant" (id, code, "portfolioId", name, "updatedAt") values ($1, $2, $3, $2, now())`, [ids[`${key}Tenant`], `TNT-PGV-${key}`, ids.portfolio])
      await q(`insert into "Business" (id, code, "tenantId", name, "updatedAt") values ($1, $2, $3, $2, now())`, [ids[key], `BUS-PGV-${key}`, ids[`${key}Tenant`]])
    }
    ids.lineProvider = randomUUID()
    ids.modelProvider = randomUUID()
    await q(`insert into "IntegrationProvider" (id, code, name, "updatedAt") values ($1, 'LINE_OA', 'LINE Official Account', now()), ($2, 'openai', 'OpenAI', now())`, [ids.lineProvider, ids.modelProvider])

    // Credentials that exist before the vault: a mounted LINE channel and a Phase-1 model key.
    ids.mounted = await connection('business')
    await q(`insert into "IntegrationCredential" (id, "connectionId", "secretRef", status, "updatedAt") values ($1, $2, 'deployment-secret:legacy', 'ACTIVE', now())`, [randomUUID(), ids.mounted.id])
    ids.model = await connection('business', { providerId: ids.modelProvider, purpose: 'PHASE1_LINE_LLM', destination: null })
    await q(`insert into "IntegrationCredential" (id, "connectionId", "secretRef", status, "updatedAt") values ($1, $2, $3, 'ACTIVE', now())`, [randomUUID(), ids.model.id, `supabase-vault:${randomUUID()}`])

    // One bot connected by two Tenants before claims existed: the ACTIVE, then oldest, wins.
    ids.sharedDestination = `U${randomBytes(16).toString('hex')}`
    ids.sharedOlder = await connection('other', { destination: ids.sharedDestination })
    await q(`update "IntegrationConnection" set "createdAt" = now() - interval '1 day', status = 'DISABLED' where id = $1`, [ids.sharedOlder.id])
    ids.sharedActive = await connection('business', { destination: ids.sharedDestination })

    for (let run = 0; run < 2; run += 1) {
      await q(migrationSql('_integration_credential_lifecycle.sql'))
      await q(migrationSql('_channel_account_claim.sql'))
      await q(migrationSql('_integration_secret_envelope.sql'))
      await q(migrationSql('_rate_limit_bucket.sql'))
    }

    await q('create schema zuri_core')
    await q(VAULT_EMULATION)
    for (let run = 0; run < 2; run += 1) await q(migrationSql('_channel_secret_vault_functions.sql'))

    const loginUrl = new URL(target.databaseUrl)
    loginUrl.username = LOGIN
    loginUrl.password = loginPassword
    loginPool = new pg.Pool({ connectionString: loginUrl.toString(), max: 2 })
    adminPool = new pg.Pool({ connectionString: target.databaseUrl, max: 2 })
    vaultStore = createSupabaseVaultSecretStore({ sql: createPgRoleSql(loginPool) })
    pgPrisma = new PostgresPrismaClient({ datasources: { db: { url: target.databaseUrl } } })
    envelopeStore = createEnvelopeSecretStore({
      db: pgPrisma,
      env: { NODE_ENV: 'test', ZURI_SECRET_KEK: randomBytes(32).toString('hex'), ZURI_SECRET_KEK_VERSION: '1' },
    })
  }, 120_000)

  afterAll(async () => {
    await loginPool?.end()
    await adminPool?.end()
    await pgPrisma?.$disconnect()
    await admin?.end()
  })

  describe('migrations 1 and 4 over the pre-vault schema', () => {
    it('backfill store, kind and one version per existing credential, idempotently, without changing what resolves', async () => {
      expect(await credential(ids.mounted.id)).toMatchObject({ secretStore: 'DEPLOYMENT_MOUNT', secretKind: 'LINE_CHANNEL', status: 'ACTIVE', secretRef: 'deployment-secret:legacy' })
      expect(await credential(ids.model.id)).toMatchObject({ secretStore: 'SUPABASE_VAULT', secretKind: 'MODEL_PROVIDER_KEY', status: 'ACTIVE' })
      expect((await versions(ids.mounted.id)).map(v => [v.versionNumber, v.status, v.createdVia])).toEqual([[1, 'ACTIVE', 'BACKFILL']])
      expect(Number((await one('select count(*) from "IntegrationCredentialVersion"')).count)).toBe(2)
    })

    it('leave the tables private: forced RLS, one runtime policy, no Data API grant', async () => {
      for (const table of ['IntegrationCredentialVersion', 'IntegrationSecretEnvelope']) {
        const row = await one(`select c.relrowsecurity, c.relforcerowsecurity, (select count(*) from pg_policies p where p.tablename = c.relname)::int as policies
          from pg_class c where c.relname = $1`, [table])
        expect(row).toEqual({ relrowsecurity: true, relforcerowsecurity: true, policies: 1 })
        for (const role of ['anon', 'authenticated', 'service_role']) {
          expect((await one(`select has_table_privilege($1, $2, 'select') as allowed`, [role, `public."${table}"`])).allowed).toBe(false)
        }
      }
    })

    it('produce exactly the columns the Prisma schema declares for the vault tables', async () => {
      const columns = async table => (await q(`select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by column_name`, [table])).rows.map(r => r.column_name)
      expect(await columns('IntegrationCredentialVersion')).toEqual(['activatedAt', 'createdAt', 'createdById', 'createdVia', 'credentialId', 'displayHint', 'id', 'purgedAt', 'reason', 'revokedAt', 'secretRef', 'secretStore', 'status', 'supersededAt', 'tenantId', 'businessId', 'versionNumber'].sort())
      expect(await columns('IntegrationSecretEnvelope')).toEqual(['aadVersion', 'businessId', 'ciphertext', 'connectionId', 'createdAt', 'expiresAt', 'id', 'iv', 'kekId', 'tag', 'tenantId', 'wrappedDek'].sort())
      expect(await columns('IntegrationCredential')).toEqual(expect.arrayContaining(['secretStore', 'secretKind', 'displayHint', 'lastValidatedAt', 'lastValidationCode', 'revokedAt', 'revokeReason']))
    })
  })

  describe('migration 2 — channel account claims', () => {
    it('backfills one claim per destination by hash, preferring the ACTIVE connection, idempotently', async () => {
      const claims = (await q('select * from "ChannelAccountClaim" order by "claimedAt"')).rows
      expect(claims.map(c => c.connectionId).sort()).toEqual([ids.mounted.id, ids.sharedActive.id].sort())
      const shared = claims.find(c => c.connectionId === ids.sharedActive.id)
      expect(shared.externalAccountHash).toBe((await one(`select encode(sha256(convert_to($1, 'UTF8')), 'hex') as h`, [ids.sharedDestination])).h)
      expect(JSON.stringify(claims)).not.toContain(ids.sharedDestination)
    })

    it('holds a bot unique among live claims only, so a released claim frees it', async () => {
      const shared = await one('select * from "ChannelAccountClaim" where "connectionId" = $1', [ids.sharedActive.id])
      const insert = connectionId => q(`insert into "ChannelAccountClaim" (id, provider, "externalAccountHash", "tenantId", "businessId", "connectionId")
        values ($1, 'LINE_OA', $2, $3, $4, $5)`, [randomUUID(), shared.externalAccountHash, ids.otherTenant, ids.other, connectionId])
      expect((await insert(ids.sharedOlder.id).catch(e => e)).code).toBe('23505')
      await q('update "ChannelAccountClaim" set "releasedAt" = now() where id = $1', [shared.id])
      await insert(ids.sharedOlder.id)
      expect(Number((await one('select count(*) from "ChannelAccountClaim" where "externalAccountHash" = $1 and "releasedAt" is null', [shared.externalAccountHash])).count)).toBe(1)
    })
  })

  describe('migration 3 — the Vault functions and their roles', () => {
    it('are SECURITY DEFINER with a pinned search_path, executable only through the two NOLOGIN roles', async () => {
      const functions = (await q(`select p.proname, p.prosecdef, p.proconfig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'zuri_core' and p.proname like 'channel_secret_%' order by p.proname`)).rows
      expect(functions.map(f => f.proname)).toEqual(['channel_secret_activate', 'channel_secret_purge_version', 'channel_secret_resolve', 'channel_secret_revoke', 'channel_secret_write'])
      for (const fn of functions) {
        expect(fn.prosecdef).toBe(true)
        expect(fn.proconfig).toEqual(['search_path=pg_catalog, pg_temp'])
      }
      const roles = (await q(`select rolname, rolcanlogin, rolinherit, rolbypassrls from pg_roles where rolname like 'zuri_channel_vault_%' order by rolname`)).rows
      expect(roles).toEqual([
        { rolname: 'zuri_channel_vault_reader', rolcanlogin: false, rolinherit: false, rolbypassrls: false },
        { rolname: 'zuri_channel_vault_writer', rolcanlogin: false, rolinherit: false, rolbypassrls: false },
      ])
      const can = async (role, signature) => (await one(`select has_function_privilege($1, $2, 'execute') as allowed`, [role, signature])).allowed
      const write = 'zuri_core.channel_secret_write(text, text, text, text, jsonb, timestamptz, text, text)'
      const resolve = 'zuri_core.channel_secret_resolve(text, text, text, text, text)'
      const purge = 'zuri_core.channel_secret_purge_version(text, text)'
      expect(await can('zuri_channel_vault_writer', write)).toBe(true)
      expect(await can('zuri_channel_vault_reader', write)).toBe(false)
      expect(await can('zuri_channel_vault_reader', resolve)).toBe(true)
      expect(await can('zuri_channel_vault_writer', resolve)).toBe(false)
      for (const role of ['anon', 'authenticated', 'service_role', 'zuri_app_runtime']) {
        for (const signature of [write, resolve, purge]) expect(await can(role, signature)).toBe(false)
      }
      for (const role of ['zuri_channel_vault_writer', 'zuri_channel_vault_reader', LOGIN]) {
        expect((await one(`select has_schema_privilege($1, 'vault', 'usage') as allowed`, [role])).allowed).toBe(false)
      }
    })

    it('refuse the login outside its roles, and each role outside its functions', async () => {
      const client = await loginPool.connect()
      try {
        const denied = async (text) => expect((await client.query(text).catch(e => e)).code).toBe('42501')
        await denied(`select * from zuri_core.channel_secret_resolve('supabase-vault:${randomUUID()}', 'a', 'b', 'c', 'd')`)
        await client.query('begin')
        await client.query('set local role zuri_channel_vault_reader')
        await denied(`select * from zuri_core.channel_secret_revoke('c', 't', 'b', 'x', null)`)
        await client.query('rollback')
        await client.query('begin')
        await client.query('set local role zuri_channel_vault_writer')
        await denied('select * from vault.decrypted_secrets')
        await client.query('rollback')
      } finally {
        client.release()
      }
    })
  })

  describe('the Supabase Vault store', () => {
    it('writes PENDING_VALIDATION, activates, rotates keeping the old version live, and purges the superseded one', async () => {
      const conn = await connection('business')
      const first = bundle({ withToken: true })
      const v1 = await vaultStore.write({ ...conn.scope, kind: 'LINE_CHANNEL', bundle: first, createdVia: 'BROWSER_MFA', actorPersonId: 'person-1' })
      expect(await credential(conn.id)).toMatchObject({ status: 'PENDING_VALIDATION', secretStore: 'SUPABASE_VAULT', displayHint: first.channelId.slice(-4) })
      await expect(vaultStore.resolve(v1.secretRef, { ...conn.scope, destination: conn.destination })).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })

      await vaultStore.activate({ ...conn.scope, versionNumber: 1, validationCode: 'LINE_OK' })
      expect(JSON.parse((await vaultStore.resolve(v1.secretRef, { ...conn.scope, destination: conn.destination })).material)).toEqual(first)

      const second = bundle({ withToken: true })
      const v2 = await vaultStore.write({ ...conn.scope, kind: 'LINE_CHANNEL', bundle: second, createdVia: 'BROWSER_MFA' })
      expect(await credential(conn.id)).toMatchObject({ status: 'ROTATING', secretRef: v1.secretRef, version: 2 })
      expect(JSON.parse((await vaultStore.resolve(v1.secretRef, { ...conn.scope, destination: conn.destination })).material)).toEqual(first)

      expect(await vaultStore.activate({ ...conn.scope, versionNumber: 2, validationCode: 'LINE_OK' })).toMatchObject({ supersededCount: 1, purgeFailedCount: 0 })
      expect((await versions(conn.id)).map(v => [v.versionNumber, v.status])).toEqual([[1, 'PURGED'], [2, 'ACTIVE']])
      expect(await vaultRowsFor(conn.id)).toBe(1)
      await expect(vaultStore.resolve(v1.secretRef, { ...conn.scope, destination: conn.destination })).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
      const resolved = await vaultStore.resolve(v2.secretRef, { ...conn.scope, destination: conn.destination })
      expect(JSON.parse(resolved.material)).toEqual(second)
      expect(resolved.version).toBe('credential-v2')
      expect(resolved.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000 + 1000)

      const v3 = await vaultStore.write({ ...conn.scope, kind: 'LINE_CHANNEL', bundle: bundle(), createdVia: 'BROWSER_MFA' })
      expect(await vaultStore.revoke({ ...conn.scope, reason: 'LINE_CREDENTIALS_REJECTED', versionNumber: v3.versionNumber })).toMatchObject({ credentialStatus: 'ACTIVE', purgedCount: 1 })
      expect(await vaultRowsFor(conn.id)).toBe(1)
      await expect(vaultStore.activate({ ...conn.scope, versionNumber: 3, validationCode: 'LINE_OK' })).rejects.toMatchObject({ code: 'CREDENTIAL_VERSION_CONFLICT' })
    })

    it('refuses another Tenant or Business from the database, and a write refused leaves no vault row (proof 2)', async () => {
      const conn = await connection('business')
      const before = Number((await one('select count(*) from vault.secrets')).count)
      for (const foreign of [
        { ...conn.scope, tenantId: ids.otherTenant },
        { ...conn.scope, businessId: ids.other },
      ]) {
        await expect(vaultStore.write({ ...foreign, kind: 'LINE_CHANNEL', bundle: bundle(), createdVia: 'BROWSER_MFA' })).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
      }
      expect(Number((await one('select count(*) from vault.secrets')).count)).toBe(before)

      // Straight at the function, as the writer role, bypassing the adapter.
      const client = await loginPool.connect()
      try {
        await client.query('begin')
        await client.query('set local role zuri_channel_vault_writer')
        const error = await client.query(
          'select * from zuri_core.channel_secret_write($1, $2, $3, $4, $5::jsonb, null, null, $6)',
          [conn.id, ids.otherTenant, ids.other, 'LINE_CHANNEL', JSON.stringify(bundle()), 'BROWSER_MFA'],
        ).catch(e => e)
        expect(error.message).toBe('CHANNEL_SECRET_SCOPE_MISMATCH')
        await client.query('rollback')
      } finally {
        client.release()
      }
    })

    it('does not open a vault row through another connection whose metadata was pointed at it', async () => {
      const victim = await connection('business')
      const attacker = await connection('business')
      const victimRef = (await storeValidatedCredential({ store: vaultStore, ...victim.scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), validationCode: 'LINE_OK' })).secretRef
      await storeValidatedCredential({ store: vaultStore, ...attacker.scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), validationCode: 'LINE_OK' })
      await q('update "IntegrationCredential" set "secretRef" = $1 where "connectionId" = $2', [victimRef, attacker.id])
      await q(`update "IntegrationCredentialVersion" set "secretRef" = $1 where "credentialId" = (select id from "IntegrationCredential" where "connectionId" = $2) and status = 'ACTIVE'`, [victimRef, attacker.id])
      await expect(vaultStore.resolve(victimRef, { ...attacker.scope, destination: attacker.destination })).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
    })

    it('revocation purges every version, and a mount-backed credential moves into the vault on re-entry', async () => {
      const conn = await connection('business')
      const v1 = await storeValidatedCredential({ store: vaultStore, ...conn.scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), validationCode: 'LINE_OK' })
      await vaultStore.write({ ...conn.scope, kind: 'LINE_CHANNEL', bundle: bundle(), createdVia: 'BROWSER_MFA' })
      expect(await vaultStore.revoke({ ...conn.scope, reason: 'owner revoked' })).toMatchObject({ credentialStatus: 'REVOKED', revokedCount: 2, purgedCount: 2, purgeFailedCount: 0 })
      expect(await vaultRowsFor(conn.id)).toBe(0)
      expect(await credential(conn.id)).toMatchObject({ status: 'REVOKED', revokeReason: 'owner revoked' })
      await expect(vaultStore.resolve(v1.secretRef, { ...conn.scope, destination: conn.destination })).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })

      const moved = await storeValidatedCredential({ store: vaultStore, ...ids.mounted.scope, kind: 'LINE_CHANNEL', bundle: bundle({ withToken: true }), validationCode: 'LINE_OK' })
      expect(await credential(ids.mounted.id)).toMatchObject({ status: 'ACTIVE', secretStore: 'SUPABASE_VAULT', secretRef: moved.secretRef })
      expect((await versions(ids.mounted.id)).map(v => [v.versionNumber, v.status, v.reason])).toEqual([
        [1, 'SUPERSEDED', 'MATERIAL_OUTSIDE_THIS_STORE'],
        [2, 'ACTIVE', null],
      ])
    })

    it('an installation on the Vault refuses an envelope reference without asking the Vault (proof 3)', async () => {
      const manager = createDispatchingSecretManager({ writableStore: vaultStore })
      await expect(manager.resolve(`envelope:${randomUUID()}`, { tenantId: 't', businessId: 'b', connectionId: 'c', destination: 'U' })).rejects.toMatchObject({ code: 'Unavailable' })
    })
  })

  describe('the envelope store on PostgreSQL', () => {
    it('runs the same lifecycle through the Postgres Prisma client', async () => {
      const conn = await connection('business')
      const first = bundle({ withToken: true })
      const v1 = await storeValidatedCredential({ store: envelopeStore, ...conn.scope, kind: 'LINE_CHANNEL', bundle: first, validationCode: 'LINE_OK' })
      const second = bundle({ withToken: true })
      const v2 = await envelopeStore.write({ ...conn.scope, kind: 'LINE_CHANNEL', bundle: second, createdVia: 'BROWSER_MFA' })
      expect(JSON.parse((await envelopeStore.resolve(v1.secretRef, { ...conn.scope, destination: conn.destination })).material)).toEqual(first)
      await envelopeStore.activate({ ...conn.scope, versionNumber: v2.versionNumber, validationCode: 'LINE_OK' })
      expect(JSON.parse((await envelopeStore.resolve(v2.secretRef, { ...conn.scope, destination: conn.destination })).material)).toEqual(second)
      expect(Number((await one('select count(*) from "IntegrationSecretEnvelope" where "connectionId" = $1', [conn.id])).count)).toBe(1)
      await expect(envelopeStore.write({ ...conn.scope, businessId: ids.other, kind: 'LINE_CHANNEL', bundle: bundle(), createdVia: 'BROWSER_MFA' })).rejects.toMatchObject({ code: 'CHANNEL_SECRET_SCOPE_MISMATCH' })
      expect(await envelopeStore.revoke({ ...conn.scope, reason: 'owner revoked' })).toMatchObject({ purgedCount: 1, purgeFailedCount: 0 })
      expect(Number((await one('select count(*) from "IntegrationSecretEnvelope" where "connectionId" = $1', [conn.id])).count)).toBe(0)
    })
  })

  describe('migration 8 and the write gate on PostgreSQL (proof 4)', () => {
    it('refuses no factor, AAL1 and an expired elevation, and admits a live step-up', async () => {
      const personId = randomUUID()
      await q(`insert into "Person" (id, code, "displayName", "updatedAt") values ($1, $2, 'PG gate', now())`, [personId, `PER-PG-${personId.slice(0, 6)}`])
      const gateViewer = makeViewer({ principal: { id: personId, code: 'PER-PG', displayName: 'PG gate' }, visibleBusinessIds: [ids.business], ownedBusinessIds: [ids.business], visibleDomains: ['line-oa'] })
      const session = (elevatedFor, assuranceLevel = 'AAL2') => ({ id: randomUUID(), personId, status: 'ACTIVE', assuranceLevel, expiresAt: new Date(Date.now() + 3600_000), elevatedUntil: elevatedFor === null ? null : new Date(Date.now() + elevatedFor * 1000) })
      await expect(assertCredentialWriteAssurance({ viewer: gateViewer, session: session(900), db: pgPrisma })).rejects.toMatchObject({ status: 403, message: 'MFA_FACTOR_REQUIRED' })
      await pgPrisma.mfaFactor.create({ data: { personId, type: 'TOTP', secret: 'mfa.v0.placeholder.placeholder.placeholder', status: 'ACTIVE' } })
      await expect(assertCredentialWriteAssurance({ viewer: gateViewer, session: session(null, 'AAL1'), db: pgPrisma })).rejects.toMatchObject({ message: 'ASSURANCE_LEVEL_INSUFFICIENT' })
      await expect(assertCredentialWriteAssurance({ viewer: gateViewer, session: session(-1), db: pgPrisma })).rejects.toMatchObject({ message: 'ASSURANCE_LEVEL_INSUFFICIENT' })
      await expect(assertCredentialWriteAssurance({ viewer: gateViewer, session: session(900), db: pgPrisma })).resolves.toMatchObject({ personId })
    })

    it('never admits more than the limit under concurrent requests, and says when to retry', async () => {
      const key = `pg-test:${randomUUID()}`
      const results = await Promise.allSettled(Array.from({ length: 12 }, () => consumeRateLimit({ key, limit: 5, windowSeconds: 900, db: pgPrisma })))
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5)
      const refusals = results.filter(r => r.status === 'rejected').map(r => r.reason)
      expect(refusals.every(e => e.status === 429 && e.retryAfterSeconds > 0)).toBe(true)
      expect((await one('select count from "RateLimitBucket" where key = $1', [key])).count).toBe(5)
      const row = await one(`select c.relforcerowsecurity from pg_class c where c.relname = 'RateLimitBucket'`)
      expect(row.relforcerowsecurity).toBe(true)
    })
  })

  describe('the connection flow on PostgreSQL (proofs 5 and 6)', () => {
    it('connects through the Vault store, then refuses the same bot from another Tenant and stores nothing', async () => {
      const pair = bundle()
      const destination = `U${randomBytes(16).toString('hex')}`
      const lineAdmin = {
        validateChannel: async ({ channelId, channelSecret }) => {
          if (channelId !== pair.channelId || channelSecret !== pair.channelSecret) throw Object.assign(new Error('LINE_CREDENTIALS_REJECTED'), { code: 'LINE_CREDENTIALS_REJECTED', status: 422 })
          return { destination, validationCode: 'LINE_OK', bot: { basicId: '@pg', displayName: 'PG', pictureUrl: null, chatMode: 'bot', markAsReadMode: 'auto' } }
        },
      }
      const ports = { store: vaultStore, lineAdmin, tokenCache: { invalidate() {} } }
      const owner = makeViewer({ visibleBusinessIds: [ids.business], ownedBusinessIds: [ids.business], visibleDomains: ['line-oa'] })
      const other = makeViewer({ visibleBusinessIds: [ids.other], ownedBusinessIds: [ids.other], visibleDomains: ['line-oa'] })
      const connected = await connectLineChannelWithSecret({ businessId: ids.business, name: 'PG main', ...pair }, { viewer: owner, db: pgPrisma, ports })
      expect(connected.credential).toMatchObject({ status: 'ACTIVE', secretStore: 'SUPABASE_VAULT' })
      const count = async () => Number((await one('select (select count(*) from vault.secrets) + (select count(*) from "IntegrationConnection") + (select count(*) from "ChannelAccountClaim") as n')).n)
      const before = await count()
      const wrong = await connectLineChannelWithSecret({ businessId: ids.other, name: 'Guess', ...pair, channelSecret: generateLineChannelBundle().channelSecret }, { viewer: other, db: pgPrisma, ports }).catch(e => e)
      expect(wrong.message).toBe('LINE_CREDENTIALS_REJECTED')
      const elsewhere = await connectLineChannelWithSecret({ businessId: ids.other, name: 'Takeover', ...pair }, { viewer: other, db: pgPrisma, ports }).catch(e => e)
      expect(elsewhere).toMatchObject({ status: 409, message: 'LINE_CHANNEL_CLAIMED_ELSEWHERE' })
      expect(JSON.stringify(elsewhere.details)).not.toContain(ids.business)
      expect(await count()).toBe(before)
    })
  })

  it('leaves no material in any public table or any error (proof 1)', async () => {
    const needles = [...new Set(bundles.flatMap(secretNeedles))]
    expect(needles.length).toBeGreaterThan(0)
    const tables = (await q(`select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE'`)).rows.map(r => r.table_name)
    const haystacks = {}
    for (const table of tables) {
      haystacks[table] = (await q(`select coalesce(json_agg(t)::text, '[]') as rows from public."${table}" t`)).rows[0].rows
    }
    expect(findLeaks(haystacks, needles)).toEqual([])
    const refusal = await vaultStore.write({ tenantId: ids.otherTenant, businessId: ids.other, connectionId: ids.mounted.id, kind: 'LINE_CHANNEL', bundle: bundles[0], createdVia: 'BROWSER_MFA' }).catch(e => e)
    expect(findLeaks({ refusal: errorTrace(refusal) }, needles)).toEqual([])
  })
})
