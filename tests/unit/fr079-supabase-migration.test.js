import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// @req FR-079 — production connection metadata is private, RLS-protected and unique.
// @spec ADR-018, ADR-031, SDD-043, SEC-015
// @tested tests/unit/fr079-supabase-migration.test.js

describe('FR-079 production connection migration', () => {
  it('creates opaque connection metadata with forced RLS and no raw credential column', () => {
    const sql = readFileSync('supabase/migrations/20260818040000_phase1_line_runtime_connections.sql', 'utf8')
    expect(sql).toContain('create table if not exists zuri_core.integration_provider')
    expect(sql).toContain('create table if not exists zuri_core.integration_connection')
    expect(sql).toContain('create table if not exists zuri_core.integration_credential')
    expect(sql).toContain('alter table zuri_core.integration_connection force row level security')
    expect(sql).toContain('secret_ref text not null')
    expect(sql).not.toMatch(/api_key|access_token|refresh_token|credential_value|secret_material/i)
  })

  it('enforces one active primary Phase 1 connection and grants read-only scoped access', () => {
    const sql = readFileSync('supabase/migrations/20260818040000_phase1_line_runtime_connections.sql', 'utf8')
    expect(sql).toContain('create unique index if not exists integration_connection_phase1_active_primary_key')
    expect(sql).toContain("purpose = 'PHASE1_LINE_LLM' and status = 'ACTIVE' and role = 'PRIMARY'")
    expect(sql).toContain('grant select on zuri_core.integration_provider, zuri_core.integration_connection, zuri_core.integration_credential')
    expect(sql).toContain('to zuri_line_smartgift_ro')
    expect(sql).toContain('line_smartgift_integration_connection_read')
  })
})
