import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

// @req FR-094, FR-095, FR-096, FR-097, FR-098 — the production runtime role
// must be non-privileged before the persisted IAM schema is used by the app.
// @spec ADR-018 D3-D5, ADR-045 D2-D6, SDD-052, SEC-018
// @tested tests/unit/canonical-iam-runtime-role-cutover.test.js

const migrationPath = path.resolve(
  'supabase/migrations/20260822204604_canonical_iam_runtime_role_cutover.sql',
)
const sql = fs.readFileSync(migrationPath, 'utf8')

describe('canonical IAM runtime role cutover migration', () => {
  it('creates and guards a non-privileged web login without embedding a password', () => {
    expect(sql).toMatch(/create role zuri_web_login login inherit nobypassrls/i)
    expect(sql).toMatch(/not rolcanlogin|not rolinherit/i)
    expect(sql).toMatch(/grant zuri_app_runtime to zuri_web_login\s+with inherit true, set false, admin false/i)
    expect(sql).not.toMatch(/password\s*['"=]/i)
    expect(sql).not.toMatch(/service_role_key|reply_token|raw_secret|secret_value/i)
  })

  it('keeps the application runtime role no-login and no-bypass', () => {
    expect(sql).toMatch(/rolname = 'zuri_app_runtime'/i)
    expect(sql).toMatch(/rolsuper or rolbypassrls or rolcanlogin or rolinherit/i)
    expect(sql).toMatch(/grant usage on schema public to zuri_app_runtime/i)
  })

  it('grants only server DML and enables RLS across public server-owned tables', () => {
    expect(sql).toMatch(/grant select, insert, update, delete on table %I\.%I to zuri_app_runtime/i)
    expect(sql).toMatch(/alter table %I\.%I enable row level security/i)
    expect(sql).toMatch(/alter default privileges for role postgres in schema public/i)
    expect(sql).not.toMatch(/grant .*\b(?:references|trigger|truncate)\b.*to zuri_app_runtime/i)
  })

  it('creates a server-only all-row policy and rejects policy-name collisions', () => {
    expect(sql).toMatch(/create policy %I on %I\.%I for all to zuri_app_runtime, zuri_web_login/i)
    expect(sql).toMatch(/using \(true\) with check \(true\)/i)
    expect(sql).toMatch(/CANONICAL_IAM_RUNTIME_POLICY_COLLISION/i)
    expect(sql).toMatch(/roles @> array\['zuri_app_runtime'::name, 'zuri_web_login'::name\]/i)
  })

  it('does not write migration history manually or grant Data API/service roles', () => {
    expect(sql).not.toMatch(/insert\s+into\s+supabase_migrations\.schema_migrations/i)
    expect(sql).not.toMatch(/grant .*\bto\s+(?:public|anon|authenticated|service_role)\b/i)
  })
})
