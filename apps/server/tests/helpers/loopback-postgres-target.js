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

// A per-run cluster marker proves the connected cluster is the disposable one
// only if it is set at CLUSTER level. current_setting() alone is not enough:
// PostgreSQL also takes a value from ALTER DATABASE ... SET, ALTER ROLE ... SET,
// connection options or SET, so a database on a shared cluster could satisfy it
// while the suite drops cluster-global roles. Custom (placeholder) settings are
// not listed in pg_settings, so their source cannot be read there. Instead:
//   - the marker must be the applied value in pg_file_settings, i.e. set in
//     postgresql.conf or by ALTER SYSTEM (a server-start `-c` is not listed there
//     and does not qualify);
//   - the effective value must equal it, so no other source overrides it;
//   - pg_db_role_setting may hold no entry for the setting at all.
// pg_file_settings is readable only by superusers or pg_read_all_settings; an
// unreadable view throws, which also fails closed. Everything is read on the
// connection that will run the DDL.
const CLUSTER_MARKER_SQL = `
  select
    current_setting($1, true) as effective,
    (
      select f.setting from pg_file_settings f
      where lower(f.name) = lower($1) and f.applied and f.error is null
      order by f.seqno desc limit 1
    ) as file_value,
    exists (
      select 1 from pg_db_role_setting s
      cross join lateral unnest(s.setconfig) as c(entry)
      where lower(split_part(c.entry, '=', 1)) = lower($1)
    ) as has_db_role_override
`

export async function verifyClusterLevelMarker(client, { setting, expectedMarker, markerPattern, errorPrefix }) {
  if (!markerPattern.test(expectedMarker ?? '')) throw new Error(`${errorPrefix}_CLUSTER_MARKER_MISMATCH`)
  const { rows } = await client.query(CLUSTER_MARKER_SQL, [setting])
  const row = rows?.[0] ?? {}
  if (row.effective !== expectedMarker) throw new Error(`${errorPrefix}_CLUSTER_MARKER_MISMATCH`)
  if (row.file_value !== expectedMarker || row.has_db_role_override !== false) {
    throw new Error(`${errorPrefix}_CLUSTER_MARKER_NOT_CLUSTER_LEVEL`)
  }
}
