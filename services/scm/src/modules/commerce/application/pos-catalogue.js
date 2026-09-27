import { z } from 'zod'
import { commerceAuthority, denied } from '../../../infrastructure/delegation.js'
import { catalogueFacts, inventoryAuthority } from '../../inventory/index.js'

// POS terminal catalogue (FR-183) inside SCM — port of apps/server
// pos-cashier-service.getPosTerminalCatalogue: identity plus recomputed on-hand;
// every sale price is manual (`unitPrice: null`). Reading needs the commerce
// domain AND the inventory domain (on-hand is an Inventory fact); either missing
// is the same 404 an unknown Business gets. Branches are core-owned: they arrive
// as ReferenceAuthority facts read BEFORE the store read, and the legacy filter
// (ACTIVE, by code) is applied here. An unavailable Branch owner refuses the
// catalogue (503) rather than serve one without its sites.

export const zPosCatalogueQuery = z.object({ businessId: z.string().trim().min(1).max(200) }).strict()
const byCode = (a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0)

/** Authorization first, so an unauthorized caller triggers no reference lookup. */
export function authorizeCatalogue(scope, query) {
  const { businessId } = zPosCatalogueQuery.parse(query)
  const business = commerceAuthority.require(scope, businessId)
  if (!inventoryAuthority.mayView(scope, business.id)) throw denied()
  return business
}

export function getPosTerminalCatalogue(sql, business, branchFacts) {
  const { products, onHand, categories, locations } = catalogueFacts(sql, business.id)
  const categoryMap = new Map(categories.map((category) => [category.id, category]))
  const branches = branchFacts
    .filter((b) => b.businessId === business.id && b.tenantId === business.tenantId && b.status === 'ACTIVE')
    .sort(byCode)
    .map(({ id, code, name, address, kind, status }) => ({ id, code, name, address: address ?? null, kind, status }))
  return {
    businessId: business.id,
    branches,
    warehouseLocations: locations,
    categories,
    items: products.map((product) => {
      const category = product.masterCategoryId ? categoryMap.get(product.masterCategoryId) : null
      const tracked = product.stockPolicy === 'TRACKED'
      const qty = onHand.get(product.id) ?? 0
      return {
        productId: product.id,
        code: product.code,
        name: product.name ?? product.masterNameTh ?? product.code,
        unit: product.unit,
        stockPolicy: product.stockPolicy,
        trackingMode: product.trackingMode,
        onHand: tracked ? qty : null,
        isAvailable: tracked ? qty > 0 : true,
        categoryId: category?.id ?? null,
        categoryName: category?.nameTh ?? null,
        unitPrice: null,
      }
    }),
  }
}
