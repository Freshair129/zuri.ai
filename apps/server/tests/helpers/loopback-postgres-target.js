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
