#!/usr/bin/env node
// Guard commands whose schema is canonical SQLite-only.
//
// @req FR-030 — keep SQLite schema mutation separate from the PostgreSQL client.
// @spec ADR-016, ADR-035 — local-only commands fail closed for Postgres URLs.
// @tested tests/unit/postgres-runtime-bootstrap.test.js
const databaseUrl = process.env.DATABASE_URL || ''

if (!/^file:/i.test(databaseUrl)) {
  console.error('[zuri] SQLITE_COMMAND_REQUIRES_FILE_DATABASE_URL')
  console.error('[zuri] Use run-local.bat for local SQLite work; PostgreSQL startup is read-only.')
  process.exit(1)
}

console.log('[zuri] SQLite command target accepted.')
