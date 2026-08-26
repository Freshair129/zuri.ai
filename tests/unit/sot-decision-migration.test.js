import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// @req FR-100 — the production migration for the SoT decision queue keeps it
// server-owned, RLS-forced and out of the exposed Supabase Data API. Static
// contract test only, matching sot-data-plane-key-migration.test.js — no
// Supabase CLI is available in this workspace to prove it live.
// @spec BR-002, SEC-002
// @tested tests/unit/sot-decision-migration.test.js

const MIGRATION_PATH = path.join(process.cwd(), 'supabase', 'migrations', '20260825130000_sot_decision.sql')

function migrationSql() {
  return fs.readFileSync(MIGRATION_PATH, 'utf8')
}

describe('FR-100 SotDecision Supabase migration', () => {
  it('creates the table with Tenant/Business foreign keys and the idempotency-supporting unique index', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/create table if not exists "SotDecision"/i)
    expect(sql).toMatch(/"tenantId" text not null references "Tenant"\("id"\)/i)
    expect(sql).toMatch(/"businessId" text references "Business"\("id"\)/i)
    expect(sql).toMatch(/SotDecision_tenantId_decisionType_subjectRef_decisionVersio_key/i)
    expect(sql).not.toMatch(/drop\s+(?:table|column|constraint)/i)
  })

  it('forces RLS and grants only the app runtime roles, never the Data API roles', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/alter table "SotDecision" enable row level security/i)
    expect(sql).toMatch(/alter table "SotDecision" force row level security/i)
    expect(sql).toMatch(/create policy zuri_app_runtime_all on "SotDecision"[\s\S]*to zuri_app_runtime, zuri_web_login/i)
    expect(sql).toMatch(/revoke all on table "SotDecision" from public, anon, authenticated, service_role/i)
    expect(sql).not.toMatch(/grant\s+(?:all|select|insert|update|delete)[\s\S]*\b(?:anon|authenticated)\b/i)
  })
})
