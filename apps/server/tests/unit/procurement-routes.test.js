// @req FR-164, FR-165 — what the procurement routes and persistence are, in
//   source terms: every handler resolves a browser viewer, stays thin and is
//   inventoried for OpenAPI; the five models are in both schemas with no
//   stored total or received quantity, snapshotted after everything they
//   reference, migrated in both trees; the Procurement slot is live with its
//   two pages; the buyer role declares its permissions and no Inventory one.
// @spec ADR-066; SEC-001; FR-061; FR-076; docs/DB-MIGRATION-NOTES.md §Migration discipline
// @tested tests/unit/procurement-routes.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_API_ROUTE_INVENTORY } from '@/modules/project-manager/api-docs/openapi'
import { DOMAINS, domainForPath, isDomainVisible } from '@/config/domains'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { GOODS_RECEIPT_POST_PERMISSION, INVENTORY_MANAGE_PERMISSION, PURCHASE_ORDER_WRITE_PERMISSION, ROLE_PERMISSIONS, ROLE_PROCUREMENT_BUYER, ROLE_GOODS_RECEIVER, conflictingRoles } from '@/modules/identity/rbac'

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const ROUTES = {
  'src/app/api/procurement/suppliers/route.js': ['GET', 'POST'],
  'src/app/api/procurement/suppliers/[id]/route.js': ['GET', 'PATCH'],
  'src/app/api/procurement/purchase-orders/route.js': ['GET', 'POST'],
  'src/app/api/procurement/purchase-orders/[id]/route.js': ['GET', 'PATCH'],
  'src/app/api/procurement/purchase-orders/[id]/receipts/route.js': ['GET', 'POST'],
  'src/app/api/procurement/receipts/route.js': ['GET'],
  'src/app/api/procurement/receipts/[id]/route.js': ['GET'],
}
const MODELS = ['Supplier', 'PurchaseOrder', 'PurchaseOrderLine', 'GoodsReceipt', 'GoodsReceiptLine']

describe('FR-164 / FR-165 procurement route and persistence contract', () => {
  it('every handler exposes exactly its inventoried methods, resolves a viewer, and never deletes', () => {
    for (const [file, methods] of Object.entries(ROUTES)) {
      const source = read(file)
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        expect(new RegExp(`export async function ${method}\\b`).test(source), `${method} in ${file}`).toBe(methods.includes(method))
      }
      expect(source).toMatch(/resolveRequestViewer/)
      expect(source).toMatch(/@req FR-16[45]/)
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

  it('declares the models identically in both schemas, money as integer satang, no stored total or received quantity', () => {
    const sqlite = read('prisma/schema.prisma')
    const postgres = read('prisma/schema.postgres.prisma')
    for (const model of MODELS) {
      const body = (schema) => schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`))?.[0] || ''
      expect(body(sqlite), model).not.toBe('')
      expect(body(postgres), model).toBe(body(sqlite))
      expect(body(sqlite)).toMatch(/id\s+String\s+@id @default\(uuid\(\)\)/)
      expect(body(sqlite)).not.toMatch(/Float|Decimal/)
    }
    const order = sqlite.match(/model PurchaseOrder \{[\s\S]*?\n\}/)[0]
    expect(order).toContain('@@unique([tenantId, code])')
    expect(order).not.toMatch(/totalSatang|receivedQty|receiptState|itemsJson/)
    const line = sqlite.match(/model PurchaseOrderLine \{[\s\S]*?\n\}/)[0]
    expect(line).not.toMatch(/receivedQty/)
    const receipt = sqlite.match(/model GoodsReceipt \{[\s\S]*?\n\}/)[0]
    expect(receipt).not.toMatch(/status|version|updatedAt/)
    const supplier = sqlite.match(/model Supplier \{[\s\S]*?\n\}/)[0]
    expect(supplier).toContain('@@unique([tenantId, code])')
  })

  it('snapshots each row after everything it references', () => {
    const backup = read('src/modules/project-manager/application/backup-service.js')
    const list = backup.slice(backup.indexOf('const SNAPSHOT_MODELS'), backup.indexOf('SNAPSHOT_EXCLUDED_MODELS'))
    const at = (name) => list.indexOf(`'${name}'`)
    for (const parent of ['business', 'product']) expect(at(parent)).toBeLessThan(at('supplier'))
    expect(at('supplier')).toBeLessThan(at('purchaseOrder'))
    expect(at('purchaseOrder')).toBeLessThan(at('purchaseOrderLine'))
    expect(at('purchaseOrder')).toBeLessThan(at('goodsReceipt'))
    expect(at('purchaseOrderLine')).toBeLessThan(at('goodsReceiptLine'))
    expect(at('goodsReceipt')).toBeLessThan(at('goodsReceiptLine'))
  })

  it('ships additive migrations for both databases', () => {
    const local = fs.readdirSync(path.resolve(process.cwd(), 'prisma/migrations')).find((name) => name.endsWith('_procurement'))
    expect(local).toBeTruthy()
    const twin = read(`prisma/migrations/${local}/migration.sql`)
    const production = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).find((name) => name.endsWith('_procurement.sql'))
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

  it('the Procurement slot is live with a Dashboard and a Purchase Orders page, reachable by Membership grant', () => {
    const procurement = DOMAINS.find((domain) => domain.key === 'procurement')
    expect(procurement.soon).not.toBe(true)
    expect(procurement.label).toBe('Procurement')
    expect(procurement.sub[0]).toMatchObject({ label: 'Dashboard', path: '/procurement' })
    expect(procurement.sub.find((item) => item.path === '/procurement/purchase-orders')).toMatchObject({ label: 'Purchase Orders' })
    expect(domainForPath('/procurement/purchase-orders').key).toBe('procurement')
    expect(VIEWER_DOMAINS).toContain('procurement')
    expect(isDomainVisible('procurement', ['inventory'])).toBe(false)
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/app/(pm)/procurement/page.jsx'))).toBe(true)
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/app/(pm)/procurement/purchase-orders/page.jsx'))).toBe(true)
  })

  // @req FR-196/ADR-079 — amends this file's own prior assertion that a buyer
  // both keeps orders and posts receipts: three-way match needs two people, so
  // the two capabilities are split into conflicting roles.
  it('a PROCUREMENT_BUYER keeps orders and holds no receipt-post or Inventory write of its own', () => {
    expect(ROLE_PROCUREMENT_BUYER).toBe('PROCUREMENT_BUYER')
    expect(ROLE_PERMISSIONS[ROLE_PROCUREMENT_BUYER]).toContain(PURCHASE_ORDER_WRITE_PERMISSION)
    expect(ROLE_PERMISSIONS[ROLE_PROCUREMENT_BUYER]).not.toContain(GOODS_RECEIPT_POST_PERMISSION)
    expect(ROLE_PERMISSIONS[ROLE_PROCUREMENT_BUYER]).not.toContain(INVENTORY_MANAGE_PERMISSION)
  })

  it('a GOODS_RECEIVER posts receipts, holds no purchase-order write or Inventory write of its own, and conflicts with PROCUREMENT_BUYER', () => {
    expect(ROLE_GOODS_RECEIVER).toBe('GOODS_RECEIVER')
    expect(ROLE_PERMISSIONS[ROLE_GOODS_RECEIVER]).toContain(GOODS_RECEIPT_POST_PERMISSION)
    expect(ROLE_PERMISSIONS[ROLE_GOODS_RECEIVER]).not.toContain(PURCHASE_ORDER_WRITE_PERMISSION)
    expect(ROLE_PERMISSIONS[ROLE_GOODS_RECEIVER]).not.toContain(INVENTORY_MANAGE_PERMISSION)
    expect(conflictingRoles(ROLE_PROCUREMENT_BUYER)).toContain(ROLE_GOODS_RECEIVER)
    expect(conflictingRoles(ROLE_GOODS_RECEIVER)).toContain(ROLE_PROCUREMENT_BUYER)
  })
})
