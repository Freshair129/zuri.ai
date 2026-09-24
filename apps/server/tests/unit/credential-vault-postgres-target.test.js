import { describe, expect, it } from 'vitest'
import { parse } from 'pg-connection-string'
import { VAULT_TEST_OPT_IN, parseVaultPostgresTarget } from '../helpers/credential-vault-postgres-target.js'

// @req FR-223 — the destructive vault suite may only reach a dedicated loopback database.
// @spec ADR-057, SEC-030 — judge the target as the driver resolves it, fail closed on overrides.
// @tested tests/unit/credential-vault-postgres-target.test.js

const BASE = 'postgresql://postgres@127.0.0.1:55433/zuri_vault_test'
const guard = (databaseUrl, optIn = VAULT_TEST_OPT_IN) => () => parseVaultPostgresTarget({ databaseUrl, optIn })

describe('FR-223 credential vault PostgreSQL target guard', () => {
  it('disables the suite when no database URL is provided', () => {
    expect(parseVaultPostgresTarget({ databaseUrl: undefined, optIn: VAULT_TEST_OPT_IN })).toEqual({ enabled: false })
    expect(parseVaultPostgresTarget({ databaseUrl: '', optIn: VAULT_TEST_OPT_IN })).toEqual({ enabled: false })
  })

  it.each([
    [BASE, 'postgresql://postgres@127.0.0.1:55433/zuri_vault_test', '127.0.0.1', 55433],
    ['postgres://postgres@localhost:55433/zuri_vault_test', 'postgresql://postgres@localhost:55433/zuri_vault_test', 'localhost', 55433],
    ['postgresql://postgres@[::1]:55433/zuri_vault_test', 'postgresql://postgres@[::1]:55433/zuri_vault_test', '::1', 55433],
    ['postgresql://postgres@127.0.0.1/zuri_vault_test', 'postgresql://postgres@127.0.0.1:5432/zuri_vault_test', '127.0.0.1', 5432],
    ['postgresql://postgres:p%40ss@127.0.0.1:55433/zuri_vault_test', 'postgresql://postgres:p%40ss@127.0.0.1:55433/zuri_vault_test', '127.0.0.1', 55433],
    ['postgresql://127.0.0.1:55433/zuri_vault_test', 'postgresql://127.0.0.1:55433/zuri_vault_test', '127.0.0.1', 55433],
  ])('accepts the dedicated loopback database %s and returns a canonical URL', (databaseUrl, canonical, host, port) => {
    const target = parseVaultPostgresTarget({ databaseUrl, optIn: VAULT_TEST_OPT_IN })
    expect(target).toEqual({ enabled: true, databaseUrl: canonical, host, port, database: 'zuri_vault_test' })
    // The URL handed to the suite resolves, through the driver's own parser, to what was validated.
    const resolved = parse(target.databaseUrl)
    expect(resolved.host.replace(/^\[|\]$/g, '')).toBe(host)
    expect(resolved.port).toBe(String(port))
    expect(resolved.database).toBe('zuri_vault_test')
  })

  it.each([
    ['?host= remote', `${BASE}?host=db.example.com`],
    ['?host= socket path', `${BASE}?host=/var/run/postgresql`],
    ['?hostaddr=', `${BASE}?hostaddr=203.0.113.10`],
    ['?port=', `${BASE}?port=5432`],
    ['?dbname=', `${BASE}?dbname=postgres`],
    ['?database=', `${BASE}?database=postgres`],
    ['?options=', `${BASE}?options=-c%20search_path%3Dpublic`],
    ['?service=', `${BASE}?service=prod`],
    ['?sslmode=', `${BASE}?sslmode=disable`],
    ['?user=', `${BASE}?user=supabase_admin`],
    ['empty query', `${BASE}?`],
    ['fragment', `${BASE}#host=db.example.com`],
  ])('refuses a connection-string override: %s', (_label, databaseUrl) => {
    expect(guard(databaseUrl)).toThrow('VAULT_TEST_DATABASE_URL_OVERRIDES_REFUSED')
  })

  it.each([
    ['remote host', 'postgresql://postgres@db.example.com:5432/zuri_vault_test'],
    ['loopback in userinfo, remote host', 'postgresql://127.0.0.1:55433@db.example.com/zuri_vault_test'],
    ['localhost as user, remote host', 'postgresql://localhost@db.example.com:5432/zuri_vault_test'],
    ['multi-host list', 'postgresql://postgres@127.0.0.1,db.example.com:55433/zuri_vault_test'],
    ['percent-encoded loopback host', 'postgresql://postgres@%31%32%37.0.0.1:55433/zuri_vault_test'],
    ['percent-encoded socket-path host', 'postgresql://postgres@%2Fvar%2Frun%2Fpostgresql/zuri_vault_test'],
    ['empty host', 'postgresql:///zuri_vault_test'],
    ['non-loopback IPv6', 'postgresql://postgres@[2001:db8::1]:5432/zuri_vault_test'],
    ['IPv4-mapped IPv6', 'postgresql://postgres@[::ffff:127.0.0.1]:55433/zuri_vault_test'],
    ['shorthand loopback', 'postgresql://postgres@127.1:55433/zuri_vault_test'],
    ['hex loopback', 'postgresql://postgres@0x7f000001:55433/zuri_vault_test'],
    ['trailing-dot localhost', 'postgresql://postgres@localhost.:55433/zuri_vault_test'],
    ['localhost subdomain', 'postgresql://postgres@localhost.db.example.com:55433/zuri_vault_test'],
    ['port zero', 'postgresql://postgres@127.0.0.1:0/zuri_vault_test'],
    ['wrong database', 'postgresql://postgres@127.0.0.1:55433/postgres'],
    ['percent-encoded database', 'postgresql://postgres@127.0.0.1:55433/zuri%5Fvault_test'],
    ['database with extra path', 'postgresql://postgres@127.0.0.1:55433/zuri_vault_test/postgres'],
    ['missing database', 'postgresql://postgres@127.0.0.1:55433'],
  ])('refuses a target that is not the dedicated loopback database: %s', (_label, databaseUrl) => {
    expect(guard(databaseUrl)).toThrow('VAULT_TEST_DATABASE_MUST_BE_DEDICATED_LOOPBACK')
  })

  it.each([
    ['not a URL', 'zuri_vault_test'],
    ['wrong scheme', 'mysql://root@127.0.0.1:3306/zuri_vault_test'],
    ['socket scheme', 'socket://postgres@/var/run/postgresql?db=zuri_vault_test'],
    ['port out of range', 'postgresql://postgres@127.0.0.1:99999/zuri_vault_test'],
  ])('refuses an unparseable or non-PostgreSQL URL: %s', (_label, databaseUrl) => {
    expect(guard(databaseUrl)).toThrow('VAULT_TEST_DATABASE_URL_INVALID')
  })

  it('refuses a dedicated loopback target without the exact destructive opt-in', () => {
    expect(() => parseVaultPostgresTarget({ databaseUrl: BASE })).toThrow('VAULT_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')
    expect(guard(BASE, 'yes')).toThrow('VAULT_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')
  })

  it('checks the target before the opt-in, so an override is refused even without one', () => {
    expect(() => parseVaultPostgresTarget({ databaseUrl: `${BASE}?host=db.example.com` })).toThrow('VAULT_TEST_DATABASE_URL_OVERRIDES_REFUSED')
  })
})
