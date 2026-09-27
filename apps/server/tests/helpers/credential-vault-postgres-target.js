// @req FR-223 — the credential vault's Postgres suite resets a whole database and
//   creates cluster roles, so it runs only against a dedicated loopback database
//   with an explicit opt-in, never against anything that might be shared.
// @spec ADR-057 (no production database is ever a test target), SEC-030
// @tested tests/unit/credential-vault-postgres-target.test.js, tests/integration/credential-vault.postgres.test.js
//
// Enable locally with a disposable cluster, e.g.
//   docker run -d --rm --name zuri-vault-lane-pg -e POSTGRES_HOST_AUTH_METHOD=trust \
//     -e POSTGRES_DB=zuri_vault_test -p 127.0.0.1:55433:5432 postgres:17-alpine
//   ZURI_VAULT_TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:55433/zuri_vault_test
//   ZURI_VAULT_TEST_DESTRUCTIVE_OPT_IN=YES_RESET_ZURI_VAULT_TEST_DATABASE
//
// The target is judged the way the driver will resolve it, not by the URL's
// authority: `pg` (pg-connection-string) lets query parameters such as `host`,
// `hostaddr`, `port`, `dbname` or `options` override the authority, and Prisma
// reads connection options from the query too. So a URL carrying ANY query string
// or fragment is refused, the host, port and database are checked on both the
// WHATWG parse and pg's own parse (they must agree), and the suite is handed a
// canonical URL rebuilt from the validated parts — never the string it was given.
import { parse } from 'pg-connection-string'

export const VAULT_TEST_OPT_IN = 'YES_RESET_ZURI_VAULT_TEST_DATABASE'
const VAULT_TEST_DATABASE = 'zuri_vault_test'
const LOOPBACK = ['127.0.0.1', 'localhost', '::1']
const DEFAULT_PORT = '5432'
const RESOLVED_KEYS = new Set(['user', 'password', 'host', 'port', 'database'])

const unbracket = (host) => String(host ?? '').replace(/^\[|\]$/g, '')

export function parseVaultPostgresTarget({ databaseUrl, optIn }) {
  if (!databaseUrl) return { enabled: false }
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('VAULT_TEST_DATABASE_URL_INVALID')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('VAULT_TEST_DATABASE_URL_INVALID')
  // A bare trailing `?` or `#` leaves url.search / url.hash empty, so look at the raw string.
  if (databaseUrl.includes('?') || databaseUrl.includes('#')) {
    throw new Error('VAULT_TEST_DATABASE_URL_OVERRIDES_REFUSED')
  }

  let resolved
  try {
    resolved = parse(databaseUrl)
  } catch {
    throw new Error('VAULT_TEST_DATABASE_URL_INVALID')
  }
  if (Object.keys(resolved).some((key) => !RESOLVED_KEYS.has(key))) {
    throw new Error('VAULT_TEST_DATABASE_URL_OVERRIDES_REFUSED')
  }

  const host = unbracket(url.hostname)
  const port = url.port || DEFAULT_PORT
  const dedicated = LOOPBACK.includes(host)
    && unbracket(resolved.host) === host
    && (resolved.port || DEFAULT_PORT) === port
    && /^\d{1,5}$/.test(port) && Number(port) > 0 && Number(port) <= 65535
    && url.pathname === `/${VAULT_TEST_DATABASE}`
    && resolved.database === VAULT_TEST_DATABASE
  if (!dedicated) throw new Error('VAULT_TEST_DATABASE_MUST_BE_DEDICATED_LOOPBACK')
  if (optIn !== VAULT_TEST_OPT_IN) throw new Error('VAULT_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')

  // url.username / url.password are already percent-encoded; the port is always
  // explicit so a PGPORT in the environment cannot move the target either.
  const userinfo = url.username ? `${url.username}${url.password ? `:${url.password}` : ''}@` : ''
  const authorityHost = host.includes(':') ? `[${host}]` : host
  return {
    enabled: true,
    databaseUrl: `postgresql://${userinfo}${authorityHost}:${port}/${VAULT_TEST_DATABASE}`,
    host,
    port: Number(port),
    database: VAULT_TEST_DATABASE,
  }
}
