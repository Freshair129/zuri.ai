// @req FR-164, FR-165 — the Procurement module's stable exports: the pure
//   vocabulary and calculators, the authority ladder, the supplier writer, the
//   purchase-order writer and the goods-receipt writer. Other lanes import
//   from here, never from a file inside `application/` directly.
// @spec ADR-066; ADR-025 (one module, one charter: docs/domains/procurement/CHARTER.md)
// @tested tests/unit/procurement-domain.test.js
export * from './domain/procurement'
export { assertMayView, mayPostReceipts, mayView, mayWritePurchaseOrders } from './application/procurement-authority'
export { applySupplierAction, createSupplier, getSupplier, listSuppliers } from './application/supplier-service'
export { applyPurchaseOrderAction, createPurchaseOrder, getPurchaseOrder, listPurchaseOrders } from './application/purchase-order-service'
export { listGoodsReceipts, postGoodsReceipt } from './application/goods-receipt-service'
