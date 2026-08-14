// @req FR-055 — guard cluster-global test DDL with target, intent and disposable-cluster proof.
// @spec NFR-013, BR-014, SDD-028, SEC-012 — fail closed before any role mutation.
// @tested tests/unit/fr055-postgres-target-guard.test.js, tests/integration/line-binding-activation.postgres.test.js

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

function normalizedHostname(hostname) {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname
}

export function parseFr055PostgresTarget({ databaseUrl, destructiveOptIn, clusterMarker }) {
  if (!databaseUrl) return { enabled: false }

  let target
  try {
    target = new URL(databaseUrl)
  } catch {
    throw new Error('LINE_ACTIVATION_TEST_DATABASE_URL_INVALID')
  }
  const hostname = normalizedHostname(target.hostname)
  const isLoopback = ['127.0.0.1', 'localhost', '::1'].includes(hostname)
  if (!isLoopback || target.pathname !== '/zuri_fr055_test') {
    throw new Error('LINE_ACTIVATION_TEST_DATABASE_MUST_BE_DEDICATED_LOOPBACK')
  }
  if (destructiveOptIn !== DESTRUCTIVE_OPT_IN) {
    throw new Error('LINE_ACTIVATION_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')
  }
  if (!MARKER_PATTERN.test(clusterMarker ?? '')) {
    throw new Error('LINE_ACTIVATION_TEST_CLUSTER_MARKER_REQUIRED')
  }
  return { enabled: true, databaseUrl, clusterMarker }
}

export async function verifyDisposableClusterMarker(client, expectedMarker) {
  const { rows } = await client.query(
    "select current_setting('zuri.fr055_disposable_cluster', true) as marker",
  )
  if (rows?.[0]?.marker !== expectedMarker) {
    throw new Error('LINE_ACTIVATION_TEST_CLUSTER_MARKER_MISMATCH')
  }
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
