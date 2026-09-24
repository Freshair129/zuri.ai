// @req FR-054 — the runtime isolation probe's Postgres suite drops and recreates
//   cluster-global roles, so it runs only against a dedicated loopback database,
//   with an explicit destructive opt-in, on a cluster proven disposable.
// @spec SDD-027, SEC-011, ADR-057 — fail closed before any role mutation.
// @tested tests/unit/fr054-postgres-target-guard.test.js, tests/integration/runtime-isolation-probe.postgres.test.js
//
// Roles are cluster-global: loopback plus a dedicated database name does not
// prove the cluster is disposable (a forwarded or shared local cluster could lose
// the zuri_line_smartgift_* roles other suites and tools rely on). So, like the
// LINE activation suites, it also needs a per-run marker that the connected
// cluster itself must report before any DDL. Enable locally with a disposable
// cluster, e.g.
//   docker run -d --rm --name zuri-fr054-pg -e POSTGRES_HOST_AUTH_METHOD=trust \
//     -e POSTGRES_DB=zuri_fr054_test -p 127.0.0.1:55435:5432 postgres:17-alpine
//   docker exec zuri-fr054-pg psql -U postgres -c \
//     "alter system set zuri.fr054_disposable_cluster = 'fr054-disposable:<uuid v4>'"
//   docker exec zuri-fr054-pg psql -U postgres -c "select pg_reload_conf()"
//   (a server-start `-c` does not qualify: it is not a cluster-level file setting)
//   ZURI_TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:55435/zuri_fr054_test
//   ZURI_FR054_TEST_DESTRUCTIVE_OPT_IN=YES_DROP_FR054_TEST_ROLES
//   ZURI_FR054_TEST_CLUSTER_MARKER=fr054-disposable:<the same uuid>
//
// URL absent => the suite is skipped. URL present => the target, the opt-in and
// the marker are all required, and any one missing fails the run closed.
import { resolveLoopbackPostgresTarget, verifyClusterLevelMarker } from './loopback-postgres-target.js'

export const FR054_DESTRUCTIVE_OPT_IN = 'YES_DROP_FR054_TEST_ROLES'
const MARKER_PATTERN = /^fr054-disposable:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function parseFr054PostgresTarget({ databaseUrl, destructiveOptIn, clusterMarker }) {
  if (!databaseUrl) return { enabled: false }
  const target = resolveLoopbackPostgresTarget(databaseUrl, {
    database: 'zuri_fr054_test',
    errorPrefix: 'RUNTIME_ISOLATION_TEST',
  })
  if (destructiveOptIn !== FR054_DESTRUCTIVE_OPT_IN) {
    throw new Error('RUNTIME_ISOLATION_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')
  }
  if (!MARKER_PATTERN.test(clusterMarker ?? '')) {
    throw new Error('RUNTIME_ISOLATION_TEST_CLUSTER_MARKER_REQUIRED')
  }
  return { enabled: true, databaseUrl: target.databaseUrl, clusterMarker }
}

// Read on the same connection that will run the DDL, before any of it. The
// marker must be set at cluster level (postgresql.conf or ALTER SYSTEM); a
// database, role or session value does not qualify — see verifyClusterLevelMarker.
export async function verifyFr054DisposableClusterMarker(client, expectedMarker) {
  await verifyClusterLevelMarker(client, {
    setting: 'zuri.fr054_disposable_cluster',
    expectedMarker,
    markerPattern: MARKER_PATTERN,
    errorPrefix: 'RUNTIME_ISOLATION_TEST',
  })
}
