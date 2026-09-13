// @req FR-154, FR-155, FR-184 — what the Inventory routes and persistence are, in
//   source terms: every handler resolves a browser viewer, stays thin and is
//   inventoried for OpenAPI; the Inventory models are in both schemas, snapshotted
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
  'src/app/api/inventory/recipes/route.js': ['GET', 'POST'],
  'src/app/api/inventory/recipes/[id]/route.js': ['GET', 'PATCH'],
  'src/app/api/inventory/recipes/[id]/build/route.js': ['POST'],
  'src/app/api/inventory/stocktakes/preview/route.js': ['POST'],
  'src/app/api/inventory/stocktakes/commit/route.js': ['POST'],
  'src/app/api/inventory/stocktakes/[id]/route.js': ['GET'],
  // @req FR-203, FR-204, FR-206, FR-207 — SKU governance (ADR-083).
  'src/app/api/inventory/products/resolve/route.js': ['GET'],
  'src/app/api/inventory/products/[id]/identifiers/route.js': ['GET', 'POST', 'PATCH'],
  'src/app/api/inventory/products/[id]/unit-conversions/route.js': ['GET', 'POST', 'PATCH'],
  'src/app/api/inventory/catalog-hygiene/route.js': ['GET'],
  'src/app/api/inventory/replenishment/route.js': ['GET'],
}
const GOVERNANCE_MODELS = ['ProductIdentifier', 'ProductUnitConversion']
const MODELS = ['InventoryCategory', 'ProductFamily', 'Factory', 'ProductMaster', 'Product', 'ProductBundle', 'ProductBundleItem', 'ProductRecipe', 'ProductRecipeLine', 'ProductLot', 'SerialUnit', 'StockMovement', 'InventoryLedgerFence', 'InventoryStocktake', ...GOVERNANCE_MODELS]
const LEGACY_MODELS = MODELS.filter((model) => !['InventoryLedgerFence', 'InventoryStocktake', ...GOVERNANCE_MODELS].includes(model))

describe('FR-154 / FR-155 Inventory route and persistence contract', () => {
  it('every handler exposes exactly its inventoried methods, resolves a viewer, and never deletes', () => {
    for (const [file, methods] of Object.entries(ROUTES)) {
      const source = read(file)
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        const declared = new RegExp(`export async function ${method}\\b`).test(source)
        expect(declared, `${method} in ${file}`).toBe(methods.includes(method))
      }
      expect(source).toMatch(/resolveRequestViewer/)
      expect(source).toMatch(/@req FR-(?:15[456]|184|20[1-7])/)
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
    // @req FR-203, FR-204 — an identifier and a unit conversion hang off one product only.
    expect(at('product')).toBeLessThan(at('productIdentifier'))
    expect(at('product')).toBeLessThan(at('productUnitConversion'))
    expect(at('product')).toBeLessThan(at('productLot'))
    expect(at('product')).toBeLessThan(at('productRecipe'))
    expect(at('productRecipe')).toBeLessThan(at('productRecipeLine'))
    expect(at('productLot')).toBeLessThan(at('serialUnit'))
    expect(at('serialUnit')).toBeLessThan(at('stockMovement'))
    expect(at('stockMovement')).toBeLessThan(at('inventoryLedgerFence'))
    expect(at('inventoryLedgerFence')).toBeLessThan(at('inventoryStocktake'))
    expect(at('business')).toBeLessThan(at('inventoryCategory'))
  })

  it('ships additive migrations for both databases', () => {
    // FR-154/155 landed as one migration, FR-156 as a second; together they create every model.
    const locals = fs.readdirSync(path.resolve(process.cwd(), 'prisma/migrations')).filter((name) => /inventory_(domain|recipe)/.test(name))
    expect(locals).toHaveLength(2)
    const twin = locals.map((name) => read(`prisma/migrations/${name}/migration.sql`)).join('\n')
    const productions = fs.readdirSync(path.resolve(process.cwd(), 'supabase/migrations')).filter((name) => /inventory_(domain|recipe)/.test(name))
    expect(productions).toHaveLength(2)
    const sql = productions.map((name) => read(`supabase/migrations/${name}`)).join('\n')
    for (const model of LEGACY_MODELS) {
      expect(twin).toContain(`CREATE TABLE "${model}"`)
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${model}"`)
    }
    expect(sql).toMatch(/FORCE ROW LEVEL SECURITY/)
    expect(sql).toMatch(/NOT APPLIED/)
    expect(sql).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
    expect(twin).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
  })

  it('ships additive SKU-governance migrations in both database trees (FR-201..FR-207)', () => {
    const local = read('prisma/migrations/20260913120000_inventory_sku_governance/migration.sql')
    const production = read('supabase/migrations/20260913120000_inventory_sku_governance.sql')
    for (const model of GOVERNANCE_MODELS) {
      expect(local).toContain(`CREATE TABLE "${model}"`)
      expect(production).toContain(`CREATE TABLE IF NOT EXISTS "${model}"`)
    }
    for (const column of ['nature', 'defaultStockPolicy', 'variantAxesJson']) {
      expect(local).toContain(`ALTER TABLE "ProductMaster" ADD COLUMN "${column}"`)
      expect(production).toContain(`ALTER TABLE "ProductMaster" ADD COLUMN IF NOT EXISTS "${column}"`)
    }
    for (const column of ['variantJson', 'variantKey', 'mergedIntoProductId', 'reorderPoint', 'reorderQty', 'leadTimeDays']) {
      expect(local).toContain(`ALTER TABLE "Product" ADD COLUMN "${column}"`)
      expect(production).toContain(`ALTER TABLE "Product" ADD COLUMN IF NOT EXISTS "${column}"`)
    }
    // The nature backfill derives SERVICE masters from their own SKUs, in both trees.
    expect(local).toMatch(/UPDATE "ProductMaster"[\s\S]*SET "nature" = 'SERVICE'/)
    expect(production).toMatch(/UPDATE "ProductMaster" pm[\s\S]*SET "nature" = 'SERVICE'/)
    expect(local).toContain('"Product_productMasterId_variantKey_key"')
    expect(production).toContain('"Product_productMasterId_variantKey_key"')
    expect(production).toMatch(/FORCE ROW LEVEL SECURITY/)
    expect(production).toMatch(/NOT APPLIED/)
    expect(production).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO zuri_app_runtime, zuri_web_login/)
    expect(local).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
    expect(production).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
  })

  it('ships additive stocktake migrations in both database trees', () => {
    const local = read('prisma/migrations/20260911020000_inventory_stocktake/migration.sql')
    const production = read('supabase/migrations/20260911020000_inventory_stocktake.sql')
    for (const model of ['InventoryLedgerFence', 'InventoryStocktake']) {
      expect(local).toContain(`CREATE TABLE "${model}"`)
      expect(production).toContain(`CREATE TABLE IF NOT EXISTS "${model}"`)
    }
    expect(production).toMatch(/FORCE ROW LEVEL SECURITY/)
    expect(production).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO zuri_app_runtime, zuri_web_login/)
    expect(local).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
    expect(production).not.toMatch(/DROP\s+(TABLE|COLUMN)/i)
  })

  it('registers one live inventory domain with Dashboard first, reachable by Membership grant', () => {
    const domains = DOMAINS.filter((domain) => domain.key === 'inventory')
    expect(domains).toHaveLength(1)
    // Labelled Inventory again since ADR-069: SCM holds the bar slot, so this
    // list is only on screen while SCM is selected and the old collision with a
    // Project's own Inventory section tab (FR-077) cannot happen. Inventory
    // owns the existing locations, transfers and stocktake surface.
    expect(domains[0]).toMatchObject({ label: 'Inventory', basePath: '/inventory' })
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
