// @req FR-161 — what the sales task routes and persistence are, in source
//   terms: both handlers resolve a browser viewer, stay thin and are
//   inventoried for OpenAPI; the model is in both schemas, keyed on nothing
//   external, snapshotted after everything it references, migrated in both
//   trees; the CRM domain lists the page; the SALES_REP role declares its
//   single write permission.
// @spec ADR-064; SEC-001; FR-061; FR-076; docs/DB-MIGRATION-NOTES.md §Migration discipline
// @tested tests/unit/sales-task-routes.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_API_ROUTE_INVENTORY } from '@/modules/project-manager/api-docs/openapi'
import { DOMAINS, domainForPath } from '@/config/domains'
import { ROLE_PERMISSIONS, ROLE_SALES_REP, SALES_TASK_WRITE_PERMISSION, permissionsForRoles } from '@/modules/identity/rbac'

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const COLLECTION = 'src/app/api/crm/sales-tasks/route.js'
const ITEM = 'src/app/api/crm/sales-tasks/[id]/route.js'

describe('FR-161 sales task route and persistence contract', () => {
  it('lists and creates on the collection, reads and acts on the item, never deletes', () => {
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
      expect(source).toMatch(/@req FR-161/)
      expect(source).not.toMatch(/@\/lib\/db|prisma\./)
    }
  })

  it('is inventoried for the OpenAPI document', () => {
    const paths = Object.fromEntries(CURRENT_API_ROUTE_INVENTORY)
    expect(paths['/api/crm/sales-tasks']).toEqual(['GET', 'POST'])
    expect(paths['/api/crm/sales-tasks/{id}']).toEqual(['GET', 'PATCH'])
  })

  it('declares the model identically in both schemas, keyed on an internal UUID with a human code, no milestones', () => {
    const body = (schema) => schema.match(/model SalesTask \{[\s\S]*?\n\}/)?.[0] || ''
    const sqlite = read('prisma/schema.prisma')
    expect(body(sqlite)).not.toBe('')
    expect(body(read('prisma/schema.postgres.prisma'))).toBe(body(sqlite))
    expect(body(sqlite)).toMatch(/id\s+String\s+@id @default\(uuid\(\)\)/)
    expect(body(sqlite)).toContain('@@unique([tenantId, code])')
    expect(body(sqlite)).toContain('@@index([businessId, status, dueDate])')
    expect(body(sqlite)).not.toMatch(/milestone|notionId|workstream/i)
  })

  it('snapshots the task after every row it references', () => {
    const backup = read('src/modules/project-manager/application/backup-service.js')
    const list = backup.slice(backup.indexOf('const SNAPSHOT_MODELS'), backup.indexOf('SNAPSHOT_EXCLUDED_MODELS'))
    const at = (name) => list.indexOf(`'${name}'`)
    expect(at('salesTask')).toBeGreaterThan(0)
    for (const parent of ['business', 'person', 'customer', 'conversation']) expect(at(parent)).toBeLessThan(at('salesTask'))
  })

  it('ships additive migrations for both databases', () => {
    const local = fs.readdirSync(path.resolve(process.cwd(), 'prisma/migrations')).find((name) => name.includes('crm_sales_task'))
    expect(local).toBeTruthy()
    expect(read(`prisma/migrations/${local}/migration.sql`)).toContain('CREATE TABLE "SalesTask"')
    const production = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).find((name) => name.includes('crm_sales_task'))
    expect(production).toBeTruthy()
    const sql = read(`supabase/migrations/${production}`)
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "SalesTask"')
    expect(sql).toContain('ALTER TABLE "SalesTask" FORCE ROW LEVEL SECURITY')
    expect(sql).toMatch(/NOT APPLIED/)
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
  })

  it('is a CRM page, not a Development one', () => {
    const crm = DOMAINS.find((domain) => domain.key === 'customer')
    expect(crm.sub.find((item) => item.path === '/customer/sales-tasks')).toMatchObject({ label: 'Sales Tasks' })
    expect(domainForPath('/customer/sales-tasks').key).toBe('customer')
    expect(DOMAINS.find((domain) => domain.key === 'projects').sub.map((item) => item.path)).not.toContain('/customer/sales-tasks')
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/app/(pm)/customer/sales-tasks/page.jsx'))).toBe(true)
  })

  it('declares the SALES_REP role and its single write permission', () => {
    expect(ROLE_SALES_REP).toBe('SALES_REP')
    expect(ROLE_PERMISSIONS[ROLE_SALES_REP]).toContain(SALES_TASK_WRITE_PERMISSION)
    expect(permissionsForRoles([ROLE_SALES_REP])).toContain(SALES_TASK_WRITE_PERMISSION)
  })
})
