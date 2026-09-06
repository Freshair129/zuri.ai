import { workspacePath } from '../../scripts/workspace-path.mjs'
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  evaluateSchemaMigrationDrift,
  normalizeIdentifier,
  parseMigrationColumns,
  parsePrismaColumns,
  stripSqlComments,
} from '../../scripts/schema-migration-drift.mjs'

// @spec scripts/schema-migration-drift.mjs — preflight Check 18 (schema-migration-drift)
//
// On 2026-08-29 a nullable, indexed column was added to RawExternalRecord in
// prisma/schema.prisma with a repository read, a unit suite and a real-database
// integration test — and no migration in either tree. The dev database is
// SQLite under `prisma db push`, so the column existed locally and everything
// passed; production Supabase is migrated only from supabase/migrations/, so
// `GET /api/backup/export` failed there for seven days with "The column
// RawExternalRecord.artifactId does not exist". This file is the regression:
// the parser is proven on the SQL shapes the real migrations use, and the last
// describe block runs the rule against the real schema and the real migration
// directory, then REMOVES the repairing migration and proves the check fires.
//
// NO LITERAL REQUIREMENT ID APPEARS BELOW. scripts/doc-graph.mjs turns any
// `(FR|NFR|BR|SEC|SDD)-\d{3}` token in a test file into a `verifies` edge, so
// quoting real ids as fixture data would credit this test with requirements it
// does not exercise. Column and table names are not ids and appear freely.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const read = (p) => fs.readFileSync(workspacePath(ROOT, p), 'utf8')
const lines = (...ls) => ls.join('\n')

const REPAIR_MIGRATION = '20260906090000_raw_external_record_artifact_id.sql'

function realMigrations() {
  const dir = workspacePath(ROOT, 'supabase', 'migrations')
  return fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8') }))
}

describe('stripSqlComments', () => {
  it('removes line comments and nested block comments, keeping token boundaries', () => {
    const sql = lines(
      'ALTER TABLE "T" -- ADD COLUMN "fromComment" TEXT',
      'ADD COLUMN "real" TEXT; /* outer /* inner */ ALTER TABLE "T" ADD COLUMN "fromBlock" TEXT */',
    )
    const out = stripSqlComments(sql)
    expect(out).not.toMatch(/fromComment|fromBlock/)
    expect(out).toMatch(/ALTER TABLE "T"\s+ADD COLUMN "real" TEXT;/)
  })

  it('blanks string literal content (with doubled-quote escapes) but keeps quoted identifiers', () => {
    const out = stripSqlComments(`COMMENT ON COLUMN "T"."c" IS 'it''s -- not a comment; add column "x"';`)
    expect(out).toBe(`COMMENT ON COLUMN "T"."c" IS '';`)
  })

  it('keeps the DDL inside a dollar-quoted DO block and strips the comments inside it', () => {
    const out = stripSqlComments(lines(
      'DO $$ BEGIN',
      '  -- conditional add',
      '  ALTER TABLE "T" ADD COLUMN IF NOT EXISTS "inDoBlock" TEXT;',
      'END $$;',
    ))
    expect(out).toMatch(/DO \$\$ BEGIN\s+ALTER TABLE "T" ADD COLUMN IF NOT EXISTS "inDoBlock" TEXT;\s+END \$\$;/)
    expect(out).not.toMatch(/conditional add/)
  })
})

describe('normalizeIdentifier', () => {
  it('keeps the case of a quoted identifier and folds an unquoted one', () => {
    expect(normalizeIdentifier('"Tenant"')).toBe('Tenant')
    expect(normalizeIdentifier('Tenant')).toBe('tenant')
  })

  it('drops the schema qualifier, quoted or not', () => {
    expect(normalizeIdentifier('public."Tenant"')).toBe('Tenant')
    expect(normalizeIdentifier('zuri_core.tenant')).toBe('tenant')
    expect(normalizeIdentifier('"zuri_core" . "Tenant"')).toBe('Tenant')
  })
})

describe('parsePrismaColumns', () => {
  const schema = lines(
    'enum Mood {',
    '  HAPPY',
    '}',
    '',
    'model Person {',
    '  id        String   @id @default(uuid())',
    '  tenantId  String',
    '  // artifactId String — a comment is not a field',
    '  nickname  String?',
    '  tags      String[]',
    '  mood      Mood     @default(HAPPY)',
    '  score     Decimal? @db.Decimal(10, 2)',
    '  legacy    String   @ignore',
    '  fullName  String   @map("full_name")',
    '  tenant    Tenant   @relation(fields: [tenantId], references: [id])',
    '  projects  Project[]',
    '  raw       Unsupported("geometry")',
    '',
    '  @@index([tenantId])',
    '  @@map("people")',
    '}',
    '',
    'model Tenant {',
    '  id String @id',
    '}',
  )

  it('lists scalar, enum, optional, list and Unsupported fields as columns and skips relations', () => {
    const models = parsePrismaColumns(schema)
    expect(models.get('people')).toEqual(['id', 'tenantId', 'nickname', 'tags', 'mood', 'score', 'full_name', 'raw'])
    expect(models.get('Tenant')).toEqual(['id'])
    expect(models.has('Person')).toBe(false)
  })

  it('reads the real production schema and finds every model with at least one column', () => {
    const models = parsePrismaColumns(read('prisma/schema.postgres.prisma'))
    expect(models.size).toBeGreaterThan(50)
    for (const [table, columns] of models) expect(columns.length, table).toBeGreaterThan(0)
    expect(models.get('RawExternalRecord')).toContain('artifactId')
    // Relation fields never become columns: the Tenant relation on the record
    // is a field, but only the foreign key is a column.
    expect(models.get('RawExternalRecord')).toContain('tenantId')
    expect(models.get('RawExternalRecord')).not.toContain('tenant')
  })
})

describe('parseMigrationColumns', () => {
  it('reads CREATE TABLE bodies, skipping table constraints and commas inside types', () => {
    const tables = parseMigrationColumns([{ name: 'a.sql', sql: lines(
      'CREATE TABLE IF NOT EXISTS "Widget" (',
      '  "id"     TEXT PRIMARY KEY,',
      '  "amount" NUMERIC(10, 2) NOT NULL,',
      '  "kind"   TEXT CHECK ("kind" IN (\'a\', \'b\')),',
      '  CONSTRAINT "Widget_pkey" PRIMARY KEY ("id"),',
      '  UNIQUE ("kind", "amount"),',
      '  FOREIGN KEY ("id") REFERENCES "Other"("id")',
      ');',
    ) }])
    expect([...tables.get('Widget')]).toEqual(['id', 'amount', 'kind'])
    expect(tables.has('Other')).toBe(false)
  })

  it('reads every ALTER TABLE ... ADD form the migrations use, and not ADD CONSTRAINT', () => {
    const tables = parseMigrationColumns([{ name: 'a.sql', sql: lines(
      'ALTER TABLE "Widget" ADD COLUMN "one" TEXT;',
      'ALTER TABLE "Widget" ADD COLUMN IF NOT EXISTS "two" TEXT;',
      'alter table "Widget" add column if not exists "three" text not null default \'x\';',
      'ALTER TABLE "Widget" ADD "four" TEXT;',
      'ALTER TABLE IF EXISTS ONLY public."Widget"',
      '  ADD COLUMN     "five" TEXT NOT NULL DEFAULT \'{}\',',
      '  ADD COLUMN     "six" TIMESTAMP(3),',
      '  ADD CONSTRAINT "Widget_fk" FOREIGN KEY ("one") REFERENCES "Other"("id");',
    ) }])
    expect([...tables.get('Widget')]).toEqual(['one', 'two', 'three', 'four', 'five', 'six'])
    expect(tables.get('Widget').has('constraint')).toBe(false)
    expect(tables.get('Widget').has('CONSTRAINT')).toBe(false)
  })

  it('finds DDL inside a DO block and applies rename and drop in order', () => {
    const tables = parseMigrationColumns([
      { name: '1.sql', sql: 'CREATE TABLE "Widget" ("id" TEXT, "old" TEXT, "gone" TEXT);' },
      { name: '2.sql', sql: lines(
        'DO $$',
        'BEGIN',
        '  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = \'Widget\' AND column_name = \'added\') THEN',
        '    ALTER TABLE "Widget" ADD COLUMN "added" TEXT;',
        '  END IF;',
        'END $$;',
      ) },
      { name: '3.sql', sql: 'ALTER TABLE "Widget" RENAME COLUMN "old" TO "renamed"; ALTER TABLE "Widget" DROP COLUMN IF EXISTS "gone";' },
    ])
    expect([...tables.get('Widget')].sort()).toEqual(['added', 'id', 'renamed'])
  })

  it('never reads prose in comments or in string literals as DDL', () => {
    const tables = parseMigrationColumns([{ name: 'a.sql', sql: lines(
      'CREATE TABLE "Widget" ("id" TEXT);',
      '-- ALTER TABLE "Widget" ADD COLUMN "fromComment" TEXT;',
      '/* CREATE TABLE "Ghost" ("id" TEXT); */',
      'DO $$ BEGIN EXECUTE \'ALTER TABLE "Widget" ADD COLUMN "fromString" TEXT\'; END $$;',
    ) }])
    expect([...tables.get('Widget')]).toEqual(['id'])
    expect(tables.has('Ghost')).toBe(false)
  })

  it('treats an unquoted name as a different table from a quoted PascalCase one, as Postgres does', () => {
    const tables = parseMigrationColumns([{ name: 'a.sql', sql: lines(
      'create table zuri_core.tenant (id text);',
      'CREATE TABLE "Tenant" ("id" TEXT, "name" TEXT);',
      'DROP TABLE IF EXISTS "Obsolete";',
    ) }])
    expect([...tables.get('tenant')]).toEqual(['id'])
    expect([...tables.get('Tenant')]).toEqual(['id', 'name'])
    expect(tables.has('Obsolete')).toBe(false)
  })
})

describe('evaluateSchemaMigrationDrift', () => {
  const schemaText = lines(
    'model Widget {',
    '  id     String @id',
    '  color  String',
    '  weight Int?',
    '}',
    'model Orphan {',
    '  id String @id',
    '}',
  )
  const migrations = [{ name: 'a.sql', sql: 'CREATE TABLE "Widget" ("id" TEXT PRIMARY KEY, "color" TEXT);' }]

  it('reports every declared column no migration creates, and whole tables separately', () => {
    const drift = evaluateSchemaMigrationDrift({ schemaText, migrations })
    expect(drift.missing.map((m) => m.key)).toEqual(['Widget.weight', 'Orphan.id'])
    expect(drift.missingTables).toEqual(['Orphan'])
    expect(drift.introduced.map((m) => m.key)).toEqual(['Widget.weight', 'Orphan.id'])
    expect(drift.checked).toEqual({ models: 2, columns: 4, migrations: 1 })
  })

  it('accepts baseline entries as known debt, flags the rest, and names repaid entries', () => {
    const drift = evaluateSchemaMigrationDrift({
      schemaText,
      migrations,
      baseline: ['Widget.weight', 'Widget.color'],
    })
    expect(drift.introduced.map((m) => m.key)).toEqual(['Orphan.id'])
    expect(drift.accepted).toEqual(['Widget.weight'])
    expect(drift.repaid).toEqual(['Widget.color'])
  })

  it('is clean once the migration exists', () => {
    const drift = evaluateSchemaMigrationDrift({
      schemaText,
      migrations: [...migrations, { name: 'b.sql', sql: lines(
        'ALTER TABLE "Widget" ADD COLUMN IF NOT EXISTS "weight" INTEGER;',
        'CREATE TABLE IF NOT EXISTS "Orphan" ("id" TEXT PRIMARY KEY);',
      ) }],
    })
    expect(drift.missing).toEqual([])
    expect(drift.missingTables).toEqual([])
  })
})

describe('the real production schema against the real migration directory', () => {
  const schemaText = read('prisma/schema.postgres.prisma')
  const baseline = JSON.parse(read('docs/.schema-migration-baseline.json')).columns

  it('declares no column outside the baseline that no migration creates', () => {
    const drift = evaluateSchemaMigrationDrift({ schemaText, migrations: realMigrations(), baseline })
    expect(drift.introduced.map((m) => m.key)).toEqual([])
  })

  it('lists nothing in the baseline that a migration already creates (the baseline may only shrink)', () => {
    const drift = evaluateSchemaMigrationDrift({ schemaText, migrations: realMigrations(), baseline })
    expect(drift.repaid).toEqual([])
  })

  it('fires when the repairing migration is removed — the 2026-08-29 defect, reintroduced', () => {
    const without = realMigrations().filter((m) => m.name !== REPAIR_MIGRATION)
    expect(without.length).toBe(realMigrations().length - 1)
    const drift = evaluateSchemaMigrationDrift({ schemaText, migrations: without, baseline })
    expect(drift.introduced.map((m) => m.key)).toEqual(['RawExternalRecord.artifactId'])
  })

  it('ships the repairing migration idempotently, with its SQLite twin for local parity', () => {
    const supabase = read(`supabase/migrations/${REPAIR_MIGRATION}`)
    expect(supabase).toMatch(/ALTER TABLE "RawExternalRecord" ADD COLUMN IF NOT EXISTS "artifactId" TEXT;/)
    expect(supabase).toMatch(/CREATE INDEX IF NOT EXISTS "RawExternalRecord_artifactId_idx" ON "RawExternalRecord"\("artifactId"\);/)
    expect(supabase).toMatch(/NOT APPLIED to production/)
    const sqlite = read('prisma/migrations/20260906090000_raw_external_record_artifact_id/migration.sql')
    expect(sqlite).toMatch(/ALTER TABLE "RawExternalRecord" ADD COLUMN "artifactId" TEXT;/)
    expect(sqlite).toMatch(/CREATE INDEX "RawExternalRecord_artifactId_idx" ON "RawExternalRecord"\("artifactId"\);/)
  })
})
