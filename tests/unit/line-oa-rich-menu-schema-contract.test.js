// @req FR-151 — rich menu persistence is additive, scoped, versioned, present
//   in both provider schemas, included in recoverable snapshots after the rows
//   it references, and shipped with a private-table production migration in
//   the same change (docs/DB-MIGRATION-NOTES.md §Migration discipline).
// @spec ADR-060 D3; BR-002; SEC-001
// @tested tests/unit/line-oa-rich-menu-schema-contract.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const read = (file) => fs.readFileSync(path.resolve(process.cwd(), file), 'utf8')
const modelBody = (schema, name) => schema.match(new RegExp(`model ${name} \\{[\\s\\S]*?\\n\\}`))?.[0] || ''

describe('FR-151 LineOaRichMenu Prisma, backup and migration contract', () => {
  it('declares both models identically in both provider schemas', () => {
    const sqlite = read('prisma/schema.prisma')
    const postgres = read('prisma/schema.postgres.prisma')
    for (const model of ['LineOaRichMenu', 'LineOaRichMenuVersion']) {
      expect(modelBody(sqlite, model)).not.toBe('')
      expect(modelBody(postgres, model)).toBe(modelBody(sqlite, model))
    }
  })

  it('scopes every row and keys nothing on a LINE identifier', () => {
    const menu = modelBody(read('prisma/schema.prisma'), 'LineOaRichMenu')
    const version = modelBody(read('prisma/schema.prisma'), 'LineOaRichMenuVersion')
    for (const column of ['tenantId', 'businessId', 'lineOaAccountId']) {
      expect(menu).toContain(column)
      expect(version).toContain(column)
    }
    expect(menu).toContain('@@unique([tenantId, code])')
    expect(menu).toContain('@@unique([lineOaAccountId, alias])')
    expect(version).toContain('@@unique([richMenuId, versionNumber])')
    // The external richMenuId is an attribute of a version, never unique or a key.
    expect(version).toMatch(/externalRichMenuId\s+String\?\n/)
    expect(version).not.toMatch(/externalRichMenuId\s+String\?\s+@unique/)
    expect(version).toMatch(/imageFileAssetId\s+String\?/)
    expect(version).toMatch(/onDelete: SetNull/)
  })

  it('is exported by the backup snapshot after the account and the file asset it references', () => {
    const backup = read('src/modules/project-manager/application/backup-service.js')
    const list = backup.slice(backup.indexOf('const SNAPSHOT_MODELS'), backup.indexOf('SNAPSHOT_EXCLUDED_MODELS'))
    expect(list.indexOf("'lineOaAccount'")).toBeLessThan(list.indexOf("'lineOaRichMenu'"))
    expect(list.indexOf("'fileAsset'")).toBeLessThan(list.indexOf("'lineOaRichMenuVersion'"))
    expect(list.indexOf("'lineOaRichMenu'")).toBeLessThan(list.indexOf("'lineOaRichMenuVersion'"))
  })

  it('ships additive migrations for both databases without destructive operations', () => {
    const local = fs.readdirSync(path.resolve(process.cwd(), 'prisma/migrations')).find((name) => name.includes('line_oa_rich_menu'))
    expect(local).toBeTruthy()
    const localSql = read(`prisma/migrations/${local}/migration.sql`)
    expect(localSql).toContain('CREATE TABLE "LineOaRichMenu"')
    expect(localSql).toContain('CREATE TABLE "LineOaRichMenuVersion"')
    expect(localSql).not.toMatch(/DROP\s+(TABLE|COLUMN)|ALTER\s+TABLE/i)

    const production = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).find((name) => name.includes('line_oa_rich_menu'))
    expect(production).toBeTruthy()
    const productionSql = read(`supabase/migrations/${production}`)
    for (const table of ['LineOaRichMenu', 'LineOaRichMenuVersion']) {
      expect(productionSql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`)
      expect(productionSql).toContain(`ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY`)
      expect(productionSql).toContain(`REVOKE ALL ON TABLE "${table}" FROM public, anon, authenticated, service_role`)
    }
    expect(productionSql).toMatch(/NOT APPLIED/)
    expect(productionSql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
  })

  it('names the closed vocabularies once, in enums.js', () => {
    const enums = read('src/lib/validation/enums.js')
    expect(enums).toMatch(/LINE_OA_RICH_MENU_LAYOUTS = \['1x1', '2x1', '2x2', '2x3', '3x1', '1x2'\]/)
    expect(enums).toMatch(/LINE_OA_RICH_MENU_VERSION_STATUSES = \['DRAFT', 'FROZEN', 'PUBLISHED', 'RETIRED'\]/)
    expect(enums).toMatch(/LINE_OA_RICH_MENU_ACTION_TYPES = \['MESSAGE', 'POSTBACK', 'URI', 'LIFF', 'RICHMENU_SWITCH'\]/)
  })
})
