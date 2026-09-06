// @req FR-162, FR-163 — what the commerce routes and persistence are, in
//   source terms: every handler resolves a browser viewer, stays thin and is
//   inventoried for OpenAPI; the three models are in both schemas with no
//   stored total, paid or balance, snapshotted after everything they
//   reference, migrated in both trees; the Commerce slot is live with its two
//   pages; the roles declare their permissions.
// @spec ADR-065; SEC-001; FR-061; FR-076; docs/DB-MIGRATION-NOTES.md §Migration discipline
// @tested tests/unit/commerce-routes.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_API_ROUTE_INVENTORY } from '@/modules/project-manager/api-docs/openapi'
import { DOMAINS, domainForPath, isDomainVisible } from '@/config/domains'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { ORDER_WRITE_PERMISSION, PAYMENT_VERIFY_PERMISSION, ROLE_PAYMENT_VERIFIER, ROLE_PERMISSIONS, ROLE_SALES_REP } from '@/modules/identity/rbac'

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const ROUTES = {
  'src/app/api/commerce/orders/route.js': ['GET', 'POST'],
  'src/app/api/commerce/orders/[id]/route.js': ['GET', 'PATCH'],
  'src/app/api/commerce/orders/[id]/payments/route.js': ['GET', 'POST'],
  'src/app/api/commerce/payments/[id]/route.js': ['GET', 'PATCH'],
  'src/app/api/commerce/revenue/route.js': ['GET'],
}
const MODELS = ['SalesOrder', 'SalesOrderLine', 'Payment']

describe('FR-162 / FR-163 commerce route and persistence contract', () => {
  it('every handler exposes exactly its inventoried methods, resolves a viewer, and never deletes', () => {
    for (const [file, methods] of Object.entries(ROUTES)) {
      const source = read(file)
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        expect(new RegExp(`export async function ${method}\\b`).test(source), `${method} in ${file}`).toBe(methods.includes(method))
      }
      expect(source).toMatch(/resolveRequestViewer/)
      expect(source).toMatch(/@req FR-15[89]/)
      expect(source).not.toMatch(/@\/lib\/db|prisma\./)
    }
  })

  it('is inventoried for the OpenAPI document', () => {
    const paths = Object.fromEntries(CURRENT_API_ROUTE_INVENTORY)
    for (const [file, methods] of Object.entries(ROUTES)) {
      const apiPath = file.replace('src/app', '').replace('/route.js', '').replace('[id]', '{id}')
      expect(paths[apiPath], apiPath).toEqual(methods)
    }
  })

  it('declares the models identically in both schemas, money as integer satang, no stored total or paid', () => {
    const sqlite = read('prisma/schema.prisma')
    const postgres = read('prisma/schema.postgres.prisma')
    for (const model of MODELS) {
      const body = (schema) => schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`))?.[0] || ''
      expect(body(sqlite), model).not.toBe('')
      expect(body(postgres), model).toBe(body(sqlite))
      expect(body(sqlite)).toMatch(/id\s+String\s+@id @default\(uuid\(\)\)/)
      expect(body(sqlite)).not.toMatch(/Float|Decimal/)
    }
    const order = sqlite.match(/model SalesOrder \{[\s\S]*?\n\}/)[0]
    expect(order).toContain('@@unique([tenantId, code])')
    expect(order).not.toMatch(/totalSatang|paidSatang|balance|paymentState|itemsJson/)
    const payment = sqlite.match(/model Payment \{[\s\S]*?\n\}/)[0]
    expect(payment).toContain('@@unique([tenantId, bankReference])')
    expect(payment).toMatch(/slipFileAssetId\s+String\?/)
  })

  it('snapshots the order after everything it references, its lines and payments after it', () => {
    const backup = read('src/modules/project-manager/application/backup-service.js')
    const list = backup.slice(backup.indexOf('const SNAPSHOT_MODELS'), backup.indexOf('SNAPSHOT_EXCLUDED_MODELS'))
    const at = (name) => list.indexOf(`'${name}'`)
    for (const parent of ['business', 'customer', 'conversation', 'product', 'fileAsset']) expect(at(parent)).toBeLessThan(at('salesOrder'))
    expect(at('salesOrder')).toBeLessThan(at('salesOrderLine'))
    expect(at('salesOrder')).toBeLessThan(at('payment'))
  })

  it('ships additive migrations for both databases', () => {
    const local = fs.readdirSync(path.resolve(process.cwd(), 'prisma/migrations')).find((name) => name.includes('commerce_orders_payments'))
    expect(local).toBeTruthy()
    const twin = read(`prisma/migrations/${local}/migration.sql`)
    const production = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).find((name) => name.includes('commerce_orders_payments'))
    expect(production).toBeTruthy()
    const sql = read(`supabase/migrations/${production}`)
    for (const model of MODELS) {
      expect(twin).toContain(`CREATE TABLE "${model}"`)
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${model}"`)
    }
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/NOT APPLIED/)
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
  })

  it('the Commerce slot is live with a Dashboard and an Orders page, reachable by Membership grant', () => {
    const commerce = DOMAINS.find((domain) => domain.key === 'commerce')
    expect(commerce.soon).not.toBe(true)
    expect(commerce.sub[0]).toMatchObject({ label: 'Dashboard', path: '/commerce' })
    expect(commerce.sub.find((item) => item.path === '/commerce/orders')).toMatchObject({ label: 'Orders' })
    expect(domainForPath('/commerce/orders').key).toBe('commerce')
    expect(VIEWER_DOMAINS).toContain('commerce')
    expect(isDomainVisible('commerce', ['projects'])).toBe(false)
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/app/(pm)/commerce/page.jsx'))).toBe(true)
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/app/(pm)/commerce/orders/page.jsx'))).toBe(true)
  })

  it('a SALES_REP writes orders; only a PAYMENT_VERIFIER (or the owner) verifies payments', () => {
    expect(ROLE_PERMISSIONS[ROLE_SALES_REP]).toContain(ORDER_WRITE_PERMISSION)
    expect(ROLE_PERMISSIONS[ROLE_SALES_REP]).not.toContain(PAYMENT_VERIFY_PERMISSION)
    expect(ROLE_PAYMENT_VERIFIER).toBe('PAYMENT_VERIFIER')
    expect(ROLE_PERMISSIONS[ROLE_PAYMENT_VERIFIER]).toContain(PAYMENT_VERIFY_PERMISSION)
    expect(ROLE_PERMISSIONS[ROLE_PAYMENT_VERIFIER]).not.toContain(ORDER_WRITE_PERMISSION)
  })
})
