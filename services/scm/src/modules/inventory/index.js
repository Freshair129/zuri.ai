// Inventory — public in-process module API of the SCM service. Other SCM
// modules (Procurement, Commerce) call ONLY these functions; they never import
// ./adapters or write Inventory tables (test/unit/module-boundaries.test.js).
export { appendMovement, requireIssuableLocation, setLotExpiryIfUnset, stockSummary, listMovements } from './application/stock-ledger.js'
/** Public stock commands and reads (FR-155): one movement, an explicit lot, lots, serial units. */
export * as stock from './application/stock-ledger.js'
/** Warehouse locations, the located view and the standalone transfer (FR-174). */
export * as locations from './application/locations.js'
/** Physical stocktake (FR-184). */
export * as stocktake from './application/stocktake.js'
export { inventoryAuthority } from '../../infrastructure/delegation.js'
export { productsByIds } from './adapters/inventory-repo.js'
/** POS terminal catalogue read port: ACTIVE SKUs with master facts, on-hand per SKU, categories, selling locations. */
export { catalogueFacts } from './application/catalogue.js'
/** The Inventory catalogue writers and reads (FR-154, FR-201, FR-202, FR-205, FR-207). */
export * as catalog from './application/catalog.js'
/** SKU identity: identifiers, unit conversions, resolve, FlowAccount SKU (FR-203, FR-204, FR-177). */
export * as identity from './application/identity.js'
/** Product carton facts: Inventory's own writer (with Inventory authority) and the SKU-matching read port. */
export { setProductCartonAttributes, productCandidates, productFacts } from './application/product-carton.js'
/** Recipes (FR-156) and the work orders built on them: customization (FR-176), kitting (FR-177), de-kitting (FR-178). */
export * as recipes from './application/recipes.js'
export * as customization from './application/customization.js'
export * as kitting from './application/kitting.js'
export * as deKitting from './application/de-kitting.js'
/** Available-to-Promise and reservations (FR-180). */
export * as atp from './application/atp.js'
/** On-hand from the ledger (read port for a pre-issue shortage report; the writer re-checks). */
export { onHandOf } from './adapters/inventory-repo.js'
