const { PrismaClient } = require('@prisma/client')
const { e2eTarget } = require('./e2e-target')

// @req FR-046 — the isolated e2e SQLite authority must not turn concurrent
// browser reads and writes into 5-second busy timeouts.
// @spec ADR-017, SDD-024
// @tested tests/unit/playwright-database-bootstrap.test.js
//
// Why this exists (nightly run 44471173249): a page load fires one write
// transaction (progress cache refresh, signup, ...) beside several multi-
// statement read transactions. In SQLite's default rollback-journal mode a
// writer cannot commit while any reader holds SHARED, and a PENDING writer
// blocks every new reader, so a reader that needs a second pooled connection
// (or any request queued behind it) waits out Prisma's 5 s busy timeout and the
// request fails with 500/503. Every request of the page, static chunks
// included, then queues behind the six hanging connections, which is how a
// 1 s test became a 10 s `toBeVisible` failure. Write-ahead logging lets readers
// and the single writer proceed together; writers still serialize.
//
// The journal mode is stored in the database file, so setting it once after the
// seed applies to every connection the server and the specs open afterwards.
// Production runs on Postgres and the unit/integration databases are untouched.

async function enableWal(databaseUrl = e2eTarget().databaseUrl) {
  const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } })
  try {
    const rows = await db.$queryRawUnsafe('PRAGMA journal_mode=WAL')
    const mode = String(rows?.[0]?.journal_mode ?? '').toLowerCase()
    if (mode !== 'wal') throw new Error(`E2E_SQLITE_WAL_NOT_ENABLED:${mode || 'unknown'}`)
    return mode
  } finally {
    await db.$disconnect()
  }
}

if (require.main === module) {
  enableWal().catch((error) => { console.error(error); process.exit(1) })
}

module.exports = { enableWal }
