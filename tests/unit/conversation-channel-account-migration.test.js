import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

// @req FR-148 — migrations preserve unknown account history and isolate new OA threads.
// @spec ADR-061, BR-001, SEC-001
const root = process.cwd()
const require = createRequire(path.join(root, 'package.json'))
const sqlite = readFileSync(path.join(root, 'prisma/migrations/20260906110000_conversation_channel_account/migration.sql'), 'utf8')
const postgres = readFileSync(path.join(root, 'supabase/migrations/20260906110000_conversation_channel_account.sql'), 'utf8')

describe('conversation account migration', () => {
  it('retains existing IDs and messages in legacy namespace, permits new account collisions', () => {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(':memory:')
    try {
      db.exec(`
        CREATE TABLE "Conversation" ("id" TEXT PRIMARY KEY, "tenantId" TEXT NOT NULL, "businessId" TEXT, "channel" TEXT NOT NULL, "externalThreadId" TEXT NOT NULL);
        CREATE UNIQUE INDEX "Conversation_tenantId_channel_externalThreadId_key" ON "Conversation"("tenantId", "channel", "externalThreadId");
        CREATE TABLE "Message" ("id" TEXT PRIMARY KEY, "conversationId" TEXT REFERENCES "Conversation"("id"), "body" TEXT);
        INSERT INTO "Conversation" VALUES ('old-conversation', 'tenant', 'business', 'LINE', 'thread');
        INSERT INTO "Message" VALUES ('old-message', 'old-conversation', 'preserved');
      `)
      db.exec(sqlite)
      expect(db.prepare('SELECT "channelAccountId" FROM "Conversation" WHERE "id" = ?').get('old-conversation').channelAccountId).toBe('LEGACY:LINE')
      expect(db.prepare('SELECT "conversationId", "body" FROM "Message"').get()).toMatchObject({ conversationId: 'old-conversation', body: 'preserved' })
      const insert = db.prepare('INSERT INTO "Conversation" ("id", "tenantId", "businessId", "channel", "externalThreadId", "channelAccountId") VALUES (?, ?, ?, ?, ?, ?)')
      insert.run('oa-a', 'tenant', 'business', 'LINE', 'thread', 'account-a')
      insert.run('oa-b', 'tenant', 'business', 'LINE', 'thread', 'account-b')
      expect(() => insert.run('duplicate', 'tenant', 'business', 'LINE', 'thread', 'account-a')).toThrow()
      expect(() => insert.run('duplicate-legacy', 'tenant', 'business', 'LINE', 'thread', 'LEGACY:LINE')).toThrow()
      expect(db.prepare('SELECT COUNT(*) n FROM "Conversation"').get().n).toBe(3)
    } finally { db.close() }
  })

  it('ships an explicit public-schema production upgrade without guessing or granting account ownership', () => {
    expect(postgres).toContain('ALTER TABLE public."Conversation" ADD COLUMN IF NOT EXISTS "channelAccountId" TEXT NOT NULL DEFAULT \'LEGACY:LINE\'')
    expect(postgres).toContain('DROP INDEX IF EXISTS public."Conversation_tenantId_channel_externalThreadId_key"')
    expect(postgres).toContain('ON public."Conversation"("tenantId", "channel", "channelAccountId", "externalThreadId")')
    expect(postgres).not.toMatch(/UPDATE\s|GRANT\s|DROP\s+TABLE/i)
    expect(postgres).toContain('BEGIN;')
    expect(postgres).toContain('COMMIT;')
  })
})
