import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// @req FR-051 — production Supabase scope rows are structurally tenant-isolated.
// @spec SDD-026, SEC-010 — private schema, composite ancestry, forced RLS and least privilege.
// @tested tests/unit/supabase-production-isolation.test.js

const RESERVED = Object.freeze({
  portfolioId: 'dfeaa9d2-7c65-48bc-9c30-ba083eac8439',
  tenantId: '77cdbe70-3111-4a04-922a-8059be99a8b0',
  businessId: '834fa869-62f3-431c-a287-e9a95e91175b',
  bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9',
  auditBatchId: '948076f9-6a0a-43f3-88f5-d7225345ac8a',
})

function productionMigration() {
  const dir = path.join(process.cwd(), 'supabase', 'migrations')
  const matches = fs.readdirSync(dir)
    .filter((name) => name.endsWith('_production_tenant_bootstrap.sql'))
  expect(matches).toHaveLength(1)
  return fs.readFileSync(path.join(dir, matches[0]), 'utf8')
}

describe('Supabase production tenant bootstrap (FR-051)', () => {
  it('keeps Zuri base tables in a private schema with no Data API base-table grants', () => {
    const sql = productionMigration()

    expect(sql).toMatch(/create schema if not exists zuri_core/i)
    for (const table of ['portfolio', 'tenant', 'business', 'line_channel_binding', 'business_knowledge', 'bootstrap_audit_event']) {
      expect(sql).toMatch(new RegExp(`create table if not exists zuri_core\\.${table}\\b`, 'i'))
    }
    expect(sql).toMatch(/revoke all on schema zuri_core from public, anon, authenticated, service_role/i)
    expect(sql).not.toMatch(/grant\s+(?:all|select).*\b(?:anon|authenticated|service_role)\b/i)
  })

  it('enforces tenant/business ancestry with composite keys and tenant-leading indexes', () => {
    const sql = productionMigration()

    expect(sql).toMatch(/unique\s*\(tenant_id,\s*id\)/i)
    expect(sql).toMatch(/foreign key\s*\(tenant_id,\s*business_id\)\s*references\s+zuri_core\.business\s*\(tenant_id,\s*id\)/i)
    expect(sql).toMatch(/business_knowledge_scope_product_idx[\s\S]*\(tenant_id,\s*business_id,\s*is_active,\s*product_code\)/i)
    expect(sql).toMatch(/line_channel_binding_scope_idx[\s\S]*\(tenant_id,\s*business_id,\s*status\)/i)
  })

  it('forces RLS and binds the LINE read role to the reserved SmartGift scope', () => {
    const sql = productionMigration()

    expect(sql).toMatch(/create role zuri_line_smartgift_ro\s+noinherit\s+nobypassrls/i)
    expect(sql).toMatch(/create role zuri_line_smartgift_login\s+login\s+noinherit\s+nobypassrls/i)
    expect(sql).toMatch(/grant zuri_line_smartgift_ro to zuri_line_smartgift_login/i)
    expect(sql).toMatch(/ROLE_SECURITY_MISMATCH/i)
    expect(sql).not.toMatch(/alter role zuri_line_smartgift_login[\s\S]{0,120}\bnosuperuser\b/i)
    for (const table of ['line_channel_binding', 'business_knowledge']) {
      expect(sql).toMatch(new RegExp(`alter table zuri_core\\.${table} enable row level security`, 'i'))
      expect(sql).toMatch(new RegExp(`alter table zuri_core\\.${table} force row level security`, 'i'))
    }
    expect(sql).toMatch(new RegExp(`to zuri_line_smartgift_ro[\\s\\S]*tenant_id\\s*=\\s*'${RESERVED.tenantId}'[\\s\\S]*business_id\\s*=\\s*'${RESERVED.businessId}'`, 'i'))
    expect(sql).not.toMatch(/current_setting\s*\(\s*['"]app\./i)
  })

  it('reserves stable production identities idempotently while leaving the LINE binding disabled', () => {
    const sql = productionMigration()

    for (const id of Object.values(RESERVED)) expect(sql).toContain(id)
    expect(sql).toMatch(/on conflict\s*\([^)]*code[^)]*\)\s*do update/i)
    expect(sql).toMatch(/LINE-SMARTGIFT-OA[\s\S]*PENDING/i)
    expect(sql).toMatch(/BOOTSTRAP-PROD-001/i)
    expect(sql).toMatch(/pg_advisory_xact_lock/i)
    expect(sql).toMatch(/set local lock_timeout/i)
    expect(sql).toMatch(/set local statement_timeout/i)
    expect(sql).toMatch(/BOOTSTRAP_IDENTITY_MISMATCH/i)
    expect(sql).toMatch(/execute\s+format\s*\(/i)
  })
})
