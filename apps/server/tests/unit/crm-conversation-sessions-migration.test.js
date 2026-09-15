// @req FR-243 — static guarantees of the session migration: ConversationSession is
//   created with every declared column, its keys, foreign keys, forced RLS and
//   runtime-only grants; Message and ConversationEvent gain a nullable sessionId
//   that is set to NULL when a session is deleted; LineOaAccount gains a bounded
//   idle timeout defaulting to 30. Additive, idempotent and unapplied.
// @spec ADR-094 D1–D3; SDD-102; ADR-057
// @tested tests/unit/crm-conversation-sessions-migration.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = path.join(process.cwd(), 'supabase', 'migrations')
const [file] = fs.readdirSync(dir).filter((name) => name.endsWith('_crm_conversation_sessions.sql'))
const sql = fs.readFileSync(path.join(dir, file), 'utf8')
const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')

function modelFields(modelName) {
  const body = new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`).exec(schema)[1]
  return body.split('\n')
    .map((line) => /^\s+(\w+)\s+(String|Int|DateTime|Boolean)\b/.exec(line)?.[1])
    .filter(Boolean)
}

describe('migration — conversation sessions', () => {
  it('exists, is additive and idempotent, and is unapplied', () => {
    expect(file).toBeTruthy()
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS "ConversationSession"/)
    expect(sql).toMatch(/NOT APPLIED to production by this change/)
    expect(sql).not.toMatch(/DROP (TABLE|COLUMN)/i)
  })

  it('creates every scalar column ConversationSession declares, with its keys', () => {
    for (const field of modelFields('ConversationSession')) expect(sql).toContain(`"${field}"`)
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "ConversationSession_tenantId_code_key" ON "ConversationSession"("tenantId", "code")')
    expect(sql).toContain('REFERENCES "Conversation"("id") ON DELETE CASCADE')
  })

  it('adds a nullable, indexed sessionId to Message and ConversationEvent that is cleared when its session goes', () => {
    for (const table of ['Message', 'ConversationEvent']) {
      expect(sql).toContain(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "sessionId" TEXT;`)
      expect(sql).toContain(`CREATE INDEX IF NOT EXISTS "${table}_sessionId_idx" ON "${table}"("sessionId")`)
      expect(sql).toContain(`"${table}_sessionId_fkey"`)
    }
    expect(sql.match(/REFERENCES "ConversationSession"\("id"\) ON DELETE SET NULL/g)).toHaveLength(2)
  })

  it('gives LineOaAccount a 30-minute default idle timeout bounded to 10–120', () => {
    expect(sql).toContain('ALTER TABLE "LineOaAccount" ADD COLUMN IF NOT EXISTS "sessionIdleTimeoutMinutes" INTEGER NOT NULL DEFAULT 30')
    expect(sql).toContain('CHECK ("sessionIdleTimeoutMinutes" BETWEEN 10 AND 120)')
    expect(schema).toMatch(/sessionIdleTimeoutMinutes Int\s+@default\(30\)/)
  })

  it('forces row-level security and grants only the runtime roles', () => {
    expect(sql).toContain('ALTER TABLE "ConversationSession" FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON TABLE "ConversationSession" FROM public, anon, authenticated, service_role')
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "ConversationSession" TO zuri_app_runtime, zuri_web_login')
  })
})
