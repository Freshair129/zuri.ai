// @req FR-166, FR-163 — the Commerce module's stable exports: the pure
//   vocabulary and calculators, the authority ladder, the sales order writer,
//   the payment writer and the revenue read model. Other lanes import from
//   here, never from a file inside `application/` directly.
// @spec ADR-065; ADR-025 (one module, one charter: docs/domains/commerce/CHARTER.md)
// @tested tests/unit/commerce-domain.test.js
export * from './domain/commerce'
export * from './domain/billing'
export { assertMayView, mayView, mayVerifyPayments, mayWriteOrders } from './application/commerce-authority'
export { applyOrderAction, createOrder, getOrder, listOrders } from './application/sales-order-service'
export { applyPaymentAction, getPayment, listPayments, recordPayment } from './application/payment-service'
export { getRevenueSummary } from './application/revenue-read-model'
export { getBillingDocument, getBillingProfile, issueBillingDocument, previewBillingDocument, updateBillingProfile } from './application/billing-invoice-service'
export { checkoutPosSale, getPosTerminalCatalogue } from './application/pos-cashier-service'
