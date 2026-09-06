---
domain_id: DOM-COMMERCE
domain: commerce
modules:
  - commerce
owns_models:
  - SalesOrder
  - SalesOrderLine
  - Payment
owns_routes:
  - src/app/(pm)/commerce/**
  - src/app/api/commerce/**
owns_code:
  - src/modules/commerce/**
technical_owner: TD-COMMERCE
status: active-foundation
version: "1.0.0"
created_at: "2026-09-07T00:30:00+07:00"
updated_at: "2026-09-07T00:30:00+07:00"
---

<!-- owns_routes are longest-prefix globs (ADR-025). The two claims reserve the
     `/commerce` page tree and the `/api/commerce/**` handlers away from
     project-manager's `src/app/(pm)/**` + `src/app/api/**` catch-all. The
     generators read each list as an unbroken run of `  - value` lines, so
     annotations stay outside the frontmatter. -->

# Commerce domain charter

## Mission

Commerce is the Business-scoped authority for **what the Business sold and how
the money settled**: the sales order with its lines, the payments and refunds
against it, and the revenue that only verified money makes. It answers, for
every Business,

1. What did we sell, to whom, from which conversation, for how much?
2. What has actually been paid — verified, not merely claimed — and what is
   still owed?
3. Where did the revenue come from: chat (attributed to a Conversation), the
   shop floor, online?
4. Which stock did a sale consume?

Stable identities:

```text
Product domain:   DOM-COMMERCE
Technical owner:  TD-COMMERCE
Route key:        commerce
Display label:    Commerce
```

Architecture decision: [ADR-065](../../decisions/ADR-065-COMMERCE-LANE-ORDERS-AND-PAYMENTS-BOUNDARY.md).

## Owned records

- `SalesOrder` (`order_id`) — `code` `ORD-YYYYMMDD-NNN` unique per Tenant,
  Business-scoped, optional `Customer` and `Conversation` of the same Tenant,
  `origin` CHAT / WALK_IN / ONLINE, DRAFT → CONFIRMED → COMPLETED, cancel from
  either open state, money as integer satang (FR-162).
- `SalesOrderLine` — a line that may name an Inventory `Product` (SKU) with a
  price given at the time of sale, a quantity and a discount (FR-162).
- `Payment` (`payment_id`) — `code` `PAY-YYYYMMDD-NNN`, PAYMENT or REFUND,
  method, amount, PENDING → VERIFIED | REJECTED, `bankReference` unique per
  Tenant as an attribute, the slip as a `FileAsset` (FR-163).

**Never stored:** an order's total, paid, balance or payment state. They are
computed on every read from the lines and the VERIFIED payments — the same
rule progress and stock on-hand follow.

## Explicitly not owned

| Concept | Authority | Commerce behavior |
|---|---|---|
| `Product`, `ProductMaster`, stock and its ledger | Inventory | a line names a SKU by internal id; fulfilment calls Inventory's exported `appendMovement` inside the order's transaction and never widens Inventory's authority |
| `Customer`, `Conversation` | crm | read by internal id through the Business's tenant (BR-001); never written |
| `FileAsset` bytes | file management | the slip is a reference; bytes stay where every file lives |
| Catalogue offers, gift tiers, recipient segments, price tiers, corporate clients (`CatalogOffer`, `GiftTier`, `RecipientSegment`, `CorporateClient` in the owner's ontology) | **this lane, later** — each its own FR | a line's price is given at sale time until an offer catalogue exists |
| Slip OCR | a later candidate extraction (the Asset evidence rule: a candidate never verifies itself) | a human verifies; `PAYMENT_VERIFIER` or the owner |
| Invoices, receipts, tax documents, store credit | future Finance / Commerce FRs | not modelled |
| Ads, ROAS, attribution to an ad | future Marketing lane | `origin` CHAT and `conversationId` are the hook; no ad id is stored (ADR-054 D5) |
| Purchase orders, suppliers | future Procurement | not modelled |

## Scope and authorization

Every owned row carries `tenantId` and `businessId`, derived on the server from
the trusted viewer and the selected visible Business (`businessId` in a request
is a selector the service validates, never the scope). Reading needs Business
visibility plus the `commerce` domain (FR-061). Writing an order and recording
a payment need Business OWNER or `SALES_REP` (`commerce.order.write`);
verifying or rejecting a payment needs Business OWNER or `PAYMENT_VERIFIER`
(`commerce.payment.verify`). Every refusal of scope is the FR-072
`404 Business not found`.

## Aggregate invariants

- Internal keys are UUIDs; codes and bank references are never keys.
- Money is integer satang in every column; the API speaks baht with at most
  two decimals.
- Lines change only while DRAFT; CONFIRM locks them; COMPLETE needs CONFIRMED.
- A payment cannot be recorded on a CANCELLED order; a refund can, and a refund
  is never verified beyond what was verifiably paid.
- Only VERIFIED payments count — for the order's state and for revenue.
- Fulfilment issues every counted line or nothing; a SERIAL-tracked line is
  refused (a sale cannot pick serials).
- Every write is one transaction that bumps `version` and appends one
  `AuditEvent` (`SALES_ORDER`, `PAYMENT`).

## Source layout

```text
src/modules/commerce/
├── domain/commerce.js                          money, contracts, totals, status machines, revenue
├── application/commerce-authority.js           the view / order / verify ladder, FR-072 refusals
├── application/sales-order-service.js          the only writer of orders and lines (FR-162)
├── application/payment-service.js              the only writer of payments (FR-163)
├── application/revenue-read-model.js           verified revenue by origin and day (read-only)
└── index.js                                    stable module exports
```

Runtime surfaces are `/commerce`, `/commerce/orders` and `/api/commerce/**`.

## Delivery state

FR-162 and FR-163 are implemented locally with both migrations written
(`20260907000000_commerce_orders_payments`) and the production SQL **not
applied** (an owner-instructed operator step, ADR-057). Not in this slice: the
offer catalogue, slip OCR, invoices and receipts, store credit, LINE intake of
an order from a chat.

## References

- [ADR-065](../../decisions/ADR-065-COMMERCE-LANE-ORDERS-AND-PAYMENTS-BOUNDARY.md)
- [FR-162 sales orders](features/FR-162-sales-orders.md)
- [FR-163 payments and revenue](features/FR-163-payments-and-revenue.md)
- [Inventory ontology record](../inventory/ONTOLOGY.md) — the offer layer this lane still owes

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-07 | active-foundation | Established the Commerce lane with sales orders, lines and payments; corrections from the legacy Orders & Payments shape recorded in ADR-065 | working-tree | Claude Fable 5.1 |
