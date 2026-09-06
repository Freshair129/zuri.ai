// @req FR-154, FR-155 — what the Inventory routes and persistence are, in
//   source terms: every handler resolves a browser viewer, stays thin and is
//   inventoried for OpenAPI; the ten models are in both schemas, snapshotted
//   parents-first, and migrated in both trees in the same change; the domain
//   is registered for navigation and Membership grants; the manager role
//   declares its permission.
// @spec SEC-001; FR-061; FR-076; docs/DB-MIGRATION-NOTES.md §Migration discipline
// @tested tests/unit/inventory-routes.test.js
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { CURRENT_API_ROUTE_INVENTORY } from '@/modules/project-manager/api-docs/openapi'
import { DOMAINS, domainForPath, isDomainVisible } from '@/config/domains'
import { VIEWER_DOMAINS } from '@/modules/identity/viewer-domains'
import { INVENTORY_MANAGE_PERMISSION, ROLE_INVENTORY_MANAGER, ROLE_PERMISSIONS, permissionsForRoles } from '@/modules/identity/rbac'

const read = (relative) => fs.readFileSync(path.join(process.cwd(), relative), 'utf8')
const ROUTES = {
  'src/app/api/inventory/categories/route.js': ['GET', 'POST'],
  'src/app/api/inventory/families/route.js': ['GET', 'POST'],
  'src/app/api/inventory/factories/route.js': ['GET', 'POST'],
  'src/app/api/inventory/product-masters/route.js': ['GET', 'POST'],
  'src/app/api/inventory/products/route.js': ['GET', 'POST'],
  'src/app/api/inventory/products/[id]/route.js': ['GET', 'PATCH'],
  'src/app/api/inventory/bundles/route.js': ['GET', 'POST'],
  'src/app/api/inventory/lots/route.js': ['GET', 'POST'],
  'src/app/api/inventory/serial-units/route.js': ['GET'],
  'src/app/api/inventory/stock-movements/route.js': ['GET', 'POST'],
  'src/app/api/inventory/stock/route.js': ['GET'],
}
const MODELS = ['InventoryCategory', 'ProductFamily', 'Factory', 'ProductMaster', 'Product', 'ProductBundle', 'ProductBundleItem', 'ProductLot', 'SerialUnit', 'StockMovement']

describe('FR-154 / FR-155 Inventory route and persistence contract', () => {
  it('every handler exposes exactly its inventoried methods, resolves a viewer, and never deletes', () => {
    for (const [file, methods] of Object.entries(ROUTES)) {
      const source = read(file)
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        const declared = new RegExp(`export async function ${method}\\b`).test(source)
        expect(declared, `${method} in ${file}`).toBe(methods.includes(method))
      }
      expect(source).toMatch(/resolveRequestViewer/)
      expect(source).toMatch(/@req FR-15[45]/)
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

  it('declares every model identically in both schemas, keyed on nothing external, and stores no on-hand on the product', () => {
    const sqlite = read('prisma/schema.prisma')
    const postgres = read('prisma/schema.postgres.prisma')
    for (const model of MODELS) {
      const body = (schema) => schema.match(new RegExp(`model ${model} \\{[\\s\\S]*?\\n\\}`))?.[0] || ''
      expect(body(sqlite), model).not.toBe('')
      expect(body(postgres), model).toBe(body(sqlite))
      expect(body(sqlite)).toMatch(/id\s+String\s+@id @default\(uuid\(\)\)/)
    }
    const product = sqlite.match(/model Product \{[\s\S]*?\n\}/)[0]
    expect(product).toContain('@@unique([tenantId, code])')
    expect(product).not.toMatch(/onHand|quantity/)
    expect(sqlite.match(/model SerialUnit \{[\s\S]*?\n\}/)[0]).toContain('@@unique([productId, serialNo])')
    expect(sqlite.match(/model ProductLot \{[\s\S]*?\n\}/)[0]).toContain('@@unique([productId, code])')
  })

  it('snapshots the catalogue parents before their children and the ledger last', () => {
    const backup = read('src/modules/project-manager/application/backup-service.js')
    const list = backup.slice(backup.indexOf('const SNAPSHOT_MODELS'), backup.indexOf('SNAPSHOT_EXCLUDED_MODELS'))
    const at = (name) => list.indexOf(`'${name}'`)
    for (const name of ['inventoryCategory', 'productFamily', 'factory']) expect(at(name)).toBeLessThan(at('productMaster'))
    expect(at('productMaster')).toBeLessThan(at('product'))
    expect(at('product')).toBeLessThan(at('productBundleItem'))
    expect(at('productBundle')).toBeLessThan(at('productBundleItem'))
    expect(at('product')).toBeLessThan(at('productLot'))
    expect(at('productLot')).toBeLessThan(at('serialUnit'))
    expect(at('serialUnit')).toBeLessThan(at('stockMovement'))
    expect(at('business')).toBeLessThan(at('inventoryCategory'))
  })

  it('ships additive migrations for both databases', () => {
    const local = fs.readdirSync(path.resolve(process.cwd(), 'prisma/migrations')).find((name) => name.includes('inventory_domain'))
    expect(local).toBeTruthy()
    const twin = read(`prisma/migrations/${local}/migration.sql`)
    const production = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).find((name) => name.includes('inventory_domain'))
    expect(production).toBeTruthy()
    const sql = read(`supabase/migrations/${production}`)
    for (const model of MODELS) {
      expect(twin).toContain(`CREATE TABLE "${model}"`)
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${model}"`)
    }
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/NOT APPLIED/)
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
    expect(twin).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
  })

  it('registers one live inventory domain with Dashboard first, reachable by Membership grant', () => {
    const domains = DOMAINS.filter((domain) => domain.key === 'inventory')
    expect(domains).toHaveLength(1)
    // Labelled Warehouse: a Project's own Inventory section tab (FR-077) is on
    // screen with this bar, and two links named Inventory are ambiguous.
    expect(domains[0]).toMatchObject({ label: 'Warehouse', basePath: '/inventory' })
    expect(domains[0].soon).not.toBe(true)
    expect(domains[0].sub[0]).toMatchObject({ label: 'Dashboard', path: '/inventory' })
    expect(domainForPath('/inventory').key).toBe('inventory')
    expect(VIEWER_DOMAINS).toContain('inventory')
    expect(isDomainVisible('inventory', ['inventory'])).toBe(true)
    expect(isDomainVisible('inventory', ['projects'])).toBe(false)
    expect(fs.existsSync(path.resolve(process.cwd(), 'src/app/(pm)/inventory/page.jsx'))).toBe(true)
  })

  it('declares the manager role and its single write permission', () => {
    expect(ROLE_INVENTORY_MANAGER).toBe('INVENTORY_MANAGER')
    expect(ROLE_PERMISSIONS[ROLE_INVENTORY_MANAGER]).toContain(INVENTORY_MANAGE_PERMISSION)
    expect(permissionsForRoles([ROLE_INVENTORY_MANAGER])).toContain(INVENTORY_MANAGE_PERMISSION)
  })
})
