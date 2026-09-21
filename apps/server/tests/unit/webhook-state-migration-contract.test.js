// @req FR-227 — the account stores only LINE-reported webhook health, never
//   channel credentials or access tokens.
// @spec ADR-057 D2, D3, D6; ADR-089 D7; SEC-030
// @tested tests/unit/webhook-state-migration-contract.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')

function executableSql(sql) {
  return sql
    .replace(/--[^\r\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:''|[^'])*'/g, "''")
    .replace(/\s+/g, ' ')
    .trim()
}

describe('FR-227 production webhook-state migration contract', () => {
  it('keeps the production schema and migration field in parity', () => {
    const sqliteSchema = read('prisma/schema.prisma')
    const postgresSchema = read('prisma/schema.postgres.prisma')
    expect(sqliteSchema).toMatch(/model LineOaAccount \{[\s\S]*webhookStateJson\s+String\?[\s\S]*\}/)
    expect(postgresSchema).toMatch(/model LineOaAccount \{[\s\S]*webhookStateJson\s+String\?[\s\S]*\}/)

    const directory = path.resolve(process.cwd(), 'supabase/migrations')
    const names = fs.readdirSync(directory).filter((name) => name.endsWith('_line_oa_webhook_state.sql'))
    expect(names).toEqual(['20260914150300_line_oa_webhook_state.sql'])

    const sql = read(`supabase/migrations/${names[0]}`)
    const ddl = executableSql(sql)
    expect(ddl).toMatch(/^BEGIN; ALTER TABLE public\."LineOaAccount" ADD COLUMN IF NOT EXISTS "webhookStateJson" TEXT;/i)
    expect(ddl).toMatch(/COMMENT ON COLUMN public\."LineOaAccount"\."webhookStateJson" IS '';/i)
    expect(ddl).toMatch(/COMMIT;$/i)
    expect(sql).toMatch(/NOT APPLIED to production/i)
    expect(ddl).not.toMatch(/\b(?:DROP|INSERT|UPDATE|DELETE|GRANT|REVOKE|CREATE\s+TABLE)\b/i)
    expect(ddl).not.toMatch(/\b(?:secret|token|credential)\b/i)
  })
})
