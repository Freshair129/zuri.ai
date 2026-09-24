// @req FR-054 — the runtime isolation probe's Postgres suite drops and recreates
//   cluster-global roles, so it runs only against a dedicated loopback database
//   with an explicit destructive opt-in.
// @spec SDD-027, SEC-011, ADR-057 — fail closed before any role mutation.
// @tested tests/unit/fr054-postgres-target-guard.test.js, tests/integration/runtime-isolation-probe.postgres.test.js
//
// Enable locally with a disposable cluster, e.g.
//   docker run -d --rm --name zuri-fr054-pg -e POSTGRES_HOST_AUTH_METHOD=trust \
//     -e POSTGRES_DB=zuri_fr054_test -p 127.0.0.1:55435:5432 postgres:17-alpine
//   ZURI_TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:55435/zuri_fr054_test
//   ZURI_FR054_TEST_DESTRUCTIVE_OPT_IN=YES_DROP_FR054_TEST_ROLES
import { resolveLoopbackPostgresTarget } from './loopback-postgres-target.js'

export const FR054_DESTRUCTIVE_OPT_IN = 'YES_DROP_FR054_TEST_ROLES'

export function parseFr054PostgresTarget({ databaseUrl, destructiveOptIn }) {
  if (!databaseUrl) return { enabled: false }
  const target = resolveLoopbackPostgresTarget(databaseUrl, {
    database: 'zuri_fr054_test',
    errorPrefix: 'RUNTIME_ISOLATION_TEST',
  })
  if (destructiveOptIn !== FR054_DESTRUCTIVE_OPT_IN) {
    throw new Error('RUNTIME_ISOLATION_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')
  }
  return { enabled: true, databaseUrl: target.databaseUrl }
}
