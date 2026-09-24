// @req FR-165, FR-163, FR-164 — the SCM race suite resets a whole database, so it
//   runs only against a dedicated loopback database with an explicit opt-in,
//   never against anything that might be shared.
// @spec ADR-057 (no production database is ever a test target)
// @tested tests/integration/scm-legacy-races.postgres.test.js
//
// Enable locally with any disposable PostgreSQL on loopback, e.g.
//   ZURI_SCM_RACE_TEST_POSTGRES_URL=postgresql://user@127.0.0.1:55434/zuri_scm_race_test
//   ZURI_SCM_RACE_TEST_DESTRUCTIVE_OPT_IN=YES_RESET_ZURI_SCM_RACE_TEST_DATABASE
//
// The target is judged the way the driver will resolve it, not by the URL's
// authority: `pg` (pg-connection-string) lets query parameters such as `host`,
// `hostaddr` or `port` override the authority, and Prisma reads connection
// options from the query too. So a URL with ANY query string is refused, and the
// host and database are then checked on the driver's own parse — a loopback-looking
// URL can never point the destructive reset somewhere else.
import { parse } from 'pg-connection-string'

export const SCM_RACE_TEST_OPT_IN = 'YES_RESET_ZURI_SCM_RACE_TEST_DATABASE'
const LOOPBACK = ['127.0.0.1', 'localhost', '::1']

export function parseScmRacePostgresTarget({ databaseUrl, optIn }) {
  if (!databaseUrl) return { enabled: false }
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('SCM_RACE_TEST_DATABASE_URL_INVALID')
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('SCM_RACE_TEST_DATABASE_URL_INVALID')
  if (url.search || url.hash) throw new Error('SCM_RACE_TEST_DATABASE_URL_OVERRIDES_REFUSED')
  const resolved = parse(databaseUrl)
  const hosts = [url.hostname, resolved.host].map((host) => String(host ?? '').replace(/^\[|\]$/g, ''))
  if (!hosts.every((host) => LOOPBACK.includes(host)) || resolved.database !== 'zuri_scm_race_test' || url.pathname !== '/zuri_scm_race_test') {
    throw new Error('SCM_RACE_TEST_DATABASE_MUST_BE_DEDICATED_LOOPBACK')
  }
  if (optIn !== SCM_RACE_TEST_OPT_IN) throw new Error('SCM_RACE_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')
  return { enabled: true, databaseUrl }
}
