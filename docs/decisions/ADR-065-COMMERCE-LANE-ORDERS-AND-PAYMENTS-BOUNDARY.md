---
version: "1.0.0"
created_at: "2026-09-07T00:30:00+07:00,Claude Fable 5.1"
last_update: "2026-09-07T00:30:00+07:00,Claude Fable 5.1"
status: "accepted"
superseded_by: null
attributes:
  domain: "commerce"
  doc_type: "architecture-decision"
  scope: "the Commerce lane's first slice — sales orders and the payments against them — borrowed from the legacy ERD's Orders & Payments section under ADR-054 D5, with the corrections that make the shapes native"
---

# ADR-065 — The Commerce Lane: Orders and Payments

**Status:** Accepted. Implemented by FR-162 and FR-163 (FEAT-023) in the same change.
**Date:** 2026-09-07
**Decided by:** Boss (instruction of 2026-09-06: "ทำ Orders/Payments ต่อเลย")
**Relates to:** [ADR-054](ADR-054-LEGACY-ERD-IS-PRIOR-ART-FOR-CRM-INTELLIGENCE.md) (D3, D4, D5),
[ADR-064](ADR-064-SALES-TASKS-ARE-A-CRM-ACTIVITY-NOT-A-PROJECT-TASK.md), [ADR-024](ADR-024-ZURI-AI-IS-A-STANDALONE-PRODUCT.md) (D7),
FR-154, FR-155, FR-162, FR-163, FEAT-020, FEAT-023, BR-001, BR-002, FR-061, FR-072, FR-076,
`docs/domains/commerce/CHARTER.md`, `docs/domains/inventory/ONTOLOGY.md`,
`docs/architecture/database-erd/full-schema.md` §19–§20.

## Context

ADR-054 D5 deferred the legacy ERD's "5. CORE: Orders & Payments" (`Order`, `Transaction`,
the slip-OCR flow, the store-versus-ads revenue split) as prior art for a future FEAT. The
`commerce` domain slot has existed in the registry since the shell was designed, reserved
with nothing behind it. The Inventory lane (FEAT-020) now holds the goods; the owner's
ontology names the offer layer (`CatalogOffer`, `GiftTier`, `RecipientSegment`,
`CorporateClient`, `ORDERED`) as Commerce's. What was missing was the record of a sale and of
the money that settles it.

The legacy shapes carry four patterns this repository has standing rules against: a stored
`paidAmount` (a number a page can disagree with), `items` as a JSON blob (no line a stock
issue can name), a bank reference as a **unique key** (an external id as identity), and a
money column as `float`. Recording the corrections matters as much as the adoption (ADR-054's
own reason).

## Decision

### D1 — Commerce is a lane; Orders and Payments are its first slice

`docs/domains/commerce/CHARTER.md` claims `SalesOrder`, `SalesOrderLine` and `Payment`, the
route key `commerce` (its slot leaves `soon`), and `/commerce/**`. The offer layer from the
owner's ontology stays deferred inside this same lane: a sales order line names a SKU and a
price *given at the time of sale*; a catalogue price, tiers and segments arrive as their own
FRs here, never as an Inventory concern.

### D2 — What survives from the legacy shape, and what is corrected on the way in

| Legacy | Here | Why |
|---|---|---|
| `Order.items` JSON `[{productId,name,price,qty}]` | `SalesOrderLine` rows, `productId?` → Inventory `Product` | a line can be issued from stock, priced, discounted, and queried |
| `Order.paidAmount`, `totalAmount` stored | **computed on read**: total from lines, paid from VERIFIED payments, `paymentState` derived | the progress rule — a stored number is the one the page disagrees with |
| `float` money | **integer satang** columns, baht in the API | exact; 0.1 + 0.2 stops being a bug |
| `Order.conversationId` null = store, UUID = ads | `origin` CHAT / WALK_IN / ONLINE with `conversationId` forcing CHAT; `attributed` on the DTO | the revenue split is explicit and survives a conversation being deleted |
| `Order.closedById` → Employee | `closedByPersonId` (scalar, the viewer's principal) | no Employee here (ADR-054 D5); the audit row is the authority |
| `Transaction` | `Payment` | "transaction" is the database's word; and `kind` PAYMENT / REFUND says what it is |
| `Transaction.refNumber` **UK** | `bankReference` **unique per Tenant**, nullable, an attribute | the duplicate-slip rule is kept; the key is refused (BR-002, ADR-054 D4) |
| `slipStatus` PENDING / VERIFIED / FAILED, `slipUrl`, `slipData` OCR | `status` PENDING / VERIFIED / REJECTED, `slipFileAssetId` → `FileAsset` of the same Business | the slip's bytes live where every file lives; OCR is a later candidate that never verifies itself (the Asset evidence rule) |
| `Transaction.type` CREDIT | **not a payment** | store credit is a liability, its own concept when it comes |
| "ROAS from VERIFIED only" | `revenueSummary`: VERIFIED payments net of VERIFIED refunds, by origin and day; pending beside it | kept exactly; the Ad model that would consume it is still Marketing's future |

### D3 — Scope follows ADR-054 D3

An order is Business-scoped; its optional Customer and Conversation are reached through the
Business's tenant only (BR-001, the bound `conversation-read-model` reads through) and never
from the payload; a Conversation supplies its Customer and refuses a different one. A line's
product must be an ACTIVE SKU of the same Business.

### D4 — Fulfilment goes through the Inventory contract, and does not widen it

COMPLETE may issue stock: every line naming a counted SKU is issued through Inventory's
exported `appendMovement` inside the order's own transaction, with `ORDER:<code>` as the
reference — refused whole when any is short, when a line names a SERIAL-tracked SKU, or when
the viewer lacks Inventory's write authority. A Commerce role never grants an Inventory
write; the two ladders are checked separately, on purpose.

### D5 — Authority

Reading needs Business visibility plus the `commerce` domain (FR-061); every refusal of
scope is the FR-072 404. Writing an order and recording a payment need Business OWNER or
`SALES_REP` (`commerce.order.write` — the rep who closes the sale records the slip);
verifying or rejecting a payment needs Business OWNER or the new `PAYMENT_VERIFIER`
(`commerce.payment.verify`), because verified money is what revenue is counted from.

### D6 — What this does not decide

Slip OCR (a candidate extraction, never a verification); the offer / price-tier catalogue;
invoices, receipts and tax documents; store credit; an Ad model and ROAS; a Procurement
lane for the purchase side. Each is its own FR, in this lane or its neighbour.

## Consequences

- The Commerce slot is live: `/commerce` (revenue dashboard) and `/commerce/orders`.
- `docs/domains/inventory/ONTOLOGY.md`'s "deferred to a Commerce lane" now points at a
  chartered lane; the offer layer is still deferred, inside it.
- ERD §20 row 5 (legacy Orders & Payments) moves from *target* to *built, corrected*.
- Three tables and one migration; production SQL not applied (ADR-057).
