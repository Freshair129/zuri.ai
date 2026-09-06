---
domain: commerce
feature: FR-159
module: commerce
source: legacy-prior-art
bundle: FEAT-022
requirements:
  - FR-159
version: "0.1.0"
status: building
---

# FR-159 — Payments, verification and revenue (payment_id)

## Intent

The money side of a sale: a payment or refund recorded against an order,
verified by someone whose job it is, and revenue that counts only what was
verified. The legacy "Transaction" with its slip flow, adapted under
[ADR-065](../../../decisions/ADR-065-COMMERCE-LANE-ORDERS-AND-PAYMENTS-BOUNDARY.md).

## Decisions worth recording

**Recording and verifying are two hats.** A `SALES_REP` (or the owner)
records what the customer sent — method, amount, bank reference, the slip as
a `FileAsset` of the same Business — as PENDING. A `PAYMENT_VERIFIER` (or the
owner) confirms or rejects it. Only VERIFIED money counts, for the order's
paid / balance / payment state and for revenue; rejected and pending money
are reported beside it, never inside it.

**The bank reference stays a rule, not a key.** The legacy `refNumber UK`
"prevents duplicate"; here `bankReference` is nullable, unique per Tenant,
and an attribute (BR-002, ADR-054 D4) — the duplicate-slip refusal is kept
(`PAYMENT_REFERENCE_TAKEN`), the identity is refused.

**Refunds are bounded.** A refund is a `Payment` of kind REFUND; verifying
one beyond what was verifiably paid is refused. A payment cannot be recorded
on a CANCELLED order; a refund can, so a cancelled sale can be made whole.

**OCR is not verification.** The slip image is attached; extracting an
amount from it is a later candidate step that can never approve itself (the
Asset evidence rule). Nothing here calls a vision model.

**Revenue by origin and day.** `revenueSummary` counts VERIFIED payments net
of VERIFIED refunds on the day the money was paid, in the Business's calendar
(Asia/Bangkok), split by the order's origin (CHAT — attributed to a
Conversation — WALK_IN, ONLINE). The legacy "ROAS from VERIFIED only" is
kept exactly; the Ad model that would consume it is still Marketing's future.

## Delivered (local, 2026-09-07)

- `Payment` in both schemas (migration shared with FR-158, **not applied**).
- `application/payment-service.js` — the only writer: record, verify, reject;
  `application/revenue-read-model.js` — read-only.
- `GET/POST /api/commerce/orders/[id]/payments`, `GET/PATCH
  /api/commerce/payments/[id]`, `GET /api/commerce/revenue`; the `/commerce`
  dashboard (verified net, by origin, by day, pending, order counts) and the
  payment panel of the orders console; `PAYMENT_VERIFIER` role.
- Tests: `tests/integration/fr159-payment.test.js` (AC-159.1–.4), the
  calculators in `tests/unit/commerce-domain.test.js`, the e2e spec.

## Not in this slice

Slip OCR; receipts and invoices; store credit; partial-refund allocation to
lines; reconciliation against a bank statement; production application of
the migration (ADR-057).
