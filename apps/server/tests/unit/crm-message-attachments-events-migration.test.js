// @req FR-229 — static guarantees of design migration 5 (CRM part): Message gains
//   contentKind, MessageAttachment and ConversationEvent are created, RLS-forced,
//   granted only to the runtime roles, and unapplied.
// @spec ADR-091 D5; ADR-057
// @tested tests/unit/crm-message-attachments-events-migration.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = path.join(process.cwd(), 'supabase', 'migrations')
const [file] = fs.readdirSync(dir).filter((name) => name.endsWith('_crm_message_attachments_events.sql'))
const sql = fs.readFileSync(path.join(dir, file), 'utf8')
const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')

function modelFields(modelName) {
  const body = new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`).exec(schema)[1]
  return body.split('\n')
    .map((line) => /^\s+(\w+)\s+\w/.exec(line)?.[1])
    .filter(Boolean)
    // Relation fields (Conversation/Message/Model[]) have no column of their own.
    .filter((name) => !['message', 'conversation', 'session'].includes(name))
    // FR-243 — `sessionId` arrives in a later migration (20260916090000_crm_conversation_sessions),
    // whose own test (crm-conversation-sessions-migration.test.js) checks it; this file
    // guards only what migration 5 created.
    .filter((name) => name !== 'sessionId')
}

describe('migration 5 (CRM part) — Message.contentKind, MessageAttachment, ConversationEvent', () => {
  it('exists, is additive and idempotent, and is unapplied', () => {
    expect(file).toBeTruthy()
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/)
    expect(sql).toMatch(/NOT APPLIED to production by this change/)
  })

  it('adds Message.contentKind with a TEXT default so every existing row stays TEXT', () => {
    expect(sql).toContain('ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "contentKind" TEXT NOT NULL DEFAULT \'TEXT\'')
  })

  it('creates every column MessageAttachment declares, forces RLS, and grants only the runtime roles', () => {
    for (const field of modelFields('MessageAttachment')) expect(sql).toContain(`"${field}"`)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "MessageAttachment"')
    expect(sql).toContain('ALTER TABLE "MessageAttachment" FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON TABLE "MessageAttachment" FROM public, anon, authenticated, service_role')
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "MessageAttachment" TO zuri_app_runtime, zuri_web_login')
  })

  it('creates every column ConversationEvent declares, a unique idempotency key, forces RLS, and grants only the runtime roles', () => {
    for (const field of modelFields('ConversationEvent')) expect(sql).toContain(`"${field}"`)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "ConversationEvent"')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ConversationEvent_conversationId_externalEventId_key"')
    expect(sql).toContain('ALTER TABLE "ConversationEvent" FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON TABLE "ConversationEvent" FROM public, anon, authenticated, service_role')
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ConversationEvent" TO zuri_app_runtime, zuri_web_login')
  })

  // schema.prisma declares onDelete: Cascade on both relations; SQLite's `prisma
  // db push` gives tests that cascade for free, so only a check against the
  // migration text itself catches a Postgres deployment left without it.
  it('declares the same cascading foreign keys schema.prisma promises, guarded against a pre-existing constraint', () => {
    expect(schema).toMatch(/message\s+Message\s+@relation\(fields: \[messageId\], references: \[id\], onDelete: Cascade\)/)
    expect(schema).toMatch(/conversation\s+Conversation\s+@relation\(fields: \[conversationId\], references: \[id\], onDelete: Cascade\)/)

    expect(sql).toContain("SELECT 1 FROM pg_constraint WHERE conname = 'MessageAttachment_messageId_fkey'")
    expect(sql).toContain('ADD CONSTRAINT "MessageAttachment_messageId_fkey"')
    expect(sql).toContain('FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE')

    expect(sql).toContain("SELECT 1 FROM pg_constraint WHERE conname = 'ConversationEvent_conversationId_fkey'")
    expect(sql).toContain('ADD CONSTRAINT "ConversationEvent_conversationId_fkey"')
    expect(sql).toContain('FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE')
  })
})
