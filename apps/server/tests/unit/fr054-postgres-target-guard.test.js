import { describe, expect, it, vi } from 'vitest'
import {
  FR054_DESTRUCTIVE_OPT_IN,
  parseFr054PostgresTarget,
  verifyFr054DisposableClusterMarker,
} from '../helpers/fr054-postgres-target-guard.js'

// @req FR-054 — prevent the isolation-probe suite from mutating roles anywhere but a disposable cluster.
// @spec SDD-027, SEC-011, ADR-057 — canonical loopback target, explicit destructive intent and a per-run cluster marker.
// @tested tests/unit/fr054-postgres-target-guard.test.js

const BASE = 'postgresql://postgres@127.0.0.1:55435/zuri_fr054_test'
const marker = 'fr054-disposable:11111111-1111-4111-8111-111111111111'
const guard = (databaseUrl, destructiveOptIn = FR054_DESTRUCTIVE_OPT_IN, clusterMarker = marker) =>
  () => parseFr054PostgresTarget({ databaseUrl, destructiveOptIn, clusterMarker })

describe('FR-054 runtime isolation PostgreSQL target guard', () => {
  it('skips the suite when no database URL is provided, whatever else is set', () => {
    expect(parseFr054PostgresTarget({})).toEqual({ enabled: false })
    expect(parseFr054PostgresTarget({ destructiveOptIn: FR054_DESTRUCTIVE_OPT_IN, clusterMarker: marker }))
      .toEqual({ enabled: false })
  })

  it.each([
    [BASE, BASE],
    ['postgresql://postgres@localhost/zuri_fr054_test', 'postgresql://postgres@localhost:5432/zuri_fr054_test'],
    // The old inline guard compared the bracketed hostname and so refused IPv6 loopback.
    ['postgresql://postgres@[::1]:55435/zuri_fr054_test', 'postgresql://postgres@[::1]:55435/zuri_fr054_test'],
  ])('accepts the dedicated loopback database with opt-in and marker: %s', (databaseUrl, canonical) => {
    expect(parseFr054PostgresTarget({ databaseUrl, destructiveOptIn: FR054_DESTRUCTIVE_OPT_IN, clusterMarker: marker }))
      .toEqual({ enabled: true, databaseUrl: canonical, clusterMarker: marker })
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
    expect(guard(databaseUrl)).toThrow('RUNTIME_ISOLATION_TEST_DATABASE_URL_OVERRIDES_REFUSED')
  })

  it.each([
    ['remote host', 'postgresql://postgres@db.example.com/zuri_fr054_test'],
    ['loopback in userinfo, remote host', 'postgresql://127.0.0.1:5432@db.example.com/zuri_fr054_test'],
    ['wrong database', 'postgresql://postgres@127.0.0.1:55435/postgres'],
  ])('refuses a target that is not the dedicated loopback database: %s', (_label, databaseUrl) => {
    expect(guard(databaseUrl)).toThrow('RUNTIME_ISOLATION_TEST_DATABASE_MUST_BE_DEDICATED_LOOPBACK')
  })

  it('fails closed when the URL is present without the exact destructive opt-in', () => {
    expect(() => parseFr054PostgresTarget({ databaseUrl: BASE, clusterMarker: marker }))
      .toThrow('RUNTIME_ISOLATION_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')
    expect(guard(BASE, 'yes')).toThrow('RUNTIME_ISOLATION_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')
  })

  it.each([
    ['missing', undefined],
    ['generic', 'disposable'],
    ['marker of another suite', 'fr055-w4-disposable:11111111-1111-4111-8111-111111111111'],
    ['non-v4 uuid', 'fr054-disposable:11111111-1111-1111-8111-111111111111'],
  ])('fails closed when the URL is present without a per-run cluster marker: %s', (_label, clusterMarker) => {
    expect(() => parseFr054PostgresTarget({ databaseUrl: BASE, destructiveOptIn: FR054_DESTRUCTIVE_OPT_IN, clusterMarker }))
      .toThrow('RUNTIME_ISOLATION_TEST_CLUSTER_MARKER_REQUIRED')
  })

  it('checks the target before the opt-in and marker, so an override is refused even without them', () => {
    expect(() => parseFr054PostgresTarget({ databaseUrl: `${BASE}?host=db.example.com` }))
      .toThrow('RUNTIME_ISOLATION_TEST_DATABASE_URL_OVERRIDES_REFUSED')
  })

  it('verifies the exact cluster-level marker on the connection before DDL', async () => {
    const query = vi.fn(async () => ({ rows: [{ effective: marker, file_value: marker, has_db_role_override: false }] }))
    await expect(verifyFr054DisposableClusterMarker({ query }, marker)).resolves.toBeUndefined()
    expect(query).toHaveBeenCalledWith(expect.stringContaining('pg_file_settings'), ['zuri.fr054_disposable_cluster'])
  })

  it.each([
    ['absent on the cluster', { effective: null, file_value: null, has_db_role_override: false }, marker, 'MISMATCH'],
    ['different on the cluster', { effective: `${marker}-other`, file_value: `${marker}-other`, has_db_role_override: false }, marker, 'MISMATCH'],
    ['expected marker missing', { effective: null, file_value: null, has_db_role_override: false }, undefined, 'MISMATCH'],
    ['expected marker malformed, cluster agrees', { effective: 'x', file_value: 'x', has_db_role_override: false }, 'x', 'MISMATCH'],
    ['set only per database, role or session', { effective: marker, file_value: null, has_db_role_override: false }, marker, 'NOT_CLUSTER_LEVEL'],
    ['also overridden in pg_db_role_setting', { effective: marker, file_value: marker, has_db_role_override: true }, marker, 'NOT_CLUSTER_LEVEL'],
  ])('fails closed when the connected cluster marker is %s', async (_label, row, expected, reason) => {
    const query = vi.fn(async () => ({ rows: [row] }))
    await expect(verifyFr054DisposableClusterMarker({ query }, expected))
      .rejects.toThrow(`RUNTIME_ISOLATION_TEST_CLUSTER_MARKER_${reason}`)
  })
})
