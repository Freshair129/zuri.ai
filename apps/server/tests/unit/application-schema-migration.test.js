import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-076, FR-078 — the production application schema exists separately
// from the private zuri_core customer data schema.
// @spec ADR-033 D8, ADR-018.
// @req FR-023 — Customer.code is unique within its owning Tenant.
// @spec BR-001, ADR-121 D1, D3, D4 — a weaker composite key requires no backfill.

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260818084011_application_schema.sql'),
  'utf8',
)
const rlsHardening = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260821103000_public_rls_hardening.sql'),
  'utf8',
)

describe('application schema migration', () => {
  it('scopes Customer.code to Tenant without rewriting existing rows', () => {
    const customerCodeMigration = resolve(
      process.cwd(),
      'supabase/migrations/20261125120000_customer_code_tenant_scope.sql',
    )
    expect(existsSync(customerCodeMigration)).toBe(true)
    const sql = readFileSync(customerCodeMigration, 'utf8')
    expect(sql).toMatch(/DROP INDEX\s+"Customer_code_key"\s*;/i)
    expect(sql).toMatch(/CREATE UNIQUE INDEX\s+"Customer_tenantId_code_key"\s+ON\s+"Customer"\s*\(\s*"tenantId"\s*,\s*"code"\s*\)\s*;/i)
    expect(sql.search(/DROP INDEX\s+"Customer_code_key"\s*;/i))
      .toBeLessThan(sql.search(/CREATE UNIQUE INDEX\s+"Customer_tenantId_code_key"/i))
    const statements = sql.replace(/^\s*--.*$/gm, '')
    expect(statements).not.toMatch(/\b(?:UPDATE|DELETE|INSERT)\b/i)
  })

  it('provisions the RoleBinding model required by trusted viewer resolution', () => {
    expect(migration).toMatch(/CREATE TABLE "RoleBinding"/i)
    expect(migration).toMatch(/CREATE UNIQUE INDEX "RoleBinding_personId_businessId_roleKey_key"/i)
    expect(migration).toMatch(/ALTER TABLE "RoleBinding" ADD CONSTRAINT "RoleBinding_businessId_fkey"/i)
  })

  it('keeps the application schema out of the Supabase Data API roles', () => {
    expect(migration).toMatch(/ALTER TABLE .* ENABLE ROW LEVEL SECURITY/i)
    expect(migration).toMatch(/REVOKE ALL ON TABLE .* FROM anon, authenticated/i)
    expect(migration).toMatch(/REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated/i)
  })

  it('repairs every existing public table and keeps future tables private by default', () => {
    expect(rlsHardening).toMatch(/WHERE n\.nspname = 'public'/i)
    expect(rlsHardening).toMatch(/ALTER TABLE[\s\S]*ENABLE ROW LEVEL SECURITY/i)
    expect(rlsHardening).toMatch(/REVOKE ALL ON TABLE[\s\S]*FROM PUBLIC, anon, authenticated/i)
    expect(rlsHardening).toMatch(/REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated/i)
    expect(rlsHardening).toMatch(/ALTER DEFAULT PRIVILEGES IN SCHEMA public[\s\S]*REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated/i)
    expect(rlsHardening).toMatch(/ALTER DEFAULT PRIVILEGES IN SCHEMA public[\s\S]*REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated/i)
  })
})
