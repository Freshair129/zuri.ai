import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// @req FR-122 — the production migration that adds the Profile's own identity
// fields, and the lane rule that says where such a file belongs. Static
// contract test only: no Supabase CLI is available in this workspace to prove
// it live (RSK-016, Appendix E).
// @spec FR-066, BR-016
// @tested tests/unit/profile-identity-fields-migration.test.js

const POSTGRES_DIR = path.join(process.cwd(), 'prisma', 'postgres')
const MIGRATION_PATH = path.join(
  process.cwd(), 'supabase', 'migrations', '20260829120000_profile_identity_fields.sql',
)

const migrationSql = () => fs.readFileSync(MIGRATION_PATH, 'utf8')

// The executable half only. These files explain themselves at length, and a
// guard that reads the prose reports the explanation of a hazard as the hazard
// — which is exactly what the NOT NULL check did on its first run here.
const migrationStatements = () => migrationSql()
  .split('\n')
  .filter((line) => !line.trimStart().startsWith('--'))
  .join('\n')

describe('FR-122 profile identity fields Supabase migration', () => {
  it('adds the three columns additively, and drops nothing', () => {
    const sql = migrationSql()
    for (const column of ['firstName', 'lastName', 'phone']) {
      expect(sql).toMatch(new RegExp(`alter table "Person" add column if not exists "${column}" text`, 'i'))
    }
    expect(sql).not.toMatch(/drop\s+(?:table|column|constraint|index)/i)
  })

  // The whole design of FR-122 is that the column cannot carry the requirement,
  // because FR-023's LINE ingest creates a Person from a lineUserId alone. A
  // NOT NULL here would make that intake path unwritable, so the absence of one
  // is the thing to hold down — not a detail of how the DDL happens to read.
  it('never makes a column NOT NULL, which would break FR-023 LINE ingest', () => {
    expect(migrationStatements()).not.toMatch(/not\s+null/i)
    // and the reasoning stays in the file, so the next person reads why before
    // deciding the columns look sloppy and "fixing" them.
    expect(migrationSql()).toMatch(/lineUserId/)
  })

  it('never writes the migration ledger from inside the file', () => {
    expect(migrationSql()).not.toMatch(/schema_migrations/i)
  })
})

// The guard that would have caught the mistake this file exists to correct.
// `prisma/postgres/0001_init.sql` is REGENERATED WHOLE by `npm run db:pg:sql`
// (`prisma migrate diff --from-empty`), so a hand-added 0003_/0004_ is not an
// increment on it — it is a second, diverging source of truth that replay would
// apply on top of an init that already contains the same change. Production DDL
// belongs in `supabase/migrations/`, whose filenames map 1:1 with the ledger.
//
// 0002 is the one legitimate hand-written extra: a partial unique index Prisma
// cannot express, so `--from-empty` can never emit it.
describe('prisma/postgres is a regenerated snapshot, not an append-only series', () => {
  it('holds only the regenerated 0001 and the one hand-written 0002', () => {
    const found = fs.readdirSync(POSTGRES_DIR).filter((f) => f.endsWith('.sql')).sort()
    expect(found).toEqual([
      '0001_init.sql',
      '0002_phase1_line_primary_connection.sql',
    ])
  })

  it('keeps the regenerated init in step with the Postgres schema it is generated from', () => {
    const init = fs.readFileSync(path.join(POSTGRES_DIR, '0001_init.sql'), 'utf8')
    const person = init.match(/CREATE TABLE "Person" \(([\s\S]*?)\);/)
    expect(person, 'no Person table in the regenerated init').not.toBeNull()
    // Stale init + current schema is silent: every test runs against SQLite, so
    // only a rebuild from this file would ever notice the columns missing.
    for (const column of ['firstName', 'lastName', 'phone']) {
      expect(person[1], `0001_init.sql is stale — run npm run db:pg:sql`).toContain(`"${column}" TEXT`)
    }
  })
})
