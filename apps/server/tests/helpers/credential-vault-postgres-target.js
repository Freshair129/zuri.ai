// @req FR-223 — the credential vault's Postgres suite resets a whole database and
//   creates cluster roles, so it runs only against a dedicated loopback database
//   with an explicit opt-in, never against anything that might be shared.
// @spec ADR-057 (no production database is ever a test target), SEC-030
// @tested tests/integration/credential-vault.postgres.test.js
//
// Enable locally with a disposable cluster, e.g.
//   docker run -d --rm --name zuri-vault-lane-pg -e POSTGRES_HOST_AUTH_METHOD=trust \
//     -e POSTGRES_DB=zuri_vault_test -p 127.0.0.1:55433:5432 postgres:17-alpine
//   ZURI_VAULT_TEST_POSTGRES_URL=postgresql://postgres@127.0.0.1:55433/zuri_vault_test
//   ZURI_VAULT_TEST_DESTRUCTIVE_OPT_IN=YES_RESET_ZURI_VAULT_TEST_DATABASE

export const VAULT_TEST_OPT_IN = 'YES_RESET_ZURI_VAULT_TEST_DATABASE'

export function parseVaultPostgresTarget({ databaseUrl, optIn }) {
  if (!databaseUrl) return { enabled: false }
  let url
  try {
    url = new URL(databaseUrl)
  } catch {
    throw new Error('VAULT_TEST_DATABASE_URL_INVALID')
  }
  const host = url.hostname.replace(/^\[|\]$/g, '')
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || url.pathname !== '/zuri_vault_test') {
    throw new Error('VAULT_TEST_DATABASE_MUST_BE_DEDICATED_LOOPBACK')
  }
  if (optIn !== VAULT_TEST_OPT_IN) throw new Error('VAULT_TEST_DESTRUCTIVE_OPT_IN_REQUIRED')
  return { enabled: true, databaseUrl }
}
