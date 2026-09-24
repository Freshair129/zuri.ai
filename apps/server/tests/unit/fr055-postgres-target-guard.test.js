import { describe, expect, it, vi } from 'vitest'
import {
  DESTRUCTIVE_OPT_IN,
  parseFr055PostgresTarget,
  rolesCreatedByTest,
  runPostgresSetupWithCleanup,
  verifyDisposableClusterMarker,
} from '../helpers/fr055-postgres-target-guard.js'

// @req FR-055 — prevent the composed test from mutating roles on a non-disposable cluster.
// @spec NFR-013, BR-014, SDD-028, SEC-012 — require independent target, intent and cluster-marker gates.
// @tested tests/unit/fr055-postgres-target-guard.test.js

const marker = 'fr055-w4-disposable:11111111-1111-4111-8111-111111111111'

describe('FR-055 disposable PostgreSQL target guard', () => {
  it('disables the suite when no database URL is provided', () => {
    expect(parseFr055PostgresTarget({})).toEqual({ enabled: false })
  })

  it.each([
    ['remote host', 'postgresql://postgres:test@db.example.com/zuri_fr055_test', DESTRUCTIVE_OPT_IN, marker],
    ['wrong database', 'postgresql://postgres:test@127.0.0.1/other', DESTRUCTIVE_OPT_IN, marker],
    ['missing opt-in', 'postgresql://postgres:test@127.0.0.1/zuri_fr055_test', undefined, marker],
    ['wrong opt-in', 'postgresql://postgres:test@127.0.0.1/zuri_fr055_test', 'yes', marker],
    ['missing marker', 'postgresql://postgres:test@127.0.0.1/zuri_fr055_test', DESTRUCTIVE_OPT_IN, undefined],
    ['generic marker', 'postgresql://postgres:test@127.0.0.1/zuri_fr055_test', DESTRUCTIVE_OPT_IN, 'disposable'],
  ])('rejects %s before database access', (_label, databaseUrl, destructiveOptIn, clusterMarker) => {
    expect(() => parseFr055PostgresTarget({ databaseUrl, destructiveOptIn, clusterMarker }))
      .toThrow(/LINE_ACTIVATION_TEST_/)
  })

  it.each([
    ['?host= remote', 'postgresql://postgres:test@127.0.0.1/zuri_fr055_test?host=db.example.com'],
    ['?hostaddr=', 'postgresql://postgres:test@127.0.0.1/zuri_fr055_test?hostaddr=203.0.113.10'],
    ['?port=', 'postgresql://postgres:test@127.0.0.1/zuri_fr055_test?port=5432'],
    ['?dbname=', 'postgresql://postgres:test@127.0.0.1/zuri_fr055_test?dbname=postgres'],
    ['?options=', 'postgresql://postgres:test@127.0.0.1/zuri_fr055_test?options=-c%20role%3Dpostgres'],
    ['?service=', 'postgresql://postgres:test@127.0.0.1/zuri_fr055_test?service=prod'],
    ['fragment', 'postgresql://postgres:test@127.0.0.1/zuri_fr055_test#x'],
  ])('refuses a connection-string override even with opt-in and marker: %s', (_label, databaseUrl) => {
    expect(() => parseFr055PostgresTarget({ databaseUrl, destructiveOptIn: DESTRUCTIVE_OPT_IN, clusterMarker: marker }))
      .toThrow('LINE_ACTIVATION_TEST_DATABASE_URL_OVERRIDES_REFUSED')
  })

  it.each([
    ['loopback in userinfo, remote host', 'postgresql://127.0.0.1:5432@db.example.com/zuri_fr055_test'],
    ['multi-host list', 'postgresql://postgres@127.0.0.1,db.example.com/zuri_fr055_test'],
    ['percent-encoded loopback host', 'postgresql://postgres@%31%32%37.0.0.1/zuri_fr055_test'],
    ['non-loopback IPv6', 'postgresql://postgres@[2001:db8::1]/zuri_fr055_test'],
  ])('refuses a disguised non-loopback target: %s', (_label, databaseUrl) => {
    expect(() => parseFr055PostgresTarget({ databaseUrl, destructiveOptIn: DESTRUCTIVE_OPT_IN, clusterMarker: marker }))
      .toThrow('LINE_ACTIVATION_TEST_DATABASE_MUST_BE_DEDICATED_LOOPBACK')
  })

  it.each([
    ['postgresql://postgres:test@127.0.0.1/zuri_fr055_test', 'postgresql://postgres:test@127.0.0.1:5432/zuri_fr055_test'],
    ['postgresql://postgres:test@localhost/zuri_fr055_test', 'postgresql://postgres:test@localhost:5432/zuri_fr055_test'],
    ['postgresql://postgres:test@[::1]/zuri_fr055_test', 'postgresql://postgres:test@[::1]:5432/zuri_fr055_test'],
    ['postgresql://postgres:test@127.0.0.1:56584/zuri_fr055_test', 'postgresql://postgres:test@127.0.0.1:56584/zuri_fr055_test'],
  ])('accepts exact loopback target only with explicit intent and a per-run marker: %s', (databaseUrl, canonical) => {
    expect(parseFr055PostgresTarget({
      databaseUrl,
      destructiveOptIn: DESTRUCTIVE_OPT_IN,
      clusterMarker: marker,
    })).toEqual({ enabled: true, databaseUrl: canonical, clusterMarker: marker })
  })

  it('verifies the exact marker from the connected cluster before DDL', async () => {
    const query = vi.fn(async () => ({ rows: [{ marker }] }))
    await expect(verifyDisposableClusterMarker({ query }, marker)).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledWith("select current_setting('zuri.fr055_disposable_cluster', true) as marker")
  })

  it('fails closed when the connected cluster marker is absent or different', async () => {
    await expect(verifyDisposableClusterMarker({
      query: vi.fn(async () => ({ rows: [{ marker: null }] })),
    }, marker)).rejects.toThrow('LINE_ACTIVATION_TEST_CLUSTER_MARKER_MISMATCH')

    await expect(verifyDisposableClusterMarker({
      query: vi.fn(async () => ({ rows: [{ marker: `${marker}-other` }] })),
    }, marker)).rejects.toThrow('LINE_ACTIVATION_TEST_CLUSTER_MARKER_MISMATCH')
  })

  it('identifies only roles absent from the pre-test baseline as test-created', () => {
    const created = rolesCreatedByTest(
      new Set(['anon', 'service_role']),
      new Set(['anon', 'authenticated', 'service_role', 'zuri_app_runtime']),
    )
    expect([...created].sort()).toEqual(['authenticated', 'zuri_app_runtime'])
  })

  it('rolls an aborted setup transaction back before cleanup and rethrows the original error', async () => {
    const originalError = Object.assign(new Error('forced migration failure'), { code: '42883' })
    const order = []
    const client = {
      query: vi.fn(async (sql) => {
        expect(sql).toBe('rollback')
        order.push('rollback')
      }),
    }
    const setup = vi.fn(async () => {
      order.push('setup')
      throw originalError
    })
    const cleanup = vi.fn(async () => { order.push('cleanup') })

    await expect(runPostgresSetupWithCleanup(client, setup, cleanup)).rejects.toBe(originalError)
    expect(order).toEqual(['setup', 'rollback', 'cleanup'])
  })

  it('ignores no-active-transaction recovery while retaining the original setup error', async () => {
    const originalError = Object.assign(new Error('setup failed before begin'), { code: 'XX000' })
    const client = {
      query: vi.fn(async () => { throw Object.assign(new Error('no transaction'), { code: '25P01' }) }),
    }
    const cleanup = vi.fn(async () => {})

    await expect(runPostgresSetupWithCleanup(
      client,
      async () => { throw originalError },
      cleanup,
    )).rejects.toBe(originalError)
    expect(cleanup).toHaveBeenCalledOnce()
  })
})
