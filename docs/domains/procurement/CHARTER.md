---
domain_id: DOM-PROCUREMENT
domain: procurement
modules:
  - procurement
owns_models:
  - Supplier
  - PurchaseOrder
  - PurchaseOrderLine
  - GoodsReceipt
  - GoodsReceiptLine
owns_routes:
  - src/app/(pm)/procurement/**
  - src/app/api/procurement/**
owns_code:
  - src/modules/procurement/**
technical_owner: TD-PROCUREMENT
status: active-foundation
version: "1.0.0"
created_at: "2026-09-07T02:00:00+07:00"
updated_at: "2026-09-07T02:00:00+07:00"
---

<!-- owns_routes are longest-prefix globs (ADR-025). The two claims reserve the
     `/procurement` page tree and the `/api/procurement/**` handlers away from
     project-manager's `src/app/(pm)/**` + `src/app/api/**` catch-all. The
     generators read each list as an unbroken run of `  - value` lines, so
     annotations stay outside the frontmatter. -->

# Procurement domain charter (จัดซื้อ)

## Mission

Procurement is the Business-scoped authority for **what the Business buys and
what actually arrived**: the approved supplier, the purchase order with its
lines and agreed costs, and the goods receipt that records a delivery and
puts counted goods into the Warehouse. It answers, for every Business,

1. Whom do we buy from, on what terms, and with what lead time?
2. What is on order — from whom, how much, for how much — and what is still
   outstanding against each line?
3. What arrived, when, against which order, and under which delivery note?
4. Which receipt put which lot, expiry and serials into the stock ledger?

Stable identities:

```text
Product domain:   DOM-PROCUREMENT
Technical owner:  TD-PROCUREMENT
Route key:        procurement
Display label:    Procurement
```

Architecture decision: [ADR-066](../../decisions/ADR-066-PROCUREMENT-LANE-SUPPLIERS-ORDERS-AND-RECEIPTS-BOUNDARY.md).

## Owned records

- `Supplier` — `code` unique per Tenant (an attribute, BR-002), name, tax id,
  contact, payment terms, lead time; ACTIVE until archived, never deleted
  (FR-164).
- `PurchaseOrder` (`po_id`) — `code` `PO-YYYYMMDD-NNN` unique per Tenant,
  against one ACTIVE `Supplier` of the same Business; DRAFT → SENT →
  RECEIVED (set by the receipt that completes every line), SENT → SHORT_CLOSED (a
  short-close with lines outstanding), DRAFT or SENT → CANCELLED (only while
  nothing was received); money as integer satang (FR-164).
- `PurchaseOrderLine` — a line that may name an Inventory `Product` (SKU) at
  the unit cost agreed for this purchase, or a free-text item (FR-164).
- `GoodsReceipt` (`grn_id`) — `code` `GRN-YYYYMMDD-NNN`, posted against a SENT
  order with the supplier's delivery-note number as an attribute; never
  edited (FR-165).
- `GoodsReceiptLine` — one received quantity against one order line, with the
  lot code, expiry and serials it carried into the ledger (FR-165).

**Never stored:** an order's total, received value, outstanding value, a
line's received or outstanding quantity, or the order's `receiptState`
(NONE / PARTIAL / COMPLETE). They are computed on every read from the lines
and the receipt lines — the rule progress, stock on-hand and a sales order's
paid amount already follow.

## Explicitly not owned

| Concept | Authority | Procurement behavior |
|---|---|---|
| `Product`, `ProductLot`, `SerialUnit`, `StockMovement` — the goods and the ledger | Inventory | a receipt line naming a counted SKU calls Inventory's exported `appendMovement` inside the receipt's transaction (reference `PO:<code>/GRN:<code>`) and never widens Inventory's authority: the viewer needs Inventory's own write permission for that half |
| Sales orders, payments, revenue | Commerce | the sell side; the two lanes meet only in the ledger (a receipt adds, a fulfilled order removes) |
| Purchase requests, approvals, RFQs, supplier quotes | **this lane, later** — each its own FR | a purchase order is created directly today |
| Purchase returns, credit notes, supplier advances, supplier invoices and payables | future Procurement / Finance FRs | not modelled; a wrong receipt is corrected by an Inventory ADJUSTMENT |
| Landed cost, valuation, COGS | future Finance | `unitCostSatang` is the agreed purchase price of this line, not a valuation and not Inventory's `baseCost` |
| Supplier candidates found in the market | Market Intelligence (`SupplierCandidate`) | evidence, not an approved `Supplier`; promotion is a human's decision recorded here as a new `Supplier` |
| Asset procurement references (`AssetProcurementRef`) | Asset Management | a typed string that may name a PO or GRN code; resolving it to a row is a later FR |

## Scope and authorization

Every owned row carries `tenantId` and `businessId`, derived on the server
from the trusted viewer and the selected visible Business (`businessId` in a
request is a selector the service validates, never the scope). Reading needs
Business visibility plus the `procurement` domain (FR-061). Keeping suppliers
and purchase orders needs Business OWNER or `PROCUREMENT_BUYER`
(`procurement.po.write`); posting a receipt needs Business OWNER or the
buyer's `procurement.receipt.post`, and the ledger rows it writes need
Inventory's write authority on top (`403
PROCUREMENT_RECEIPT_REQUIRES_INVENTORY_AUTHORITY` otherwise — an honest
refusal for a viewer who holds the domain). Every refusal of scope is the
FR-072 `404 Business not found`.

## Aggregate invariants

- Internal keys are UUIDs; codes and delivery-note numbers are never keys.
- Money is integer satang in every column; the API speaks baht with at most
  two decimals.
- A purchase order names an ACTIVE supplier of its own Business; lines and
  the supplier change only while DRAFT; SEND locks them.
- A receipt is posted only against a SENT order, names only that order's
  lines, and never receives more than a line has outstanding — refused whole
  with the per-line list.
- A receipt line naming a counted SKU posts the ledger rows in the same
  transaction, or the receipt does not exist; an uncounted SKU or a free-text
  line touches no ledger and refuses lot or serial data.
- The receipt that completes every line makes the order RECEIVED in the same
  transaction; a RECEIVED, SHORT_CLOSED or CANCELLED order receives nothing more.
- CANCEL is refused once a receipt exists (the stock already moved); CLOSE is
  the short-close for an order that will not be completed.
- Every write is one transaction that bumps `version` where the row has one
  and appends one `AuditEvent` (`SUPPLIER`, `PURCHASE_ORDER`,
  `GOODS_RECEIPT`); a receipt that completes an order also audits the order.
- Nothing is deleted; a receipt is never edited.

## Source layout

```text
src/modules/procurement/
├── domain/procurement.js                       money, contracts, totals, receipt state, status machine, receipt plan
├── application/procurement-authority.js        the view / po / receipt ladder, FR-072 refusals
├── application/supplier-service.js             the only writer of suppliers (FR-164)
├── application/purchase-order-service.js       the only writer of orders and lines (FR-164)
├── application/goods-receipt-service.js        the only writer of receipts; posts into the Inventory ledger (FR-165)
└── index.js                                    stable module exports
```

Runtime surfaces are `/procurement`, `/procurement/purchase-orders` and
`/api/procurement/**`. The domain must not import a page or route to reach
another domain's private repository; cross-domain work uses an explicit
contract (Inventory's `appendMovement`, `mayManage`) or a read projection.

## Delivery state

FR-164 and FR-165 are implemented locally with both migrations written
(`20260907010000_procurement`) and the production SQL **not applied** (an
owner-instructed operator step, ADR-057). Not in this slice: purchase
requests and approvals, RFQs and quotes, purchase returns and credit notes,
supplier invoices and payables, landed cost.

## References

- [ADR-066](../../decisions/ADR-066-PROCUREMENT-LANE-SUPPLIERS-ORDERS-AND-RECEIPTS-BOUNDARY.md)
- [FR-164 suppliers and purchase orders](features/FR-164-suppliers-and-purchase-orders.md)
- [FR-165 goods receipts](features/FR-165-goods-receipts.md)
- [ERP module map](../../ERP-MODULE-MAP.md) — where this lane sits in the owner's SCM row
- [Inventory charter](../inventory/CHARTER.md) — the ledger a receipt posts into

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-07 | active-foundation | Established the Procurement lane with suppliers, purchase orders, lines and goods receipts; the receipt-to-ledger contract and the two-ladder rule recorded in ADR-066 | working-tree | Claude Fable 5.1 |
