import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

// @req FR-023 — the LINE conversation/message external id namespace is tenant-scoped.
// @spec BR-001, BR-002, SEC-001 — Tenant is the isolation boundary; an external id is
//   envelope data, never a key.
//
// `npm test` provisions its database with `prisma db push`, which applies the SCHEMA
// and never runs a migration file. So the suite proves the new constraints work while
// proving nothing about the SQL that has to get an EXISTING database from the old
// shape to the new one — which is the only part that can fail in a deployed
// environment. This applies the real migration file to a database built in the old
// shape and checks the outcome.

const ROOT = path.resolve(__dirname, '..', '..')
// vitest 2.x strips the node: prefix from static imports and then cannot resolve a
// bare "sqlite"; resolving at call time keeps it out of Vite's static analysis
// (same reason as tests/global-setup.js).
const nodeRequire = createRequire(path.join(ROOT, 'package.json'))

const MIGRATION = path.join(
  ROOT, 'prisma', 'migrations', '20260819120000_scope_external_ids_by_tenant', 'migration.sql',
)
const SUPABASE_MIGRATION = path.join(
  ROOT, 'supabase', 'migrations', '20260819120000_scope_external_ids_by_tenant.sql',
)

/** A database in the pre-migration shape: the two tables with GLOBAL unique indexes. */
function databaseInOldShape() {
  const { DatabaseSync } = nodeRequire('node:sqlite')
  const db = new DatabaseSync(':memory:')
  db.exec(`
    CREATE TABLE "Conversation" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "tenantId" TEXT NOT NULL,
      "customerId" TEXT NOT NULL,
      "channel" TEXT NOT NULL,
      "externalThreadId" TEXT NOT NULL
    );
    CREATE UNIQUE INDEX "Conversation_externalThreadId_key" ON "Conversation"("externalThreadId");
    CREATE TABLE "Message" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "conversationId" TEXT NOT NULL,
      "direction" TEXT NOT NULL,
      "body" TEXT NOT NULL,
      "externalMessageId" TEXT
    );
    CREATE UNIQUE INDEX "Message_externalMessageId_key" ON "Message"("externalMessageId");
  `)
  return db
}

const indexNames = (db) => db
  .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'")
  .all()
  .map((row) => row.name)
  .sort()

const insertConversation = (db, id, tenantId, channel, threadId) => db
  .prepare('INSERT INTO "Conversation" VALUES (?, ?, ?, ?, ?)')
  .run(id, tenantId, `cust-${id}`, channel, threadId)

const insertMessage = (db, id, conversationId, externalMessageId) => db
  .prepare('INSERT INTO "Message" VALUES (?, ?, ?, ?, ?)')
  .run(id, conversationId, 'INBOUND', 'body', externalMessageId)

describe('20260819120000_scope_external_ids_by_tenant', () => {
  it('applies cleanly to a database that already holds rows', () => {
    const db = databaseInOldShape()
    // pre-existing data, globally unique as the old constraints required
    insertConversation(db, 'conv-1', 'tenant-a', 'LINE', 'U-thread-1')
    insertMessage(db, 'msg-1', 'conv-1', 'M-1')
    insertMessage(db, 'msg-2', 'conv-1', null)

    expect(() => db.exec(readFileSync(MIGRATION, 'utf8'))).not.toThrow()

    // the rows survive — this migration rewrites indexes, never data
    expect(db.prepare('SELECT COUNT(*) AS n FROM "Conversation"').get().n).toBe(1)
    expect(db.prepare('SELECT COUNT(*) AS n FROM "Message"').get().n).toBe(2)
  })

  it('replaces the global uniques with the scoped ones', () => {
    const db = databaseInOldShape()
    expect(indexNames(db)).toEqual([
      'Conversation_externalThreadId_key',
      'Message_externalMessageId_key',
    ])

    db.exec(readFileSync(MIGRATION, 'utf8'))

    expect(indexNames(db)).toEqual([
      'Conversation_tenantId_channel_externalThreadId_key',
      'Message_conversationId_externalMessageId_key',
    ])
  })

  it('lets two tenants hold the same thread id afterwards, and not before', () => {
    const db = databaseInOldShape()
    insertConversation(db, 'conv-a', 'tenant-a', 'LINE', 'U-shared')
    // the defect this migration exists to remove
    expect(() => insertConversation(db, 'conv-b', 'tenant-b', 'LINE', 'U-shared')).toThrow()

    db.exec(readFileSync(MIGRATION, 'utf8'))

    expect(() => insertConversation(db, 'conv-b', 'tenant-b', 'LINE', 'U-shared')).not.toThrow()
    // and the same tenant still cannot duplicate its own thread on the same channel
    expect(() => insertConversation(db, 'conv-c', 'tenant-a', 'LINE', 'U-shared')).toThrow()
    // while a different channel in that tenant may reuse the id
    expect(() => insertConversation(db, 'conv-d', 'tenant-a', 'WEB', 'U-shared')).not.toThrow()
  })

  it('lets two conversations hold the same provider message id afterwards', () => {
    const db = databaseInOldShape()
    insertConversation(db, 'conv-a', 'tenant-a', 'LINE', 'U-a')
    insertConversation(db, 'conv-b', 'tenant-b', 'LINE', 'U-b')
    insertMessage(db, 'msg-a', 'conv-a', 'M-shared')
    expect(() => insertMessage(db, 'msg-b', 'conv-b', 'M-shared')).toThrow()

    db.exec(readFileSync(MIGRATION, 'utf8'))

    expect(() => insertMessage(db, 'msg-b', 'conv-b', 'M-shared')).not.toThrow()
    // redelivery inside one conversation is still refused by the database
    expect(() => insertMessage(db, 'msg-c', 'conv-a', 'M-shared')).toThrow()
    // and NULL never conflicts, so unkeyed messages still coexist
    expect(() => {
      insertMessage(db, 'msg-d', 'conv-a', null)
      insertMessage(db, 'msg-e', 'conv-a', null)
    }).not.toThrow()
  })

  it('ships the same index change to Supabase', () => {
    const supabase = readFileSync(SUPABASE_MIGRATION, 'utf8')
    for (const statement of [
      'DROP INDEX "Conversation_externalThreadId_key"',
      'CREATE UNIQUE INDEX "Conversation_tenantId_channel_externalThreadId_key"',
      'DROP INDEX "Message_externalMessageId_key"',
      'CREATE UNIQUE INDEX "Message_conversationId_externalMessageId_key"',
    ]) {
      expect(supabase).toContain(statement)
    }
  })

  it('matches the indexes the generated Postgres schema declares', () => {
    const generated = readFileSync(path.join(ROOT, 'prisma', 'postgres', '0001_init.sql'), 'utf8')
    expect(generated).toContain('"Conversation_tenantId_channel_externalThreadId_key"')
    expect(generated).toContain('"Message_conversationId_externalMessageId_key"')
    // a fresh database must never be created with the constraints we just removed
    expect(generated).not.toContain('"Conversation_externalThreadId_key"')
    expect(generated).not.toContain('"Message_externalMessageId_key"')
  })
})
