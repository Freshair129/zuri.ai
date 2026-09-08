import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { exportSnapshot, previewSnapshot, importSnapshot } from '@/modules/project-manager/application/backup-service'
import { parseMigrationColumns, parsePrismaColumns } from '../../scripts/schema-migration-drift.mjs'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { makeOperatorViewer } from '../factories/viewer'

// @req FR-173 — additive persistence parity and restore preflight prevent silent loss of corpus membership.
// @spec ADR-072, SEC-001
// @tested tests/integration/knowledge-admission-backup.test.js
const tables = ['KnowledgeCorpus', 'KnowledgeSource', 'KnowledgeIngestion', 'KnowledgeCorpusGeneration']
describe('knowledge admission persistence contract', () => {
  it('executes the additive SQLite migration with foreign keys enabled', () => {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite')
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('PRAGMA foreign_keys=ON')
      db.exec(readFileSync('prisma/migrations/20260908100000_knowledge_admission/migration.sql', 'utf8'))
      expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'Knowledge%'").all()).toHaveLength(4)
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([])
    } finally { db.close() }
  })
  it('matches all SQLite/Postgres columns and restricts PostgreSQL access to runtime roles', () => {
    const read = (file) => readFileSync(file, 'utf8')
    const pgSql = read('supabase/migrations/20260908100000_knowledge_admission.sql')
    const pg = parseMigrationColumns([{ name: 'admission', sql: pgSql }])
    const sqlite = parseMigrationColumns([{ name: 'admission', sql: read('prisma/migrations/20260908100000_knowledge_admission/migration.sql') }])
    const schema = parsePrismaColumns(read('prisma/schema.postgres.prisma'))
    for (const table of tables) {
      expect([...pg.get(table)].sort()).toEqual([...schema.get(table)].sort())
      expect([...sqlite.get(table)].sort()).toEqual([...schema.get(table)].sort())
      expect(pgSql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
      expect(pgSql).toContain(`REVOKE ALL ON TABLE "${table}" FROM public, anon, authenticated, service_role`)
    }
  })

  it('rejects a declared recovery manifest missing any admission table before a restore', async () => {
    const snapshot = await exportSnapshot({ db: prisma })
    expect(snapshot.knowledgeAdmissionRecovery.schemaVersion).toBe('knowledge-admission-recovery.v1')
    for (const table of snapshot.knowledgeAdmissionRecovery.requiredTables) {
      const broken = structuredClone(snapshot)
      delete broken.tables[table]
      const preview = previewSnapshot(broken)
      expect(preview.valid).toBe(false)
      expect(preview.errors).toContain(`Knowledge admission recovery snapshot is missing required table: ${table}`)
    }
  })

  it('restores a populated corpus, source, queued immutable content and manifest in parent order', async () => {
    const key = randomUUID()
    const corpus = await prisma.knowledgeCorpus.create({ data: { corpusKey: key, portfolioId: key, tenantId: key, businessId: key, scopeJson: '{}', policyJson: '{}', generation: 1 } })
    const source = await prisma.knowledgeSource.create({ data: { corpusId: corpus.id, sourceKey: key, kind: 'TEXT', title: 'Backup source', desiredRevision: 1 } })
    const job = await prisma.knowledgeIngestion.create({ data: { corpusId: corpus.id, sourceId: source.id, revision: 1, sourceVersion: '1', contentHash: 'a'.repeat(64), content: 'Immutable backup source', idempotencyKey: key, requestHash: 'b'.repeat(64) } })
    const generation = await prisma.knowledgeCorpusGeneration.create({ data: { corpusId: corpus.id, number: 1, manifestJson: '{"entries":[]}', manifestHash: 'c'.repeat(64) } })
    const snapshot = await exportSnapshot({ db: prisma })
    await prisma.knowledgeIngestion.update({ where: { id: job.id }, data: { status: 'FAILED' } })
    await prisma.knowledgeCorpusGeneration.delete({ where: { id: generation.id } })
    const result = await importSnapshot(snapshot, { db: prisma, viewer: makeOperatorViewer(), confirm: true })
    expect(result.restored).toBe(true)
    expect(await prisma.knowledgeIngestion.findUnique({ where: { id: job.id } })).toMatchObject({ status: 'QUEUED', content: job.content, sourceId: source.id })
    expect(await prisma.knowledgeCorpusGeneration.findUnique({ where: { id: generation.id } })).toMatchObject({ manifestHash: generation.manifestHash, corpusId: corpus.id })
  })
})
