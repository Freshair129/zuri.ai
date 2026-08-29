import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// @req FR-123 — the production migration that creates the plugin auth tables,
// and the lane rule that says where such a file belongs. Static contract test
// only: no Supabase CLI is available in this workspace to prove it live
// (RSK-016, Appendix E).
// @spec ADR-052, SEC-022
// @tested tests/unit/fr123-plugin-auth-migration.test.js

const MIGRATION_PATH = path.join(
  process.cwd(), 'supabase', 'migrations', '20260830120000_plugin_auth.sql',
)
const SQLITE_MIGRATION_PATH = path.join(
  process.cwd(), 'prisma', 'migrations', '20260830120000_add_plugin_auth', 'migration.sql',
)

const migrationSql = () => fs.readFileSync(MIGRATION_PATH, 'utf8')

// The executable half only. A guard that reads the prose reports the
// explanation of a hazard as the hazard — the same trap the FR-122 guard fell
// into on its first run.
const migrationStatements = () => migrationSql()
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

describe('FR-123 plugin auth Supabase migration', () => {
  it('creates the three tables idempotently and drops nothing', () => {
    const sql = migrationStatements()
    for (const table of ['PluginInstallation', 'PluginAuthorizationCode', 'PluginSession']) {
      expect(sql).toMatch(new RegExp(`create table if not exists "${table}"`, 'i'))
    }
    expect(sql).not.toMatch(/drop\s+(?:table|column|constraint|index|policy)/i)
  })

  // It is not established whether an earlier draft of this boundary reached the
  // live database, so every statement has to survive being run against a
  // database that already carries these tables.
  it('creates every index and the row policy conditionally', () => {
    const sql = migrationStatements()
    const bareIndexes = [...sql.matchAll(/create\s+index\s+(?!if\s+not\s+exists)/gi)]
    expect(bareIndexes, 'an unconditional CREATE INDEX fails on a re-run').toEqual([])
    expect(sql).toMatch(/from pg_policies/i)
  })

  // CREATE TABLE IF NOT EXISTS is silent about a table that exists with an
  // older shape, so the column the older draft lacked is added explicitly.
  it('adds the replay-revocation column explicitly, not only inline', () => {
    expect(migrationStatements()).toMatch(
      /alter table "PluginSession" add column if not exists "authorizationCodeId"/i,
    )
  })

  it('keeps credential tables off the Data API roles and under forced RLS', () => {
    const sql = migrationStatements()
    for (const table of ['PluginInstallation', 'PluginAuthorizationCode', 'PluginSession']) {
      expect(sql).toMatch(new RegExp(`alter table "${table}" enable row level security`, 'i'))
      expect(sql).toMatch(new RegExp(`alter table "${table}" force row level security`, 'i'))
      expect(sql).toMatch(new RegExp(`revoke all on table "${table}" from public, anon, authenticated, service_role`, 'i'))
    }
  })

  it('never writes the migration ledger from inside the file', () => {
    expect(migrationSql()).not.toMatch(/schema_migrations/i)
  })
})

describe('FR-123 dev/test migration stays in the SQLite lane', () => {
  // prisma/postgres/0001_init.sql is REGENERATED WHOLE by npm run db:pg:sql, so
  // production DDL never goes there. The rescued draft of this work carried a
  // hand-written prisma/postgres/0003_plugin_auth.sql; that lane closed, and
  // tests/unit/profile-identity-fields-migration.test.js enforces the closure.
  it('ships the dev/test DDL under prisma/migrations and nothing under prisma/postgres', () => {
    expect(fs.existsSync(SQLITE_MIGRATION_PATH)).toBe(true)
    expect(fs.existsSync(path.join(process.cwd(), 'prisma', 'postgres', '0003_plugin_auth.sql'))).toBe(false)
  })

  it('declares the same three tables in both lanes', () => {
    const sqlite = fs.readFileSync(SQLITE_MIGRATION_PATH, 'utf8')
    for (const table of ['PluginInstallation', 'PluginAuthorizationCode', 'PluginSession']) {
      expect(sqlite).toMatch(new RegExp(`create table "${table}"`, 'i'))
      expect(migrationStatements()).toMatch(new RegExp(`"${table}"`))
    }
  })

  // The FR-122 guard asserts this for `Person` and would not have noticed here:
  // `db:pg:sql` was run once, and a column was added to schema.prisma
  // afterwards. Every test runs against SQLite, so nothing else would ever read
  // the stale init — a rebuild from it would simply be missing the column.
  it('keeps the regenerated init in step with the plugin models it is generated from', () => {
    const init = fs.readFileSync(path.join(process.cwd(), 'prisma', 'postgres', '0001_init.sql'), 'utf8')
    for (const table of ['PluginInstallation', 'PluginAuthorizationCode', 'PluginSession']) {
      expect(init, `0001_init.sql is stale — run npm run db:pg:sql`).toContain(`CREATE TABLE "${table}"`)
    }
    const session = init.match(/CREATE TABLE "PluginSession" \(([\s\S]*?)\);/)
    expect(session, 'no PluginSession table in the regenerated init').not.toBeNull()
    expect(session[1], '0001_init.sql is stale — run npm run db:pg:sql').toContain('"authorizationCodeId" TEXT')
  })
})
