// @req FR-235 — static guarantees of the LineOaAccount.knowledgeGrounding migration.
// @spec ADR-090 D1; ADR-057
// @tested tests/unit/line-oa-knowledge-grounding-migration.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { KNOWLEDGE_GROUNDING_MODES } from '@/lib/validation/enums'

const dir = path.join(process.cwd(), 'supabase', 'migrations')
const [file] = fs.readdirSync(dir).filter((name) => name.endsWith('_line_oa_knowledge_grounding.sql'))
const sql = fs.readFileSync(path.join(dir, file), 'utf8')
const schema = fs.readFileSync(path.join(process.cwd(), 'prisma', 'schema.prisma'), 'utf8')

describe('migration — LineOaAccount.knowledgeGrounding', () => {
  it('exists and is additive, idempotent and unapplied', () => {
    expect(file).toBeTruthy()
    expect(sql).toContain('ALTER TABLE public."LineOaAccount" ADD COLUMN IF NOT EXISTS "knowledgeGrounding" TEXT NOT NULL DEFAULT \'BUSINESS_KNOWLEDGE\'')
    expect(sql).toMatch(/NOT APPLIED to production by this change/)
    // Additive-only: no DROP, no RENAME, and every ALTER TABLE names LineOaAccount.
    expect(sql).not.toMatch(/DROP |RENAME /i)
    const alterLines = sql.split('\n').filter((line) => /^ALTER TABLE/i.test(line.trim()))
    expect(alterLines.length).toBeGreaterThan(0)
    expect(alterLines.every((line) => line.includes('"LineOaAccount"'))).toBe(true)
  })

  it('matches the schema default and the declared column', () => {
    const model = /model LineOaAccount \{([\s\S]*?)\n\}/.exec(schema)[1]
    expect(model).toMatch(/knowledgeGrounding\s+String\s+@default\("BUSINESS_KNOWLEDGE"\)/)
  })

  it('BUSINESS_KNOWLEDGE is the default, and is the first (least-permissive) mode', () => {
    expect(KNOWLEDGE_GROUNDING_MODES[0]).toBe('BUSINESS_KNOWLEDGE')
    expect(sql).toContain("DEFAULT 'BUSINESS_KNOWLEDGE'")
  })
})
