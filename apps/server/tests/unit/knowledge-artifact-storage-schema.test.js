// @req FR-109, FR-173 — storage references and operation journals exist in
// both local and Postgres schemas with additive migration coverage.
// @spec TASK-ZAI-049 storage spec, ADR-072
// @tested prisma/schema.prisma, prisma/schema.postgres.prisma,
//         prisma/migrations/20260917153000_knowledge_artifact_storage/migration.sql,
//         supabase/migrations/20260917153000_knowledge_artifact_storage.sql
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(path, 'utf8')
const sqlite = read('prisma/schema.prisma')
const postgres = read('prisma/schema.postgres.prisma')
const sqliteMigration = read('prisma/migrations/20260917153000_knowledge_artifact_storage/migration.sql')
const postgresMigration = read('supabase/migrations/20260917153000_knowledge_artifact_storage.sql')

describe('TASK-ZAI-049 storage schema', () => {
  it('declares the same storage models and exact-version fields in both Prisma providers', () => {
    for (const schema of [sqlite, postgres]) {
      expect(schema).toContain('model KnowledgeArtifactStorage')
      expect(schema).toContain('model KnowledgeArtifactOperation')
      expect(schema).toContain('rawArtifactId   String   @unique')
      expect(schema).toContain('objectVersionId String?')
      expect(schema).toContain('retentionUntil  DateTime?')
      expect(schema).toContain('storageArtifact   KnowledgeArtifactStorage?')
    }
  })

  it('ships additive local/Postgres migrations with private tables, RLS and no destructive SQL', () => {
    for (const migration of [sqliteMigration, postgresMigration]) {
      expect(migration).toContain('KnowledgeArtifactStorage')
      expect(migration).toContain('KnowledgeArtifactOperation')
      expect(migration).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i)
    }
    expect(postgresMigration).toMatch(/FORCE ROW LEVEL SECURITY/i)
    expect(postgresMigration).toMatch(/REVOKE ALL ON TABLE "KnowledgeArtifactStorage" FROM public, anon, authenticated, service_role/i)
    expect(postgresMigration).toMatch(/REVOKE ALL ON TABLE "KnowledgeArtifactOperation" FROM public, anon, authenticated, service_role/i)
    expect(sqliteMigration).toMatch(/ON DELETE RESTRICT/i)
    expect(sqliteMigration).toMatch(/KnowledgeArtifactStorage_rawArtifactId_key/i)
  })
})
