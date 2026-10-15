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
// @req FR-285 — Agent Factory uses the same scoped persistence/rollback suite
// on both isolated SQLite and disposable PostgreSQL; no external DB URL is used.
// @tested tests/integration/agent-business-factory.test.js
// @tested tests/integration/agent-factory-backup.test.js
// @req FR-286 — standard Business provisioning uses the same scope and rollback
// acceptance against the isolated SQLite and disposable PostgreSQL adapters.
// @tested tests/integration/business-provisioning-template.test.js
// @tested tests/integration/business-provisioning-backup.test.js
export default {
  ...base,
  test: {
    ...base.test,
    include: ['tests/integration/conversation-runtime-work-tool-port.test.js', 'tests/integration/line-memory-erasure-due-query.test.js', 'tests/integration/agent-business-factory.test.js', 'tests/integration/agent-factory-backup.test.js', 'tests/integration/business-provisioning-template.test.js', 'tests/integration/business-provisioning-backup.test.js'],
    globalSetup: ['tests/global-setup-postgres.js'],
    hookTimeout: 120000,
  },
}
