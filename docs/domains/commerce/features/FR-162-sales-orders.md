---
domain: commerce
feature: FR-162
module: commerce
source: legacy-prior-art
bundle: FEAT-023
requirements:
  - FR-162
version: "0.1.0"
status: building
---

# FR-162 — Sales orders (order_id)

## Intent

What the Business sold: an order with lines, an optional customer and the
conversation the sale came from, a status machine, and money that is exact.
The legacy ERD's "5. CORE: Orders & Payments" adapted under
[ADR-065](../../../decisions/ADR-065-COMMERCE-LANE-ORDERS-AND-PAYMENTS-BOUNDARY.md),
the first slice of the Commerce lane.

## Decisions worth recording

**Lines, not a JSON blob.** `SalesOrderLine` rows may name an Inventory SKU
(same Business, ACTIVE), carry the price given at the time of sale, a
quantity and a discount. That is what lets a completed order consume stock
and lets a report ask what sold.

**Nothing about money is stored twice.** Columns hold integer satang for
unit prices and discounts only; subtotal, total, paid, balance due and the
payment state are computed on every read from the lines and the VERIFIED
payments — the rule progress and on-hand already follow.

**Origin is explicit.** A sale from a Conversation is `CHAT` whatever was
claimed (the legacy "ads revenue"); the Conversation supplies its Customer
and refuses a different one; otherwise `WALK_IN` or `ONLINE` as stated.
`attributed` on the DTO is simply "has a conversation".

**Fulfilment through the Inventory contract.** COMPLETE with `issueStock`
issues every counted line through Inventory's exported `appendMovement`
inside the order's own transaction (FEFO for lots, reference
`ORDER:<code>`), or nothing: a shortage refuses with the per-SKU list, a
SERIAL-tracked line is refused, and a viewer without Inventory's write
authority is refused — a Commerce role never widens Inventory.

**Same write discipline.** Generated `ORD-YYYYMMDD-NNN`, lines editable only
while DRAFT (CONFIRM locks them), compare-and-swap on `version`, one audit row
per action, nothing deleted; the commerce domain gate then OWNER or
`SALES_REP`, every refusal of scope the FR-072 404.

## Delivered (local, 2026-09-07)

- `SalesOrder`, `SalesOrderLine` in both schemas; migration
  `20260907000000_commerce_orders_payments` in both trees (**not applied**),
  shared with FR-163.
- `src/modules/commerce/domain/commerce.js` (money, contracts, totals, status
  machine, origin, codes); `application/sales-order-service.js` — the only
  writer.
- `GET/POST /api/commerce/orders`, `GET/PATCH /api/commerce/orders/[id]`; the
  `commerce` slot leaves `soon`; the `/commerce/orders` console.
- Tests: `tests/integration/fr162-sales-order.test.js` (AC-162.1–.6),
  `tests/unit/commerce-domain.test.js`, `tests/unit/commerce-routes.test.js`,
  `tests/e2e/fr162-commerce-orders.spec.js` (shared with FR-163).

## Not in this slice

The offer / price-tier catalogue (a line's price is given at sale time);
invoices and receipts; an order from a LINE chat (a converter onto this
writer); serial-tracked fulfilment; production application of the migration
(ADR-057).
