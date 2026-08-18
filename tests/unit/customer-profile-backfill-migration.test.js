import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  'supabase/migrations/20260818070000_customer_profile_backfill_schema.sql',
  'utf8',
)

// @req FR-078 — target schema must exist before customer data can be published.
// @spec CDC-SG-CUSTOMER-DATA-001, ADR-018.
// @tested tests/unit/customer-profile-backfill-migration.test.js

describe('FR-078 customer profile target schema migration', () => {
  it('creates the private CRM and provenance boundary without source rows', () => {
    for (const table of ['person', 'customer', 'customer_import_batch', 'customer_import_provenance']) {
      expect(migration).toMatch(new RegExp(`create table if not exists zuri_core\\.${table}\\b`, 'i'))
    }

    expect(migration).toMatch(/foreign key \(tenant_id, business_id\)[\s\S]*references zuri_core\.business \(tenant_id, id\)/i)
    expect(migration).toMatch(/unique \(source_system, source_table, source_record_key, snapshot_sha256\)/i)
    expect(migration).toMatch(/customerRowsWritten', 0/i)
    expect(migration).not.toMatch(/insert into zuri_core\.(person|customer)\b/i)
  })

  it('enables forced RLS and revokes Data API access', () => {
    for (const table of ['person', 'customer', 'customer_import_batch', 'customer_import_provenance']) {
      expect(migration).toMatch(new RegExp(`alter table zuri_core\\.${table} enable row level security`, 'i'))
      expect(migration).toMatch(new RegExp(`alter table zuri_core\\.${table} force row level security`, 'i'))
    }

    expect(migration).toMatch(/revoke all on table[\s\S]*from public, anon, authenticated, service_role/i)
    expect(migration).not.toMatch(/grant\s+(?:all|select|insert|update|delete)[\s\S]*\b(?:anon|authenticated|service_role)\b/i)
    expect(migration).not.toMatch(/security definer|create\s+(?:or replace\s+)?function/i)
  })

  it('does not add restricted source fields to the initial target schema', () => {
    expect(migration).not.toMatch(/\b(?:tax_id|phone_e164|raw_document|raw_source_path|lifetime_value|credit_days)\b/i)
    expect(migration).toMatch(/display_name text not null/i)
  })
})
