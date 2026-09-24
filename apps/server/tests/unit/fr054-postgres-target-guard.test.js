import { describe, expect, it } from 'vitest'
import { FR054_DESTRUCTIVE_OPT_IN, parseFr054PostgresTarget } from '../helpers/fr054-postgres-target-guard.js'

// @req FR-054 — prevent the isolation-probe suite from mutating roles anywhere but a dedicated loopback database.
// @spec SDD-027, SEC-011, ADR-057 — canonical loopback target and explicit destructive intent, checked before any connection.
// @tested tests/unit/fr054-postgres-target-guard.test.js

const BASE = 'postgresql://postgres@127.0.0.1:55435/zuri_fr054_test'
const guard = (databaseUrl, destructiveOptIn) => () => parseFr054PostgresTarget({ databaseUrl, destructiveOptIn })

describe('FR-054 runtime isolation PostgreSQL target guard', () => {
  it('disables the suite when no database URL is provided', () => {
    expect(parseFr054PostgresTarget({ destructiveOptIn: FR054_DESTRUCTIVE_OPT_IN })).toEqual({ enabled: false })
  })

  it.each([
    [BASE, BASE],
    ['postgresql://postgres@localhost/zuri_fr054_test', 'postgresql://postgres@localhost:5432/zuri_fr054_test'],
    // The old inline guard compared the bracketed hostname and so refused IPv6 loopback.
    ['postgresql://postgres@[::1]:55435/zuri_fr054_test', 'postgresql://postgres@[::1]:55435/zuri_fr054_test'],
  ])('accepts the dedicated loopback database with the opt-in: %s', (databaseUrl, canonical) => {
    expect(parseFr054PostgresTarget({ databaseUrl, destructiveOptIn: FR054_DESTRUCTIVE_OPT_IN }))
      .toEqual({ enabled: true, databaseUrl: canonical })
  })

  it.each([
    ['?host=', `${BASE}?host=db.example.com`],
    ['?hostaddr=', `${BASE}?hostaddr=203.0.113.10`],
    ['?port=', `${BASE}?port=5432`],
    ['?dbname=', `${BASE}?dbname=postgres`],
    ['?options=', `${BASE}?options=-c%20role%3Dpostgres`],
    ['?service=', `${BASE}?service=prod`],
    ['fragment', `${BASE}#x`],
  ])('refuses a connection-string override: %s', (_label, databaseUrl) => {
    expect(guard(databaseUrl, FR054_DESTRUCTIVE_OPT_IN)).toThrow('RUNTIME_ISOLATION_TEST_DATABASE_URL_OVERRIDES_REFUSED')
  })

  it.each([
    ['remote host', 'postgresql://postgres@db.example.com/zuri_fr054_test'],
    ['loopback in userinfo, remote host', 'postgresql://127.0.0.1:5432@db.example.com/zuri_fr054_test'],
    ['wrong database', 'postgresql://postgres@127.0.0.1:55435/postgres'],
  ])('refuses a target that is not the dedicated loopback database: %s', (_label, databaseUrl) => {
    expect(guard(databaseUrl, FR054_DESTRUCTIVE_OPT_IN)).toThrow('RUNTIME_ISOLATION_TEST_DATABASE_MUST_BE_DEDICATED_LOOPBACK')
  })

  it('refuses the dedicated loopback target without the exact destructive opt-in', () => {
    expect(guard(BASE, undefined)).toThrow('RUNTIME_ISOLATION_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')
    expect(guard(BASE, 'yes')).toThrow('RUNTIME_ISOLATION_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')
  })

  it('checks the target before the opt-in, so an override is refused even without one', () => {
    expect(guard(`${BASE}?host=db.example.com`, undefined)).toThrow('RUNTIME_ISOLATION_TEST_DATABASE_URL_OVERRIDES_REFUSED')
  })
})
