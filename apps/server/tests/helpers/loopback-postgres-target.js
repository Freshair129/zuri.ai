// @req FR-054 — the runtime isolation probe's Postgres suite may only reach a dedicated loopback database.
// @req FR-055 — the LINE activation Postgres suites may only reach a dedicated loopback database.
// @spec ADR-057 (no production database is ever a test target), SEC-011, SEC-012
// @tested tests/unit/loopback-postgres-target.test.js
//
// The one resolver behind every destructive PostgreSQL test-target guard that
// uses it. A target is judged the way the driver will resolve it, not by the
// URL's authority: `pg` (pg-connection-string) lets query parameters such as
// `host`, `hostaddr`, `port`, `dbname`, `options` or `service` override the
// authority, and Prisma reads connection options from the query too. So:
//   1. only postgres: / postgresql: URLs are accepted;
//   2. any `?` or `#` in the raw string is refused (a bare trailing `?` leaves
//      URL.search empty, so the raw string is what is checked);
//   3. pg's own parse may yield only user/password/host/port/database, and its
//      host, port and database must agree with the WHATWG parse and name the
//      dedicated database on loopback;
//   4. the caller gets a canonical URL rebuilt from the validated parts, with an
//      explicit port (5432 when omitted, so PGPORT cannot move the target) —
//      never the string it was given.
import { parse } from 'pg-connection-string'

export const LOOPBACK_HOSTS = Object.freeze(['127.0.0.1', 'localhost', '::1'])
const DEFAULT_PORT = '5432'
const RESOLVED_KEYS = new Set(['user', 'password', 'host', 'port', 'database'])

const unbracket = (host) => String(host ?? '').replace(/^\[|\]$/g, '')

export function resolveLoopbackPostgresTarget(databaseUrl, { database, errorPrefix }) {
  const fail = (reason) => { throw new Error(`${errorPrefix}_${reason}`) }
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    fail('DATABASE_URL_INVALID')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail('DATABASE_URL_INVALID')
  if (databaseUrl.includes('?') || databaseUrl.includes('#')) fail('DATABASE_URL_OVERRIDES_REFUSED')

  let resolved
  try {
    resolved = parse(databaseUrl)
  } catch {
    fail('DATABASE_URL_INVALID')
  }
  if (Object.keys(resolved).some((key) => !RESOLVED_KEYS.has(key))) fail('DATABASE_URL_OVERRIDES_REFUSED')

  const host = unbracket(url.hostname)
  const port = url.port || DEFAULT_PORT
  const dedicated = LOOPBACK_HOSTS.includes(host)
    && unbracket(resolved.host) === host
    && (resolved.port || DEFAULT_PORT) === port
    && /^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535
    && url.pathname === `/${database}`
    && resolved.database === database
  if (!dedicated) fail('DATABASE_MUST_BE_DEDICATED_LOOPBACK')

  // url.username / url.password are already percent-encoded.
  const userinfo = url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : ''
  const authorityHost = host.includes(':') ? `[${host}]` : host
  return {
    databaseUrl: `postgresql://${userinfo}${authorityHost}:${port}/${database}`,
    host,
    port: Number(port),
    database,
  }
}

// A per-run marker proves the connected cluster is the disposable one only if
// nothing but a deliberate, cluster-level act on that cluster can produce it.
// A GUC cannot give that proof. Its effective value can come from ALTER DATABASE
// or ALTER ROLE ... SET, SET, or a startup option (PGOPTIONS, which node-postgres
// forwards). And pg_file_settings shows the file, not what the server loaded, so
// a written-but-unreloaded ALTER SYSTEM plus a startup option also passes a
// GUC-based check.
//
// So the marker is a SENTINEL DATABASE whose name carries the per-run uuid,
// e.g. `create database zuri_fr054_disposable_<uuid without dashes>`.
// pg_database is a shared catalog: a row exists there only because someone
// created that database on this cluster, and no session, startup, database, role
// or configuration-file value can make one appear. The lookup is
// schema-qualified down to the operator, so a search_path from PGOPTIONS cannot
// shadow pg_database, count or `=`. It runs on the connection that will run the
// DDL, before any of it; GUCs are not consulted at all.
const UUID_V4 = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const SENTINEL_SQL = `
  select pg_catalog.count(*)::pg_catalog.int4 as matches
  from pg_catalog.pg_database d
  where d.datname OPERATOR(pg_catalog.=) $1::pg_catalog.name
`

export function disposableSentinelDatabase(marker, sentinelPrefix) {
  const uuid = String(marker ?? '').match(UUID_V4)?.[0]
  if (!uuid) throw new Error('DISPOSABLE_SENTINEL_MARKER_INVALID')
  return `${sentinelPrefix}_${uuid.replaceAll('-', '').toLowerCase()}`
}

export async function verifyDisposableClusterSentinel(client, { expectedMarker, markerPattern, sentinelPrefix, errorPrefix }) {
  if (!markerPattern.test(expectedMarker ?? '')) throw new Error(`${errorPrefix}_CLUSTER_MARKER_MISMATCH`)
  const database = disposableSentinelDatabase(expectedMarker, sentinelPrefix)
  const { rows } = await client.query(SENTINEL_SQL, [database])
  if (rows?.[0]?.matches !== 1) throw new Error(`${errorPrefix}_CLUSTER_MARKER_MISMATCH`)
}
