import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// @req FR-106 — the production migration keeps the Enterprise API key table
// server-owned, RLS-forced and out of the exposed Supabase Data API. Static
// contract test only: no Supabase CLI is available in this workspace to prove
// it live (RSK-016, Appendix E — the same gate FR-100/102/103 sit behind).
// @spec SEC-006, ADR-047
// @tested tests/unit/api-access-key-migration.test.js

const MIGRATION_PATH = path.join(process.cwd(), 'supabase', 'migrations', '20260826150000_api_access_key.sql')

function migrationSql() {
  return fs.readFileSync(MIGRATION_PATH, 'utf8')
}

describe('FR-106 ApiAccessKey Supabase migration', () => {
  it('creates the table with a Tenant foreign key and a unique hashed-key column', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/create table if not exists "ApiAccessKey"/i)
    expect(sql).toMatch(/"keyHash" text not null unique/i)
    expect(sql).toMatch(/"tenantId" text not null references "Tenant"\("id"\)/i)
    expect(sql).toMatch(/ApiAccessKey_tenantId_status_idx/i)
    expect(sql).not.toMatch(/drop\s+(?:table|column|constraint)/i)
  })

  it('forces RLS and grants only the app runtime roles, never the Data API roles', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/alter table "ApiAccessKey" enable row level security/i)
    expect(sql).toMatch(/alter table "ApiAccessKey" force row level security/i)
    expect(sql).toMatch(/create policy zuri_app_runtime_all on "ApiAccessKey"[\s\S]*to zuri_app_runtime, zuri_web_login/i)
    expect(sql).toMatch(/revoke all on table "ApiAccessKey" from public, anon, authenticated, service_role/i)
    expect(sql).not.toMatch(/grant\s+(?:all|select|insert|update|delete)[\s\S]*\b(?:anon|authenticated)\b/i)
  })

  it('never stores or names the raw secret in the migration text itself', () => {
    const sql = migrationSql()
    expect(sql).not.toMatch(/rawKey|raw_key|secret_value|plaintext/i)
  })

  it('never writes the supabase migration ledger from inside the file', () => {
    expect(migrationSql()).not.toMatch(/schema_migrations/i)
  })
})
