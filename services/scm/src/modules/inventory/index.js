// Inventory — public in-process module API of the SCM service. Other SCM
// modules (Procurement, Commerce) call ONLY these functions; they never import
// ./adapters or write Inventory tables (test/unit/module-boundaries.test.js).
export { appendMovement, requireIssuableLocation, setLotExpiryIfUnset, stockSummary, listMovements } from './application/stock-ledger.js'
export { inventoryAuthority } from '../../infrastructure/delegation.js'
export { productsByIds } from './adapters/inventory-repo.js'
/** POS terminal catalogue read port: ACTIVE SKUs with master facts, on-hand per SKU, categories, selling locations. */
export { catalogueFacts } from './application/catalogue.js'
/** The Inventory catalogue writers and reads (FR-154, FR-201, FR-202, FR-205, FR-207). */
export * as catalog from './application/catalog.js'
/** Product carton facts: Inventory's own writer (with Inventory authority) and the SKU-matching read port. */
export { setProductCartonAttributes, productCandidates, productFacts } from './application/product-carton.js'
/** On-hand from the ledger (read port for a pre-issue shortage report; the writer re-checks). */
export { onHandOf } from './adapters/inventory-repo.js'
