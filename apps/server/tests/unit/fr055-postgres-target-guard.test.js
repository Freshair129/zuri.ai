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
    'postgresql://postgres:test@127.0.0.1/zuri_fr055_test',
    'postgresql://postgres:test@localhost/zuri_fr055_test',
    'postgresql://postgres:test@[::1]/zuri_fr055_test',
  ])('accepts exact loopback target only with explicit intent and a per-run marker: %s', (databaseUrl) => {
    expect(parseFr055PostgresTarget({
      databaseUrl,
      destructiveOptIn: DESTRUCTIVE_OPT_IN,
      clusterMarker: marker,
    })).toEqual({ enabled: true, databaseUrl, clusterMarker: marker })
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
