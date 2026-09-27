import base from './vitest.config'

// @req FR-149, FR-150 — the WorkToolPort suite on PostgreSQL, the production
// engine: the SAME test file the default config runs on SQLite, against a
// disposable embedded PostgreSQL that tests/global-setup-postgres.js starts and
// deletes. Run with `npm run test:postgres`. Nothing here reads a database URL
// from the environment, so it can never reach a real or shared database.
// @spec ADR-057
// The group-memory erasure due-selection runs here too: its anti-join is raw SQL.
// @tested tests/integration/conversation-runtime-work-tool-port.test.js
// @tested tests/integration/line-memory-erasure-due-query.test.js
export default {
  ...base,
  test: {
    ...base.test,
    include: ['tests/integration/conversation-runtime-work-tool-port.test.js', 'tests/integration/line-memory-erasure-due-query.test.js'],
    globalSetup: ['tests/global-setup-postgres.js'],
    hookTimeout: 120000,
  },
}
