---
id: ZAI:ADR-120
title: Verified settlement before order completion and stock issue
version: "1.0.0"
status: accepted
created_at: "2026-11-25"
last_update: "2026-11-25"
author: Claude Sonnet 5.5
superseded_by: null
approval_scope: behaviour-amendment-fr-166-complete-guard-no-migration-no-backfill-no-pos-change
approved_on: "2026-11-25"
approved_by: "Delegated product-owner decision D-D11 (Astra, gpt-6-astra) under owner instruction 2026-11-08, relayed by the lead Claude session; this is not human approval and no other approval is claimed"
attributes:
  doc_type: architecture-decision
  domain: commerce
  scope: "Non-POS sales orders cannot reach COMPLETED, and stock cannot be issued, until VERIFIED payments net of VERIFIED refunds cover the order total; POS checkout (FR-183) and historical rows are unchanged"
relations:
  - type: relates_to
    target: ZAI:ADR-065
  - type: relates_to
    target: ZAI:FR-166
  - type: relates_to
    target: ZAI:FR-163
  - type: relates_to
    target: ZAI:FR-183
---

# ADR-120 — Verified settlement before order completion and stock issue

**Status:** Accepted on 2026-11-25 as a reviewed behaviour amendment. It records
delegated product-owner decision D-D11 (Astra, gpt-6-astra) under owner
instruction 2026-11-08, relayed by the lead Claude session. It is not human
approval. It ships no schema column and no migration, rewrites no row, and has
no production effect until deployed.

## Context

FR-166's `COMPLETE` action needed only a CONFIRMED order. It could close an
order, and with `issueStock: true` take stock from the Inventory ledger, while
no money had been verified. Commerce's own rule says only VERIFIED payments
count for an order's state and revenue (FR-163), and store credit is not
modelled, so nothing else can stand in for payment. The review decision D-D11
rejected unpaid non-POS fulfilment.

## Decision

### D1 — Guard in the single writer

`applyOrderAction` refuses `COMPLETE` with `409 COMMERCE_SETTLEMENT_NOT_VERIFIED`
unless the sum of VERIFIED `PAYMENT` rows minus VERIFIED `REFUND` rows is at
least the computed order total. PENDING and REJECTED payments never count. A
zero-total order has nothing to settle. The check runs before any write or
stock movement in the same transaction, so a refusal leaves status, version,
stock ledger and audit exactly as they were. Stock is issued only inside
`COMPLETE`, so the same guard covers stock issue. The error carries
`details: [{ settled, total, verified, pending, shortfall }]`.

### D2 — POS contract unchanged

POS checkout (FR-183) writes its order directly as COMPLETED with a PENDING
payment, never through `applyOrderAction`, and keeps its contract. This record
does not alter it.

### D3 — No history rewrite

No migration, backfill or column. Orders already COMPLETED stay as they are;
only new `COMPLETE` actions are guarded.

## Out of scope and open product questions

- Credit terms, cash-on-delivery or invoice-now-pay-later flows need a
  separately approved override (for example a Business policy or an explicit
  authorised exception). None exists here; the default is refusal.
- Whether the POS PENDING-payment contract should itself change is a separate
  decision.
- Store credit remains not modelled.

## Consequences

Operators must record and verify payment (OWNER or `PAYMENT_VERIFIER`, not the
recorder) before completing a non-POS order. The console shows the refusal
code; `/api/commerce/orders/[id]` PATCH documents it in Appendix A.

## Version history

| Version | Date | Change |
|---|---|---|
| 1.0.0 | 2026-11-25 | Initial acceptance as delegated decision D-D11 |
