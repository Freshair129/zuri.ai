import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseMigrationColumns, parsePrismaColumns } from '../../scripts/schema-migration-drift.mjs'

// @req FR-109, FR-110 — GenesisRAG17's production schema has the same durable
// source/evidence columns as the local Tier 1 migration and remains private.
// @spec ADR-050, ADR-063, ADR-068, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/unit/genesisrag17-supabase-migration.test.js

const MIGRATION = 'supabase/migrations/20260907160000_genesisrag17_tier1.sql'
const SQLITE_MIGRATION = 'prisma/migrations/20260907150000_genesisrag17_tier1/migration.sql'
const TABLES = [
  'KnowledgeRawArtifact',
  'KnowledgeParsedArtifact',
  'KnowledgeChunk',
  'GenesisRag17Batch',
  'GenesisRag17StageEvidence',
  'GenesisRag17PublicationReceipt',
  'GenesisRag17EvidenceCursor',
]

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')

describe('GenesisRAG17 Supabase migration', () => {
  it('matches the current Postgres and local SQLite model columns exactly', () => {
    const postgres = parseMigrationColumns([{ name: MIGRATION, sql: read(MIGRATION) }])
    const sqlite = parseMigrationColumns([{ name: SQLITE_MIGRATION, sql: read(SQLITE_MIGRATION) }])
    const postgresSchema = parsePrismaColumns(read('prisma/schema.postgres.prisma'))

    for (const table of TABLES) {
      expect([...postgres.get(table)].sort(), `${table} Postgres migration columns`).toEqual([...sqlite.get(table)].sort())
      expect([...postgres.get(table)].sort(), `${table} schema columns`).toEqual([...postgresSchema.get(table)].sort())
    }
  })

  it('forces private runtime access and revokes every public or service role', () => {
    const sql = read(MIGRATION)

    expect(sql).not.toMatch(/\bGRANT\b/i)
    for (const table of TABLES) {
      expect(sql).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`)
      expect(sql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
      expect(sql).toContain(`tablename = '${table}' AND policyname = 'zuri_app_runtime_all'`)
      expect(sql).toContain(`CREATE POLICY zuri_app_runtime_all ON \"${table}\" FOR ALL TO zuri_app_runtime, zuri_web_login USING (true) WITH CHECK (true)`)
      expect(sql).toContain(`REVOKE ALL ON TABLE "${table}" FROM public, anon, authenticated, service_role`)
    }
  })

  it('keeps the three lineage foreign keys restrictive and cascade updates', () => {
    const sql = read(MIGRATION)
    expect(sql).toContain('KnowledgeRawArtifact_rawExternalRecordId_fkey')
    expect(sql).toContain('KnowledgeParsedArtifact_rawArtifactId_fkey')
    expect(sql).toContain('KnowledgeChunk_parsedArtifactId_fkey')
    expect((sql.match(/ON DELETE RESTRICT ON UPDATE CASCADE/g) ?? []).length).toBe(3)
  })
})
