// @req FR-154, FR-155 — the Inventory module's stable exports: the pure
//   vocabulary and calculators, the authority ladder, the catalogue writer and
//   the stock-ledger writer. Other lanes import from here, never from a file
//   inside `application/` directly.
// @spec ADR-025 (one module, one charter: docs/domains/inventory/CHARTER.md)
// @tested tests/unit/inventory-domain.test.js
export * from './domain/inventory'
export { assertMayManage, assertMayView, mayManage, mayView } from './application/inventory-authority'
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
} from './application/inventory-catalog-service'
export {
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
