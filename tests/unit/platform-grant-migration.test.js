import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// @req FR-107 — the production migration keeps the operator-grant store
// server-owned, RLS-forced and out of the exposed Supabase Data API. Static
// contract test only: no Supabase CLI is available in this workspace to prove
// it live (RSK-016, Appendix E).
// @spec FR-075, SEC-008
// @tested tests/unit/platform-grant-migration.test.js

const MIGRATION_PATH = path.join(process.cwd(), 'supabase', 'migrations', '20260827090000_platform_grant.sql')

function migrationSql() {
  return fs.readFileSync(MIGRATION_PATH, 'utf8')
}

describe('FR-107 PlatformGrant Supabase migration', () => {
  it('creates the table with Person foreign keys and the one-grant-per-capability uniqueness', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/create table if not exists "PlatformGrant"/i)
    expect(sql).toMatch(/"personId" text not null references "Person"\("id"\) on delete cascade/i)
    expect(sql).toMatch(/"grantedByPersonId" text references "Person"\("id"\) on delete set null/i)
    expect(sql).toMatch(/PlatformGrant_personId_capability_key/i)
    expect(sql).toMatch(/PlatformGrant_capability_status_idx/i)
    expect(sql).not.toMatch(/drop\s+(?:table|column|constraint)/i)
  })

  it('forces RLS and grants only the app runtime roles, never the Data API roles', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/alter table "PlatformGrant" enable row level security/i)
    expect(sql).toMatch(/alter table "PlatformGrant" force row level security/i)
    expect(sql).toMatch(/create policy zuri_app_runtime_all on "PlatformGrant"[\s\S]*to zuri_app_runtime, zuri_web_login/i)
    expect(sql).toMatch(/revoke all on table "PlatformGrant" from public, anon, authenticated, service_role/i)
    expect(sql).not.toMatch(/grant\s+(?:all|select|insert|update|delete)[\s\S]*\b(?:anon|authenticated)\b/i)
  })

  it('never writes the migration ledger from inside the file', () => {
    expect(migrationSql()).not.toMatch(/schema_migrations/i)
  })
})
