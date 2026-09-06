// @req FR-152 — what the rich menu job routes are, in source terms: the
//   ledger route resolves a browser viewer on every method and stays thin;
//   the worker route is bearer-authenticated like the conversation worker;
//   both are inventoried; the worker script ticks both endpoints; the model
//   is in both schemas, snapshotted after its parents, and migrated in both
//   trees in the same change.
// @spec ADR-061 D1, D6; SEC-001; FR-061
// @tested tests/unit/line-oa-rich-menu-jobs-routes.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_API_ROUTE_INVENTORY } from '@/modules/project-manager/api-docs/openapi'

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const JOBS = 'src/app/api/line-oa/rich-menus/[id]/jobs/route.js'
const WORKER = 'src/app/api/line-oa/rich-menu-worker/route.js'

describe('FR-152 rich menu job routes and persistence contract', () => {
  it('exposes list, queue and acknowledge on the ledger, and one authenticated tick on the worker', () => {
    const jobs = read(JOBS)
    for (const method of ['GET', 'POST', 'PATCH']) expect(jobs).toMatch(new RegExp(`export async function ${method}`))
    expect(jobs).not.toMatch(/export async function DELETE/)
    expect(jobs).toMatch(/resolveRequestViewer/)
    expect(jobs).toMatch(/@req FR-152/)
    expect(jobs).not.toMatch(/@\/lib\/db|prisma\./)
    const worker = read(WORKER)
    expect(worker).toMatch(/ZURI_LINE_WORKER_TOKEN/)
    expect(worker).toMatch(/timingSafeEqual/)
    expect(worker).toMatch(/WORKER_CREDENTIAL_REQUIRED/)
    expect(worker).not.toMatch(/resolveRequestViewer/)
  })

  it('is inventoried for the OpenAPI document and ticked by the supervised worker script', () => {
    const paths = Object.fromEntries(CURRENT_API_ROUTE_INVENTORY)
    expect(paths['/api/line-oa/rich-menus/{id}/jobs']).toEqual(['GET', 'POST', 'PATCH'])
    expect(paths['/api/line-oa/rich-menu-worker']).toEqual(['POST'])
    const script = read('scripts/server-line-worker.mjs')
    expect(script).toMatch(/\/api\/line-oa\/rich-menu-worker/)
  })

  it('declares the job model identically in both schemas and snapshots it after its parents', () => {
    const body = (schema) => schema.match(/model LineOaRichMenuJob \{[\s\S]*?\n\}/)?.[0] || ''
    const sqlite = read('prisma/schema.prisma')
    expect(body(sqlite)).not.toBe('')
    expect(body(read('prisma/schema.postgres.prisma'))).toBe(body(sqlite))
    // No token column of any kind: the worker resolves the credential per attempt.
    expect(body(sqlite)).not.toMatch(/token|secret/i)
    const backup = read('src/modules/project-manager/application/backup-service.js')
    const list = backup.slice(backup.indexOf('const SNAPSHOT_MODELS'), backup.indexOf('SNAPSHOT_EXCLUDED_MODELS'))
    expect(list.indexOf("'lineOaRichMenuVersion'")).toBeLessThan(list.indexOf("'lineOaRichMenuJob'"))
  })

  it('ships additive migrations for both databases', () => {
    const local = fs.readdirSync(path.resolve(process.cwd(), 'prisma/migrations')).find((name) => name.includes('line_oa_rich_menu_job'))
    expect(local).toBeTruthy()
    expect(read(`prisma/migrations/${local}/migration.sql`)).toContain('CREATE TABLE "LineOaRichMenuJob"')
    const production = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).find((name) => name.includes('line_oa_rich_menu_job'))
    expect(production).toBeTruthy()
    const sql = read(`supabase/migrations/${production}`)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "LineOaRichMenuJob"')
    expect(sql).toContain('ALTER TABLE "LineOaRichMenuJob" FORCE ROW LEVEL SECURITY')
    // 2026-09-06: the file was renamed (20260906180000 → 20260906190000) after
    // its original timestamp collided with another migration's under
    // schema_migrations's version primary key. By the time of the rename the
    // DDL had already been applied to production under the old filename, so
    // the file no longer claims to be unapplied — it says so, honestly.
    expect(sql).toMatch(/applied to production/i)
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
  })
})
