// @req FR-230, FR-233 — static guarantees of the migration this change ships:
//   Conversation gains three read-model columns, TenantRetentionOverride is
//   created with its FK/RLS/grants, and a pg_trgm index covers Message.body.
// @spec ADR-091 D2, D5; ADR-057
// @tested tests/unit/crm-conversation-retention-migration.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const dir = path.join(process.cwd(), 'supabase', 'migrations')
const [file] = fs.readdirSync(dir).filter((name) => name.endsWith('_crm_conversation_retention_and_search.sql'))
const sql = fs.readFileSync(path.join(dir, file), 'utf8')
const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')

function modelFields(modelName) {
  const body = new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`).exec(schema)[1]
  return body.split('\n')
    .map((line) => /^\s+(\w+)\s+\w/.exec(line)?.[1])
    .filter(Boolean)
    .filter((name) => name !== 'tenant')
}

describe('migration — Conversation retention/search columns, TenantRetentionOverride', () => {
  it('exists, is additive and idempotent, and is unapplied', () => {
    expect(file).toBeTruthy()
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/)
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS/)
    expect(sql).toMatch(/NOT APPLIED to production by this change/)
  })

  it('adds every Conversation column this phase declares, each additive', () => {
    expect(sql).toContain('ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lastMessageAt" TIMESTAMP(3)')
    expect(sql).toContain('ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "lastMessagePreview" TEXT')
    expect(sql).toContain('ALTER TABLE "Conversation" ADD COLUMN IF NOT EXISTS "retentionClass" TEXT NOT NULL DEFAULT \'MESSAGE_BODY_AND_ATTACHMENTS\'')
  })

  it('creates a pg_trgm GIN index over Message.body', () => {
    expect(sql).toMatch(/CREATE EXTENSION IF NOT EXISTS pg_trgm/)
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS "Message_body_trgm_idx" ON "Message" USING gin ("body" gin_trgm_ops)')
  })

  it('creates every column TenantRetentionOverride declares, a unique key, forces RLS, and grants only the runtime roles', () => {
    for (const field of modelFields('TenantRetentionOverride')) expect(sql).toContain(`"${field}"`)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "TenantRetentionOverride"')
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "TenantRetentionOverride_tenantId_dataClass_key"')
    expect(sql).toContain('ALTER TABLE "TenantRetentionOverride" FORCE ROW LEVEL SECURITY')
    expect(sql).toContain('REVOKE ALL ON TABLE "TenantRetentionOverride" FROM public, anon, authenticated, service_role')
    expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "TenantRetentionOverride" TO zuri_app_runtime, zuri_web_login')
  })

  it('declares the cascading foreign key schema.prisma promises, guarded against a pre-existing constraint', () => {
    expect(schema).toMatch(/tenant\s+Tenant\s+@relation\(fields: \[tenantId\], references: \[id\], onDelete: Cascade\)/)
    expect(sql).toContain("SELECT 1 FROM pg_constraint WHERE conname = 'TenantRetentionOverride_tenantId_fkey'")
    expect(sql).toContain('ADD CONSTRAINT "TenantRetentionOverride_tenantId_fkey"')
    expect(sql).toContain('FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE')
  })
})
