// @req FR-153 — what the LIFF registry routes are, in source terms: they
//   resolve a browser viewer on every method, stay thin, are inventoried for
//   OpenAPI; the model is in both schemas, snapshotted after its account, and
//   migrated in both trees in the same change.
// @spec ADR-060 D11; SEC-001; FR-061; docs/DB-MIGRATION-NOTES.md §Migration discipline
// @tested tests/unit/line-oa-liff-app-routes.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_API_ROUTE_INVENTORY } from '@/modules/project-manager/api-docs/openapi'

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const COLLECTION = 'src/app/api/line-oa/liff-apps/route.js'
const ITEM = 'src/app/api/line-oa/liff-apps/[id]/route.js'

describe('FR-153 LIFF registry route and persistence contract', () => {
  it('lists and registers on the collection, reads and acts on the item, never deletes', () => {
    const collection = read(COLLECTION)
    expect(collection).toMatch(/export async function GET/)
    expect(collection).toMatch(/export async function POST/)
    const item = read(ITEM)
    expect(item).toMatch(/export async function GET/)
    expect(item).toMatch(/export async function PATCH/)
    expect(item).not.toMatch(/export async function DELETE/)
    for (const file of [COLLECTION, ITEM]) {
      const source = read(file)
      expect(source).toMatch(/resolveRequestViewer/)
      expect(source).toMatch(/@req FR-153/)
      expect(source).not.toMatch(/@\/lib\/db|prisma\./)
    }
  })

  it('is inventoried for the OpenAPI document', () => {
    const paths = Object.fromEntries(CURRENT_API_ROUTE_INVENTORY)
    expect(paths['/api/line-oa/liff-apps']).toEqual(['GET', 'POST'])
    expect(paths['/api/line-oa/liff-apps/{id}']).toEqual(['GET', 'PATCH'])
  })

  it('declares the model identically in both schemas, keys nothing on the liffId, and snapshots it after its account', () => {
    const body = (schema) => schema.match(/model LineOaLiffApp \{[\s\S]*?\n\}/)?.[0] || ''
    const sqlite = read('prisma/schema.prisma')
    expect(body(sqlite)).not.toBe('')
    expect(body(read('prisma/schema.postgres.prisma'))).toBe(body(sqlite))
    expect(body(sqlite)).toContain('@@unique([tenantId, code])')
    expect(body(sqlite)).toContain('@@unique([lineOaAccountId, externalLiffId])')
    expect(body(sqlite)).toMatch(/externalLiffId\s+String\?\n/)
    expect(body(sqlite)).not.toMatch(/secret|token/i)
    const backup = read('src/modules/project-manager/application/backup-service.js')
    const list = backup.slice(backup.indexOf('const SNAPSHOT_MODELS'), backup.indexOf('SNAPSHOT_EXCLUDED_MODELS'))
    expect(list.indexOf("'lineOaAccount'")).toBeLessThan(list.indexOf("'lineOaLiffApp'"))
  })

  it('ships additive migrations for both databases', () => {
    const local = fs.readdirSync(path.resolve(process.cwd(), 'prisma/migrations')).find((name) => name.includes('line_oa_liff_app'))
    expect(local).toBeTruthy()
    expect(read(`prisma/migrations/${local}/migration.sql`)).toContain('CREATE TABLE "LineOaLiffApp"')
    const production = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).find((name) => name.includes('line_oa_liff_app'))
    expect(production).toBeTruthy()
    const sql = read(`supabase/migrations/${production}`)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "LineOaLiffApp"')
    expect(sql).toContain('ALTER TABLE "LineOaLiffApp" FORCE ROW LEVEL SECURITY')
    expect(sql).toMatch(/NOT APPLIED/)
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
  })
})
