---
version: "1.0.0"
created_at: "2026-09-07T02:00:00+07:00,Claude Fable 5.1"
last_update: "2026-09-07T02:00:00+07:00,Claude Fable 5.1"
status: "accepted"
superseded_by: null
attributes:
  domain: "procurement"
  doc_type: "architecture-decision"
  scope: "the Procurement lane's first slice — suppliers, purchase orders and the goods receipts that post into the Inventory ledger — the buy side the owner's SCM row names, borrowed from the legacy ERD's Phase 5 procurement shapes under ADR-054 D5 with the corrections that make them native"
---

# ADR-066 — The Procurement Lane: Suppliers, Purchase Orders and Goods Receipts

**Status:** Accepted. Implemented by FR-160 and FR-161 (FEAT-023) in the same change.
**Date:** 2026-09-07
**Decided by:** Boss (instruction of 2026-09-07: "แก้เอกสารที่เกี่ยวข้อง แล้วทำ Procurement ต่อเลย", after naming the SCM row "Warehouse, Inventory, Procurement, Order Management")
**Relates to:** [ADR-054](ADR-054-LEGACY-ERD-IS-PRIOR-ART-FOR-CRM-INTELLIGENCE.md) (D3, D4, D5),
[ADR-065](ADR-065-COMMERCE-LANE-ORDERS-AND-PAYMENTS-BOUNDARY.md) (D2, D4), [ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md) (D7),
FR-154, FR-155, FR-160, FR-161, FEAT-020, FEAT-023, BR-001, BR-002, FR-061, FR-072, FR-076,
`docs/domains/procurement/CHARTER.md`, `docs/ERP-MODULE-MAP.md`,
`docs/architecture/database-erd/full-schema.md` §20–§21.

## Context

The owner's ERP taxonomy row "Supply Chain Management (SCM) — Warehouse, Inventory, Procurement,
Order Management" named four modules. Three had a home: Inventory (FEAT-020) holds the goods and
the ledger, Commerce (FEAT-022) holds the sell-side order, and Warehouse is Inventory's display
label with locations still deferred. Procurement had none. Four documents said where it would
live and disagreed: the Market Intelligence charter attributed "approved Vendor and Procurement
execution" to Commerce, the Asset Management charter called it a "future Procurement authority",
the Inventory charter said "future Procurement lane", and the ERD's legacy-mapping row for
"Phase 5 shared/procurement" (`Supplier`, `PurchaseOrderV2`, `POItem`, `GRN…`, `POReturn`,
`CreditNote`, `Advance`) was a target with no owner.

Meanwhile the ledger already accepted a RECEIPT with a free-text reference such as `PO-1`
(FR-155), so stock could arrive with no record of what was ordered, from whom, at what cost, or
whether the delivery matched the order. A goods receipt that is only a ledger row cannot answer
"what is still outstanding".

## Decision

### D1 — Procurement is a lane; suppliers, orders and receipts are its first slice

`docs/domains/procurement/CHARTER.md` claims `Supplier`, `PurchaseOrder`, `PurchaseOrderLine`,
`GoodsReceipt` and `GoodsReceiptLine`, the route key `procurement` (a new slot in
`src/config/domains.js`, live from the first commit because both pages exist) and
`/procurement/**`. It is the **buy side**; Commerce stays the sell side; both meet only in
Inventory's ledger — a receipt adds, a fulfilled sales order removes — and neither touches the
other. The four documents above now say so, in the same change.

### D2 — What survives from the legacy shape, and what is corrected on the way in

| Legacy (zuri1.0 Phase 5) | Here | Why |
|---|---|---|
| `Supplier` | `Supplier`, `code` unique per Tenant, ACTIVE / ARCHIVED | the code is an attribute (BR-002); archiving keeps the row and its orders |
| `PurchaseOrderV2` with `POItem` | `PurchaseOrder` with `PurchaseOrderLine` rows, `productId?` → Inventory `Product` | a line can be received against, costed and queried; "V2" is not a name |
| stored received / outstanding quantities and totals | **computed on read** from the lines and the receipt lines; `receiptState` NONE / PARTIAL / COMPLETE derived | the progress rule — a stored number is the one the page disagrees with |
| `float` cost | **integer satang** `unitCostSatang`, baht in the API | the ADR-065 D2 money rule, unchanged |
| "partially received" as a status | not a status: `receiptState` on the DTO; `RECEIVED` is set only by the receipt that completes every line, `CLOSED` is the explicit short-close | a status that a later receipt would have to keep in step with a computed number is two sources of truth |
| `GRN…` as its own stock table | `GoodsReceipt` + `GoodsReceiptLine` as the **record**; the stock effect is Inventory's `StockMovement` rows with reference `PO:<code>/GRN:<code>` | one ledger (FR-155); the receipt says what was delivered, the ledger says what is held |
| `POReturn`, `CreditNote`, `Advance` | **not modelled** | each is its own FR; a wrong receipt is corrected by an Inventory ADJUSTMENT today |
| `MarketPrice`, `PurchaseRequest`, `PurchaseRequestItem` (ONTOLOGY.md) | **deferred inside this lane** | a purchase order is created directly in this slice |

### D3 — Scope follows ADR-054 D3

A supplier and an order are Business-scoped; an order names an ACTIVE supplier of its own
Business (`422 SUPPLIER_NOT_FOUND` for another Business's, `409 SUPPLIER_ARCHIVED`); a line's
product must be a non-archived SKU of the same Business. Nothing is reached from the payload.

### D4 — A receipt posts through the Inventory contract, and does not widen it

A receipt line whose order line names a counted SKU calls Inventory's exported
`appendMovement` inside the receipt's own transaction: `lotCode` names or creates the lot
(a LOT-tracked SKU needs one — Inventory's `INVENTORY_LOT_REQUIRED` bubbles up), a given
`expiresAt` is set on a lot that has none yet, `serialNos` create the units (one per unit —
`INVENTORY_SERIAL_COUNT_MISMATCH` bubbles up), and the reference `PO:<code>/GRN:<code>` ties
every ledger row back. The viewer needs Inventory's own write authority for that half
(`403 PROCUREMENT_RECEIPT_REQUIRES_INVENTORY_AUTHORITY`); a `PROCUREMENT_BUYER` binding never
grants an Inventory write. The two ladders are checked separately, on purpose — the same rule
ADR-065 D4 set for fulfilment. A receipt of only free-text or uncounted lines needs no
Inventory authority because it touches no ledger.

### D5 — Authority

Reading needs Business visibility plus the `procurement` domain (FR-061); every refusal of
scope is the FR-072 404. Keeping suppliers and orders needs Business OWNER or the new
`PROCUREMENT_BUYER` (`procurement.po.write`); posting a receipt needs Business OWNER or the
buyer's `procurement.receipt.post` — one role, two permissions, so a later split of "orders"
from "receiving" is a registry change and not a schema one.

### D6 — Nothing about a receipt is edited

A goods receipt is posted by its creation, has no status, no version and no PATCH. The order's
`version` moves with each receipt so a stale caller conflicts. A wrong receipt is corrected in
the ledger (ADJUSTMENT) and, when a return FR exists, by a return; never by rewriting history.

### D7 — What this does not decide

Purchase requests and approvals; RFQs and supplier quotes; purchase returns and credit notes;
supplier invoices, payables and advances; landed cost and valuation; warehouse locations for
a receipt; the promotion of a Market Intelligence `SupplierCandidate` into a `Supplier`. Each
is its own FR, in this lane or its neighbour.

## Consequences

- The Procurement slot is live: `/procurement` (suppliers and what is on order) and
  `/procurement/purchase-orders` (orders, receipts).
- `docs/ERP-MODULE-MAP.md` records the owner's SCM row with each module's lane and state.
- ERD §20 gains the Procurement section; the legacy-mapping row "Phase 5 shared/procurement"
  moves from *target* to *built, corrected*.
- Five tables and one migration; production SQL not applied (ADR-057).
