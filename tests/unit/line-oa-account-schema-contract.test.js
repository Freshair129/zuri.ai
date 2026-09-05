// @req FR-146 — LineOaAccount persistence is additive, scoped, versioned,
//   present in both provider schemas, included in recoverable snapshots and
//   shipped with a private-table production migration.
// @spec ADR-060 D2, D3; BR-002; SEC-001
// @tested tests/unit/line-oa-account-schema-contract.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
const modelBody = (schema) => schema.match(/model LineOaAccount \{[\s\S]*?\n\}/)?.[0] || ''

describe('FR-146 LineOaAccount Prisma, backup and migration contract', () => {
  it('declares the model identically in both provider schemas', () => {
    const sqlite = read('prisma/schema.prisma')
    const postgres = read('prisma/schema.postgres.prisma')
    expect(modelBody(sqlite)).not.toBe('')
    expect(modelBody(postgres)).toBe(modelBody(sqlite))
  })

  it('carries scope, references and identity rules as columns and constraints', () => {
    const body = modelBody(read('prisma/schema.prisma'))
    for (const column of ['tenantId', 'businessId', 'integrationConnectionId', 'bindingCode', 'transportMode', 'isDefaultForBusiness', 'archivedAt', 'version']) {
      expect(body).toContain(column)
    }
    // One account per connection, one code per Tenant, one binding per Tenant.
    expect(body).toMatch(/integrationConnectionId\s+String\s+@unique/)
    expect(body).toContain('@@unique([tenantId, code])')
    expect(body).toContain('@@unique([tenantId, bindingCode])')
    // LINE identifiers are attributes, never keys: no unique on basicId.
    expect(body).not.toMatch(/basicId\s+String\?\s+@unique/)
    // No credential column of any kind lives on the account.
    expect(body).not.toMatch(/secret|token|accessToken|channelSecret/i)
  })

  it('is exported by the backup snapshot after the connection it references', () => {
    const backup = read('src/modules/project-manager/application/backup-service.js')
    const list = backup.slice(backup.indexOf('const SNAPSHOT_MODELS'), backup.indexOf('SNAPSHOT_EXCLUDED_MODELS'))
    expect(list).toMatch(/['"]lineOaAccount['"]/)
    expect(list.indexOf("'integrationConnection'")).toBeLessThan(list.indexOf("'lineOaAccount'"))
    expect(list.indexOf("'business'")).toBeLessThan(list.indexOf("'lineOaAccount'"))
  })

  it('ships additive migrations for both databases without destructive operations', () => {
    const local = fs.readdirSync(path.resolve(process.cwd(), 'prisma/migrations')).find((name) => name.includes('line_oa_account'))
    expect(local).toBeTruthy()
    const localSql = read(`prisma/migrations/${local}/migration.sql`)
    expect(localSql).toContain('CREATE TABLE "LineOaAccount"')
    expect(localSql).not.toMatch(/DROP\s+(TABLE|COLUMN)|ALTER\s+TABLE\s+"(?!LineOaAccount")/i)

    const production = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).find((name) => name.includes('line_oa_account'))
    expect(production).toBeTruthy()
    const productionSql = read(`supabase/migrations/${production}`)
    expect(productionSql).toContain('CREATE TABLE IF NOT EXISTS "LineOaAccount"')
    expect(productionSql).toContain('FORCE ROW LEVEL SECURITY')
    expect(productionSql).toContain('REVOKE ALL ON TABLE "LineOaAccount" FROM public, anon, authenticated, service_role')
    expect(productionSql).toMatch(/NOT APPLIED/)
    expect(productionSql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
  })

  it('names the closed vocabularies once, in enums.js', () => {
    const enums = read('src/lib/validation/enums.js')
    expect(enums).toMatch(/LINE_OA_ACCOUNT_STATUSES = \['DRAFT', 'CONNECTED', 'PAUSED', 'ARCHIVED'\]/)
    expect(enums).toMatch(/LINE_OA_TRANSPORT_MODES = \['EDGE', 'CLOUD'\]/)
  })
})
