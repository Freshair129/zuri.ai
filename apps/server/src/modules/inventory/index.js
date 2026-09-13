// @req FR-154, FR-155 — the Inventory module's stable exports: the pure
//   vocabulary and calculators, the authority ladder, the catalogue writer and
//   the stock-ledger writer. Other lanes import from here, never from a file
//   inside `application/` directly.
// @req FR-174, FR-175, FR-176, FR-177, FR-178, FR-179, FR-180, FR-184 — and, since
//   ADR-074, the located ledger (locations and transfers), the costing
//   calculators, the two WIP work orders, de-kitting, the shelf-life guard and
//   Available-to-Promise. The agent's tools (FR-181) bind to these exports and
//   to nothing deeper, which is what keeps a tool from acquiring authority the
//   service does not grant.
// @req FR-201, FR-202, FR-203, FR-204, FR-205, FR-206, FR-207 — and, since
//   ADR-083, SKU governance: the nature and variant rules, identifiers and
//   unit conversions with `resolveProduct`, the lifecycle actions, the
//   hygiene report and the replenishment suggestion.
// @spec ADR-025 (one module, one charter: docs/domains/inventory/CHARTER.md); ADR-074; ADR-083
// @tested tests/unit/inventory-domain.test.js
export * from './domain/inventory'
export * from './domain/inventory-costing'
export * from './domain/inventory-wip'
export * from './domain/warehouse-location'
export * from './domain/inventory-stocktake'
export * from './domain/inventory-governance'
export { assertMayManage, assertMayView, mayManage, mayView } from './application/inventory-authority'
export {
  addIdentifier,
  addUnitConversion,
  applyIdentifierAction,
  applyUnitConversionAction,
  listIdentifiers,
  listUnitConversions,
  resolveProduct,
} from './application/inventory-identity-service'
export { catalogHygiene, replenishment } from './application/inventory-hygiene-service'
export {
  applyProductAction,
  createBundle,
  createCategory,
  createFactory,
  createFamily,
  createProduct,
  createProductMaster,
  getProduct,
  listBundles,
  listCategories,
  listFactories,
  listFamilies,
  listProductMasters,
  listProducts,
  flowAccountSkuOf,
  productByFlowAccountSku,
  setFlowAccountSku,
} from './application/inventory-catalog-service'
export {
  acquireLedgerFence,
  advanceLedgerFence,
  appendMovement,
  createLot,
  listLots,
  listMovements,
  listSerialUnits,
  recordMovement,
  stockSummary,
} from './application/inventory-stock-service'
export {
  applyRecipeAction,
  buildRecipe,
  createRecipe,
  getRecipe,
  listRecipes,
} from './application/inventory-recipe-service'
export {
  applyLocationAction,
  createLocation,
  getLocation,
  listLocations,
  locationStock,
} from './application/warehouse-location-service'
export { transferInTransaction, transferStock } from './application/location-transfer-service'
export { commitStocktake, getStocktake, previewStocktake } from './application/inventory-stocktake-service'
export {
  applyCustomizationWorkOrderAction,
  cancelCustomizationWorkOrder,
  completeCustomizationWorkOrder,
  getCustomizationWorkOrder,
  listCustomizationWorkOrders,
  openCustomizationWorkOrder,
  releaseCustomizationWorkOrder,
} from './application/customization-work-order-service'
export {
  applyKittingWorkOrderAction,
  cancelKittingWorkOrder,
  completeKittingWorkOrder,
  getKittingWorkOrder,
  listKittingWorkOrders,
  openKittingWorkOrder,
  releaseKittingWorkOrder,
} from './application/kitting-work-order-service'
export { deKitFinishedSets } from './application/de-kitting-service'
export { recordLotMaintenance, shelfLifeAudit } from './application/inventory-shelf-life-service'
export {
  applyReservationAction,
  availableToPromiseFor,
  createReservation,
  expireDueReservations,
  listReservations,
  maxBuildableSets,
} from './application/inventory-atp-service'
