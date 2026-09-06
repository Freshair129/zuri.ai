import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const migration = readFileSync(
  'supabase/migrations/20260818090201_customer_review_runtime_login.sql',
  'utf8',
)

// @req FR-078 — the private review queue is reachable only through a dedicated login.
// @spec ADR-018 D3, SEC-010 — no admin, Data API or direct table grant is the runtime path.
// @tested tests/unit/customer-review-runtime-login-migration.test.js

describe('FR-078 customer review runtime login migration', () => {
  it('creates an explicit bounded login and grants only SET access to app runtime', () => {
    expect(migration).toMatch(/create role zuri_customer_review_login login noinherit nobypassrls/i)
    expect(migration).toMatch(/nosuperuser nocreatedb nocreaterole noreplication/i)
    expect(migration).toMatch(/grant zuri_app_runtime to zuri_customer_review_login\s+with inherit false, set true, admin false/i)
    expect(migration).toMatch(/member\.inherit_option = false[\s\S]*member\.set_option = true[\s\S]*member\.admin_option = false/i)
  })

  it('removes direct private-schema privileges from the login', () => {
    expect(migration).toMatch(/revoke all on schema zuri_core from zuri_customer_review_login/i)
    expect(migration).toMatch(/revoke all on all tables in schema zuri_core from zuri_customer_review_login/i)
    expect(migration).not.toMatch(/grant (select|insert|update|delete)[\s\S]{0,120}zuri_customer_review_login/i)
  })
})
