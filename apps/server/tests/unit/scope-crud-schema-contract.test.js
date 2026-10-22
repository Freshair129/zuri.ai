import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'
import pg from 'pg'
import { startEmbeddedPostgres } from '../helpers/embedded-postgres'

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')

function modelBody(schema, model) {
  return schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`))?.[0] || ''
}

// @req FR-001 — scope rows retain archive state and version history.
// @spec ADR-018 — production schema changes are additive and migrated separately.
// @tested tests/unit/scope-crud-schema-contract.test.js

describe('FR-001 scope CRUD schema contract', () => {
  it('declares Portfolio archive state and version counters for all mutable scopes in both schemas', () => {
    const schemas = [read('prisma/schema.prisma'), read('prisma/schema.postgres.prisma')]
    for (const schema of schemas) {
      expect(modelBody(schema, 'Portfolio')).toMatch(/^\s*status\s+String\s+@default\("ACTIVE"\)/m)
      expect(modelBody(schema, 'Portfolio')).toMatch(/^\s*version\s+Int\s+@default\(1\)/m)
      expect(modelBody(schema, 'Tenant')).toMatch(/^\s*version\s+Int\s+@default\(1\)/m)
      expect(modelBody(schema, 'Business')).toMatch(/^\s*version\s+Int\s+@default\(1\)/m)
      expect(modelBody(schema, 'LegalEntity')).toMatch(/^\s*version\s+Int\s+@default\(1\)/m)
      expect(modelBody(schema, 'Branch')).toMatch(/^\s*version\s+Int\s+@default\(1\)/m)
    }
  })

  it('ships idempotent production and local migration twins without destructive operations', () => {
    const supabase = read('supabase/migrations/20261023090000_scope_crud_metadata.sql')
    const local = read('prisma/migrations/20261023090000_scope_crud_metadata/migration.sql')
    expect(supabase).toMatch(/ALTER TABLE public\."Portfolio"\s+ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'ACTIVE'/)
    expect(supabase).toMatch(/ALTER TABLE public\."LegalEntity"\s+ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1/)
    expect(supabase).toMatch(/ALTER TABLE public\."Branch"\s+ADD COLUMN IF NOT EXISTS "version" INTEGER NOT NULL DEFAULT 1/)
    for (const sql of [supabase, local]) expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)|TRUNCATE\s+TABLE/i)
    expect(local).toContain('ALTER TABLE "Portfolio" ADD COLUMN "status" TEXT NOT NULL DEFAULT \'ACTIVE\'')
    expect(local).toContain('ALTER TABLE "LegalEntity" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1')
    expect(local).toContain('ALTER TABLE "Branch" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1')
  })
})

it('scope metadata migration preserves existing SQLite rows and supplies defaults for old and new rows', () => {
  const { DatabaseSync } = createRequire(path.resolve(process.cwd(), 'package.json'))('node:sqlite')
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`
      CREATE TABLE Portfolio (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE LegalEntity (id TEXT PRIMARY KEY, legalName TEXT NOT NULL);
      CREATE TABLE Branch (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      INSERT INTO Portfolio VALUES ('portfolio-old', 'Original portfolio');
      INSERT INTO LegalEntity VALUES ('entity-old', 'Original legal entity');
      INSERT INTO Branch VALUES ('branch-old', 'Original branch');
    `)
    db.exec(read('prisma/migrations/20261023090000_scope_crud_metadata/migration.sql'))
    expect({ ...db.prepare('SELECT * FROM Portfolio').get() }).toEqual(
      { id: 'portfolio-old', name: 'Original portfolio', status: 'ACTIVE' })
    expect({ ...db.prepare('SELECT * FROM LegalEntity').get() }).toEqual(
      { id: 'entity-old', legalName: 'Original legal entity', version: 1 })
    expect({ ...db.prepare('SELECT * FROM Branch').get() }).toEqual(
      { id: 'branch-old', name: 'Original branch', version: 1 })
    db.exec(`
      INSERT INTO Portfolio (id, name) VALUES ('portfolio-new', 'New portfolio');
      INSERT INTO LegalEntity (id, legalName) VALUES ('entity-new', 'New legal entity');
      INSERT INTO Branch (id, name) VALUES ('branch-new', 'New branch');
    `)
    expect(db.prepare("SELECT status FROM Portfolio WHERE id='portfolio-new'").get().status).toBe('ACTIVE')
    expect(db.prepare("SELECT version FROM LegalEntity WHERE id='entity-new'").get().version).toBe(1)
    expect(db.prepare("SELECT version FROM Branch WHERE id='branch-new'").get().version).toBe(1)
  } finally {
    db.close()
  }
})

it('production scope migration preserves existing PostgreSQL rows and can be reapplied safely', async () => {
  const server = await startEmbeddedPostgres({ label: 'scope-migration', database: 'scope_migration_test' })
  const client = new pg.Client({ connectionString: server.url, query_timeout: 15000 })
  try {
    await client.connect()
    await client.query(`
      CREATE TABLE "Portfolio" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      CREATE TABLE "LegalEntity" (id TEXT PRIMARY KEY, "legalName" TEXT NOT NULL);
      CREATE TABLE "Branch" (id TEXT PRIMARY KEY, name TEXT NOT NULL);
      INSERT INTO "Portfolio" VALUES ('portfolio-old', 'Original portfolio');
      INSERT INTO "LegalEntity" VALUES ('entity-old', 'Original legal entity');
      INSERT INTO "Branch" VALUES ('branch-old', 'Original branch');
    `)
    const migration = read('supabase/migrations/20261023090000_scope_crud_metadata.sql')
    await client.query(migration)
    await client.query(migration)
    expect((await client.query('SELECT * FROM "Portfolio"')).rows).toEqual([
      { id: 'portfolio-old', name: 'Original portfolio', status: 'ACTIVE' },
    ])
    expect((await client.query('SELECT * FROM "LegalEntity"')).rows).toEqual([
      { id: 'entity-old', legalName: 'Original legal entity', version: 1 },
    ])
    expect((await client.query('SELECT * FROM "Branch"')).rows).toEqual([
      { id: 'branch-old', name: 'Original branch', version: 1 },
    ])
    await client.query(`
      INSERT INTO "Portfolio" (id, name) VALUES ('portfolio-new', 'New portfolio');
      INSERT INTO "LegalEntity" (id, "legalName") VALUES ('entity-new', 'New entity');
      INSERT INTO "Branch" (id, name) VALUES ('branch-new', 'New branch');
    `)
    expect((await client.query('SELECT status FROM "Portfolio" WHERE id=$1', ['portfolio-new'])).rows[0].status).toBe('ACTIVE')
    expect((await client.query('SELECT version FROM "LegalEntity" WHERE id=$1', ['entity-new'])).rows[0].version).toBe(1)
    expect((await client.query('SELECT version FROM "Branch" WHERE id=$1', ['branch-new'])).rows[0].version).toBe(1)
  } finally {
    try { await client.end() } finally { await server.stop() }
  }
}, 120000)
