---
domain: procurement
feature: FR-164
module: procurement
source: legacy-prior-art
bundle: FEAT-024
requirements:
  - FR-164
version: "0.1.0"
status: building
---

# FR-164 — Suppliers and purchase orders (po_id)

## Intent

Whom the Business buys from and what it has on order: an approved supplier
with its terms, and a purchase order against it with lines at the agreed
cost, a status machine, and money that is exact. The legacy ERD's Phase 5
procurement shapes adapted under
[ADR-066](../../../decisions/ADR-066-PROCUREMENT-LANE-SUPPLIERS-ORDERS-AND-RECEIPTS-BOUNDARY.md),
the first slice of the Procurement lane and the "Procurement" module of the
owner's SCM row (`docs/ERP-MODULE-MAP.md`).

## Decisions worth recording

**A supplier is a row of this Business.** `code` unique per Tenant is an
attribute (BR-002); the contact, tax id, payment terms and lead time are
plain columns; ARCHIVE keeps the row and its orders, and an archived supplier
takes no new order. A Market Intelligence `SupplierCandidate` is evidence,
not a supplier; making it one is a human's `POST`.

**Lines, not a blob.** `PurchaseOrderLine` rows may name an Inventory SKU of
the same Business (a non-archived one) and carry the unit cost agreed for
this purchase — not Inventory's catalogue `baseCost`. That is what lets a
receipt be posted line by line and lets a report ask what a SKU cost last
time.

**Nothing about quantities or money is stored twice.** Columns hold integer
satang for the unit cost only; the total, the received value, the
outstanding value, each line's received and outstanding quantity and the
order's `receiptState` are computed on every read from the lines and their
receipt lines.

**"Partially received" is a state, not a status.** DRAFT → SENT is the
buyer's; RECEIVED is set only by the receipt that completes every line
(FR-165); CLOSE is the explicit short-close of a SENT order with lines
outstanding; CANCEL is possible only while nothing was received.

**Same write discipline.** Generated `PO-YYYYMMDD-NNN`, lines and supplier
editable only while DRAFT (SEND locks them; notes and the expected date stay
editable while open), compare-and-swap on `version`, one audit row per
action, nothing deleted; the procurement domain gate then OWNER or
`PROCUREMENT_BUYER`, every refusal of scope the FR-072 404.

## Delivered (local, 2026-09-07)

- `Supplier`, `PurchaseOrder`, `PurchaseOrderLine` in both schemas; migration
  `20260907010000_procurement` in both trees (**not applied**), shared with
  FR-165.
- `src/modules/procurement/domain/procurement.js` (money, contracts, totals,
  receipt state, status machine, codes); `application/supplier-service.js`
  and `application/purchase-order-service.js` — the only writers.
- `GET/POST /api/procurement/suppliers`, `GET/PATCH /api/procurement/suppliers/[id]`,
  `GET/POST /api/procurement/purchase-orders`, `GET/PATCH /api/procurement/purchase-orders/[id]`;
  the `procurement` slot (`Truck`) after Warehouse; the `/procurement`
  dashboard (suppliers, what is on order) and the `/procurement/purchase-orders`
  console; `PROCUREMENT_BUYER` role.
- Tests: `tests/integration/fr164-procurement.test.js` (AC-164.1–.5),
  `tests/unit/procurement-domain.test.js`, `tests/unit/procurement-routes.test.js`,
  `tests/e2e/fr164-procurement.spec.js` (shared with FR-165).

## Not in this slice

Purchase requests and approvals; RFQs and supplier quotes; supplier invoices
and payables; a purchase order from a LINE chat; production application of
the migration (ADR-057).
