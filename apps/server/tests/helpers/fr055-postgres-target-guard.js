// @req FR-055 — guard cluster-global test DDL with target, intent and disposable-cluster proof.
// @spec NFR-013, BR-014, SDD-028, SEC-012 — fail closed before any role mutation.
// @tested tests/unit/fr055-postgres-target-guard.test.js, tests/integration/line-binding-activation.postgres.test.js, tests/integration/controlled-line-activation.postgres.test.js
import { resolveLoopbackPostgresTarget, verifyDisposableClusterSentinel } from './loopback-postgres-target.js'

export const DESTRUCTIVE_OPT_IN = 'YES_DROP_FR055_TEST_ROLES'
export const FR055_FIXED_TEST_ROLES = Object.freeze([
  'zuri_line_activation_login',
  'zuri_line_activation_operator',
  'zuri_line_smartgift_login',
  'zuri_line_smartgift_ro',
  'zuri_app_runtime',
])
export const FR055_API_ROLES = Object.freeze(['anon', 'authenticated', 'service_role'])
export const FR055_TOUCHED_ROLES = Object.freeze([...FR055_FIXED_TEST_ROLES, ...FR055_API_ROLES])
const MARKER_PATTERN = /^fr055-w4-disposable:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

// The target itself is resolved by the shared loopback resolver: any query string
// or fragment is refused (pg lets ?host= / ?hostaddr= / ?port= / ?dbname= /
// ?options= override the authority), host, port and database are checked on pg's
// own parse, and the suite is handed the canonical URL, never the input.
export function parseFr055PostgresTarget({ databaseUrl, destructiveOptIn, clusterMarker }) {
  if (!databaseUrl) return { enabled: false }

  const target = resolveLoopbackPostgresTarget(databaseUrl, {
    database: 'zuri_fr055_test',
    errorPrefix: 'LINE_ACTIVATION_TEST',
  })
  if (destructiveOptIn !== DESTRUCTIVE_OPT_IN) {
    throw new Error('LINE_ACTIVATION_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')
  }
  if (!MARKER_PATTERN.test(clusterMarker ?? '')) {
    throw new Error('LINE_ACTIVATION_TEST_CLUSTER_MARKER_REQUIRED')
  }
  return { enabled: true, databaseUrl: target.databaseUrl, clusterMarker }
}

// The per-run marker is proven by a sentinel database on the connected cluster,
// read on the connection that will run the DDL, before any of it — see
// verifyDisposableClusterSentinel. On the disposable cluster:
//   create database zuri_fr055_disposable_<uuid v4 without dashes>
//   ZURI_FR055_TEST_CLUSTER_MARKER=fr055-w4-disposable:<the same uuid, with dashes>
export const FR055_SENTINEL_PREFIX = 'zuri_fr055_disposable'

export async function verifyDisposableClusterMarker(client, expectedMarker) {
  await verifyDisposableClusterSentinel(client, {
    expectedMarker,
    markerPattern: MARKER_PATTERN,
    sentinelPrefix: FR055_SENTINEL_PREFIX,
    errorPrefix: 'LINE_ACTIVATION_TEST',
  })
}

export function rolesCreatedByTest(preexistingRoles, currentRoles) {
  return new Set([...currentRoles].filter((role) => !preexistingRoles.has(role)))
}

export async function runPostgresSetupWithCleanup(client, setup, cleanup) {
  try {
    return await setup()
  } catch (originalError) {
    const recoveryFailures = []
    try {
      await client.query('rollback')
    } catch (rollbackError) {
      if (rollbackError?.code !== '25P01') recoveryFailures.push(rollbackError)
    }
    try {
      await cleanup()
    } catch (cleanupError) {
      recoveryFailures.push(cleanupError)
    }
    if (recoveryFailures.length > 0 && originalError && typeof originalError === 'object') {
      Object.defineProperty(originalError, 'recoveryFailures', {
        configurable: true,
        enumerable: false,
        value: recoveryFailures,
      })
    }
    throw originalError
  }
}

export async function cleanupFr055DatabaseTestChanges(client, preexistingRoles, ddlStarted) {
  if (ddlStarted) await client.query('drop schema if exists zuri_core cascade')
  const { rows } = await client.query(
    'select rolname from pg_roles where rolname = any($1::text[])',
    [FR055_TOUCHED_ROLES],
  )
  const currentRoles = new Set(rows.map(({ rolname }) => rolname))
  const createdRoles = rolesCreatedByTest(preexistingRoles, currentRoles)
  if (createdRoles.has('zuri_line_activation_operator')
    && createdRoles.has('zuri_line_activation_login')) {
    await client.query('revoke zuri_line_activation_operator from zuri_line_activation_login')
  }
  if (createdRoles.has('zuri_line_smartgift_ro')
    && createdRoles.has('zuri_line_smartgift_login')) {
    await client.query('revoke zuri_line_smartgift_ro from zuri_line_smartgift_login')
  }
  for (const role of [
    'zuri_line_activation_login',
    'zuri_line_activation_operator',
    'zuri_line_smartgift_login',
    'zuri_line_smartgift_ro',
    'zuri_app_runtime',
    'service_role',
    'authenticated',
    'anon',
  ]) {
    if (createdRoles.has(role)) await client.query(`drop role ${role}`)
  }
}
