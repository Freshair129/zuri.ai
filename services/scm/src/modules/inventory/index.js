// Inventory — public in-process module API of the SCM service. Other SCM
// modules (Procurement, Commerce) call ONLY these functions; they never import
// ./adapters or write Inventory tables (test/unit/module-boundaries.test.js).
export { appendReceipt, setLotExpiryIfUnset, stockSummary, listMovements } from './application/stock-ledger.js'
export { inventoryAuthority } from '../../infrastructure/delegation.js'
export { productsByIds } from './adapters/inventory-repo.js'
