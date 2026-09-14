import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// @req FR-236 — the KnowledgeCandidate migration exists in both trees, is
//   additive-only and creates the exact FKs the Prisma model declares with
//   cascade (Tenant/Business) versus SetNull (Conversation, nullable) —
//   the "house pattern" this repository's lessons ask a new relation-with-
//   cascade to be checked against.
// @spec ADR-090 D6, D8; ADR-057 (not applied by this test or this change)
const root = process.cwd()
const require = createRequire(path.join(root, 'package.json'))
const sqlite = readFileSync(path.join(root, 'prisma/migrations/20260914150200_knowledge_candidate/migration.sql'), 'utf8')
const postgres = readFileSync(path.join(root, 'supabase/migrations/20260914150200_knowledge_candidate.sql'), 'utf8')

describe('KnowledgeCandidate migration (FR-236)', () => {
  it('creates the table with its FKs against a real SQLite engine', () => {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(':memory:')
    try {
      db.exec('PRAGMA foreign_keys = ON;')
      db.exec(`
        CREATE TABLE "Tenant" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "Business" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "Conversation" ("id" TEXT PRIMARY KEY);
        INSERT INTO "Tenant" VALUES ('t-1');
        INSERT INTO "Business" VALUES ('b-1');
        INSERT INTO "Conversation" VALUES ('c-1');
      `)
      db.exec(sqlite)

      const insert = db.prepare(`
        INSERT INTO "KnowledgeCandidate"
          ("id","tenantId","businessId","conversationId","sourceRefJson","question","answer","contentHash","consentStatusAtDraft","idempotencyKey","requestHash","updatedAt")
        VALUES (?,?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      `)
      insert.run('kc-1', 't-1', 'b-1', 'c-1', '{"conversationId":"c-1","messageIds":[]}', 'Q', 'A', 'hash', 'GRANTED', 'idem-1', 'req-1')

      const row = db.prepare('SELECT * FROM "KnowledgeCandidate" WHERE "id" = ?').get('kc-1')
      expect(row).toMatchObject({ status: 'PENDING_REVIEW', version: 1, conversationId: 'c-1' })

      // A deleted Conversation clears the reference (ON DELETE SET NULL) —
      // erasure withdraws the source without deleting the candidate row
      // (ADR-072 D11: GKS/this row's history cannot be deleted outright).
      db.exec('DELETE FROM "Conversation" WHERE "id" = \'c-1\'')
      expect(db.prepare('SELECT "conversationId" FROM "KnowledgeCandidate" WHERE "id" = ?').get('kc-1').conversationId).toBeNull()

      // Deleting the owning Business cascades (Business is the write scope).
      db.exec('DELETE FROM "Business" WHERE "id" = \'b-1\'')
      expect(db.prepare('SELECT COUNT(*) n FROM "KnowledgeCandidate"').get().n).toBe(0)
    } finally {
      db.close()
    }
  })

  it('rejects a second candidate with the same (businessId, idempotencyKey)', () => {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(`
        CREATE TABLE "Tenant" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "Business" ("id" TEXT PRIMARY KEY);
        CREATE TABLE "Conversation" ("id" TEXT PRIMARY KEY);
        INSERT INTO "Tenant" VALUES ('t-1');
        INSERT INTO "Business" VALUES ('b-1');
      `)
      db.exec(sqlite)
      const insert = db.prepare(`
        INSERT INTO "KnowledgeCandidate"
          ("id","tenantId","businessId","sourceRefJson","question","answer","contentHash","consentStatusAtDraft","idempotencyKey","requestHash","updatedAt")
        VALUES (?,?,?,?,?,?,?,?,?,?,CURRENT_TIMESTAMP)
      `)
      insert.run('kc-1', 't-1', 'b-1', '{}', 'Q', 'A', 'hash', 'GRANTED', 'same-key', 'req-1')
      expect(() => insert.run('kc-2', 't-1', 'b-1', '{}', 'Q2', 'A2', 'hash2', 'GRANTED', 'same-key', 'req-2')).toThrow()
    } finally {
      db.close()
    }
  })

  it('ships an additive, idempotent Postgres migration with the same FK shape (twin of the SQLite tree)', () => {
    expect(postgres).toContain('CREATE TABLE IF NOT EXISTS "KnowledgeCandidate"')
    expect(postgres).toContain('"tenantId"             TEXT NOT NULL REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE')
    expect(postgres).toContain('"businessId"           TEXT NOT NULL REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE')
    expect(postgres).toContain('"conversationId"       TEXT REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE')
    expect(postgres).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "KnowledgeCandidate_businessId_idempotencyKey_key"')
    expect(postgres).toContain('ENABLE ROW LEVEL SECURITY')
    expect(postgres).toContain('FORCE ROW LEVEL SECURITY')
    expect(postgres).toContain('REVOKE ALL ON TABLE "KnowledgeCandidate" FROM public, anon, authenticated, service_role')
    expect(postgres).toContain('BEGIN;')
    expect(postgres).toContain('COMMIT;')
    // Additive only — no destructive or data-mutating statement anywhere.
    // (The FK columns legitimately carry "ON UPDATE CASCADE"; only a DML
    // UPDATE targeting a table, at the start of a statement, would matter here.)
    expect(postgres).not.toMatch(/^\s*UPDATE\s+"|DROP\s+TABLE|TRUNCATE/im)
  })
})
