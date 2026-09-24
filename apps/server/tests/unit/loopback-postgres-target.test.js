import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { parse } from 'pg-connection-string'
import { resolveLoopbackPostgresTarget, verifyClusterLevelMarker } from '../helpers/loopback-postgres-target.js'

// @req FR-054 — the runtime isolation probe's destructive suite may only reach a dedicated loopback database.
// @req FR-055 — the LINE activation destructive suites may only reach a dedicated loopback database.
// @spec ADR-057, SEC-011, SEC-012 — judge the target as the driver resolves it, fail closed on overrides.
// @tested tests/unit/loopback-postgres-target.test.js

const DATABASE = 'zuri_guard_test'
const BASE = `postgresql://postgres@127.0.0.1:55433/${DATABASE}`
const resolve = (databaseUrl) => resolveLoopbackPostgresTarget(databaseUrl, { database: DATABASE, errorPrefix: 'GUARD_TEST' })

describe('loopback PostgreSQL test-target resolver', () => {
  it.each([
    [BASE, BASE, '127.0.0.1', 55433],
    [`postgres://postgres@localhost:55433/${DATABASE}`, `postgresql://postgres@localhost:55433/${DATABASE}`, 'localhost', 55433],
    [`postgresql://postgres@[::1]:55433/${DATABASE}`, `postgresql://postgres@[::1]:55433/${DATABASE}`, '::1', 55433],
    [`postgresql://postgres@127.0.0.1/${DATABASE}`, `postgresql://postgres@127.0.0.1:5432/${DATABASE}`, '127.0.0.1', 5432],
    [`postgresql://postgres:p%40ss@127.0.0.1:55433/${DATABASE}`, `postgresql://postgres:p%40ss@127.0.0.1:55433/${DATABASE}`, '127.0.0.1', 55433],
    [`postgresql://127.0.0.1:55433/${DATABASE}`, `postgresql://127.0.0.1:55433/${DATABASE}`, '127.0.0.1', 55433],
  ])('accepts %s and returns a canonical URL', (databaseUrl, canonical, host, port) => {
    const target = resolve(databaseUrl)
    expect(target).toEqual({ databaseUrl: canonical, host, port, database: DATABASE })
    // What the suite is handed resolves, through the driver's own parser, to what was validated.
    const resolved = parse(target.databaseUrl)
    expect(resolved.host.replace(/^\[|\]$/g, '')).toBe(host)
    expect(resolved.port).toBe(String(port))
    expect(resolved.database).toBe(DATABASE)
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
    expect(() => resolve(databaseUrl)).toThrow('GUARD_TEST_DATABASE_URL_OVERRIDES_REFUSED')
  })

  it.each([
    ['remote host', `postgresql://postgres@db.example.com:5432/${DATABASE}`],
    ['loopback in userinfo, remote host', `postgresql://127.0.0.1:55433@db.example.com/${DATABASE}`],
    ['localhost as user, remote host', `postgresql://localhost@db.example.com:5432/${DATABASE}`],
    ['multi-host list', `postgresql://postgres@127.0.0.1,db.example.com:55433/${DATABASE}`],
    ['percent-encoded loopback host', `postgresql://postgres@%31%32%37.0.0.1:55433/${DATABASE}`],
    ['percent-encoded socket-path host', `postgresql://postgres@%2Fvar%2Frun%2Fpostgresql/${DATABASE}`],
    ['empty host', `postgresql:///${DATABASE}`],
    ['non-loopback IPv6', `postgresql://postgres@[2001:db8::1]:5432/${DATABASE}`],
    ['IPv4-mapped IPv6', `postgresql://postgres@[::ffff:127.0.0.1]:55433/${DATABASE}`],
    ['shorthand loopback', `postgresql://postgres@127.1:55433/${DATABASE}`],
    ['hex loopback', `postgresql://postgres@0x7f000001:55433/${DATABASE}`],
    ['trailing-dot localhost', `postgresql://postgres@localhost.:55433/${DATABASE}`],
    ['localhost subdomain', `postgresql://postgres@localhost.db.example.com:55433/${DATABASE}`],
    ['port zero', `postgresql://postgres@127.0.0.1:0/${DATABASE}`],
    ['wrong database', 'postgresql://postgres@127.0.0.1:55433/postgres'],
    ['percent-encoded database', 'postgresql://postgres@127.0.0.1:55433/zuri%5Fguard_test'],
    ['database with extra path', `postgresql://postgres@127.0.0.1:55433/${DATABASE}/postgres`],
    ['missing database', 'postgresql://postgres@127.0.0.1:55433'],
  ])('refuses a target that is not the dedicated loopback database: %s', (_label, databaseUrl) => {
    expect(() => resolve(databaseUrl)).toThrow('GUARD_TEST_DATABASE_MUST_BE_DEDICATED_LOOPBACK')
  })

  it.each([
    ['not a URL', DATABASE],
    ['wrong scheme', `mysql://root@127.0.0.1:3306/${DATABASE}`],
    ['socket scheme', `socket://postgres@/var/run/postgresql?db=${DATABASE}`],
    ['port out of range', `postgresql://postgres@127.0.0.1:99999/${DATABASE}`],
  ])('refuses an unparseable or non-PostgreSQL URL: %s', (_label, databaseUrl) => {
    expect(() => resolve(databaseUrl)).toThrow('GUARD_TEST_DATABASE_URL_INVALID')
  })
})

describe('cluster-level disposable marker', () => {
  const MARKER = 'guard-disposable:1'
  const options = { setting: 'zuri.guard_disposable_cluster', expectedMarker: MARKER, markerPattern: /^guard-disposable:\d$/, errorPrefix: 'GUARD_TEST' }
  const client = (row) => ({ query: vi.fn(async () => ({ rows: [row] })) })
  const good = { effective: MARKER, file_value: MARKER, has_db_role_override: false }

  it('accepts a marker set in postgresql.conf / ALTER SYSTEM, in force, with no database or role entry', async () => {
    const c = client(good)
    await expect(verifyClusterLevelMarker(c, options)).resolves.toBeUndefined()
    expect(c.query).toHaveBeenCalledWith(expect.stringContaining('pg_file_settings'), ['zuri.guard_disposable_cluster'])
    expect(c.query.mock.calls[0][0]).toContain('pg_db_role_setting')
  })

  it.each([
    ['absent everywhere', { effective: null, file_value: null, has_db_role_override: false }, 'MISMATCH'],
    ['a different value in force', { ...good, effective: 'guard-disposable:2' }, 'MISMATCH'],
    ['set by ALTER DATABASE / ALTER ROLE / SET only (not in the file)', { ...good, file_value: null }, 'NOT_CLUSTER_LEVEL'],
    ['in the file but also set in pg_db_role_setting', { ...good, has_db_role_override: true }, 'NOT_CLUSTER_LEVEL'],
    ['in the file with another value, the marker supplied by a higher-priority source', { ...good, file_value: 'guard-disposable:2' }, 'NOT_CLUSTER_LEVEL'],
    ['an unreadable override flag', { ...good, has_db_role_override: null }, 'NOT_CLUSTER_LEVEL'],
  ])('fails closed when the marker is %s', async (_label, row, reason) => {
    await expect(verifyClusterLevelMarker(client(row), options)).rejects.toThrow(`GUARD_TEST_CLUSTER_MARKER_${reason}`)
  })

  it('fails closed without querying when the expected marker is malformed', async () => {
    const c = client(good)
    await expect(verifyClusterLevelMarker(c, { ...options, expectedMarker: 'x' })).rejects.toThrow('GUARD_TEST_CLUSTER_MARKER_MISMATCH')
    expect(c.query).not.toHaveBeenCalled()
  })

  it('propagates a query failure such as an unreadable pg_file_settings', async () => {
    const c = { query: vi.fn(async () => { throw new Error('permission denied for view pg_file_settings') }) }
    await expect(verifyClusterLevelMarker(c, options)).rejects.toThrow('permission denied')
  })
})

describe('destructive PostgreSQL suites route their target through a guard helper', () => {
  // An inline `new URL(process.env...)` check is how the override bypass got in;
  // every *.postgres.test.js must take its target from a tests/helpers guard.
  const directory = path.join(process.cwd(), 'tests', 'integration')
  const suites = fs.readdirSync(directory).filter((name) => name.endsWith('.postgres.test.js'))

  it('finds the destructive suites', () => {
    expect(suites.length).toBeGreaterThan(0)
  })

  it.each(suites)('%s imports a target guard and builds no inline target check', (name) => {
    const source = fs.readFileSync(path.join(directory, name), 'utf8')
    expect(source).toMatch(/from '\.\.\/helpers\/[\w-]*(postgres-target|target-guard)[\w-]*(\.js)?'/)
    expect(source).not.toMatch(/new URL\(\s*process\.env\./)
    expect(source).not.toMatch(/\['127\.0\.0\.1', 'localhost', '::1'\]\.includes/)
  })
})
