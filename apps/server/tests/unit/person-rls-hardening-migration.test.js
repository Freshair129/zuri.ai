import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// @req FR-094, FR-095, FR-096 — the canonical Person principal remains behind
// the production RLS boundary after the live schema drift repair.
// @spec ADR-018 D5, ADR-045 D1-D6, SDD-052, SEC-018
// @tested tests/unit/person-rls-hardening-migration.test.js

const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260922100000_force_person_rls.sql',
)

function migrationSql() {
  return fs.readFileSync(MIGRATION_PATH, 'utf8')
}

describe('Person RLS hardening migration', () => {
  it('forces RLS without changing rows or weakening the runtime grant', () => {
    const sql = migrationSql()

    expect(sql).toMatch(/begin;[\s\S]*set local lock_timeout = '5s'/i)
    expect(sql).toMatch(/set local statement_timeout = '60s'/i)
    expect(sql).toMatch(/alter table "Person" enable row level security/i)
    expect(sql).toMatch(/alter table "Person" force row level security/i)
    expect(sql).toMatch(/revoke all on table "Person"[\s\S]*from public, anon, authenticated, service_role/i)
    expect(sql).not.toMatch(/drop\s+(?:table|column|constraint)/i)
    expect(sql).not.toMatch(/(?:insert|update|delete)\s+into?\s+"Person"/i)
  })
})
