#!/usr/bin/env node
// Read-only PostgreSQL/Supabase application-runtime preflight.
// It intentionally reports only provider/schema status, never connection material.
//
// @req FR-030 — use the generated PostgreSQL application client for a Postgres runtime.
// @spec ADR-018, ADR-035, SEC-011 — verify the target without mutating it or leaking secrets.
// @tested tests/unit/postgres-runtime-bootstrap.test.js
import { assertDbBoundary } from '../src/lib/db-boundary.js'

const requiredTables = ['Portfolio', 'Tenant', 'Business', 'Workspace', 'Project', 'AuditEvent']
const databaseUrl = process.env.DATABASE_URL || ''

function fail(code, detail) {
  console.error(`[zuri] PostgreSQL runtime verification failed: ${code}`)
  if (detail) console.error(`[zuri] ${detail}`)
  process.exitCode = 1
}

if (!/^(postgres|postgresql):/i.test(databaseUrl)) {
  fail('DATABASE_URL_MUST_BE_POSTGRES', 'Use run-local.bat for the SQLite demo runner.')
} else {
  try {
    assertDbBoundary(process.env)
    const { PrismaClient } = await import('@zuri/prisma-postgres')
    const prisma = new PrismaClient()
    try {
      const rows = await prisma.$queryRawUnsafe(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      )
      const available = new Set(rows.map((row) => String(row.table_name)))
      const missing = requiredTables.filter((table) => !available.has(table))
      if (missing.length > 0) {
        fail('APPLICATION_SCHEMA_INCOMPLETE', `Missing required application tables: ${missing.join(', ')}`)
      } else {
        console.log('[zuri] PostgreSQL runtime verified: application schema is available.')
      }
    } finally {
      await prisma.$disconnect()
    }
  } catch (error) {
    fail(error?.code || 'POSTGRES_RUNTIME_UNAVAILABLE')
  }
}
