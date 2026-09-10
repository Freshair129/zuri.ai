---
id: ZAI:RCA-COMMERCE-P3-BILLING-POS-CONTRACT-GAP
version: "0.2.3b"
status: beta
superseded_by: null
created_at: "2026-09-10T23:55:29+07:00,RWANG"
last_update: "2026-09-11T02:22:08+07:00,RWANG"
attributes:
  domain: commerce
  doc_type: root-cause-analysis
  scope: "Audited P3 billing, PromptPay and POS branch"
---

# RCA — audited P3 billing, PromptPay and POS contract gap

This RCA supports the owner-approved contract in
[`docs/change-requests/ZAI-PROPOSAL-COMMERCE-BILLING-POS-20260910.md`](../../docs/change-requests/ZAI-PROPOSAL-COMMERCE-BILLING-POS-20260910.md).
The new contract is assigned to FR-186 and FR-183; implementation remains
bounded by those rows and the approved proposal.

## Symptom

The audited P3 branch presents fiscal documents, PromptPay and POS checkout,
but the implementation does not compose the current Commerce and Inventory
contracts. It can fail against the current order DTO, fabricate seller and
recipient identity, mark an unverified payment as verified, and write stock
movements outside the Inventory authority.

## Evidence

- `billing-invoice-service.js:144-189` reads fields absent from the current
  order DTO and falls back to a fabricated seller, tax id, branch and address.
- `billing-invoice-service.js:73-105` accepts an arbitrary or empty PromptPay
  target and has a fallback path instead of resolving a configured Business
  recipient.
- `pos-cashier-service.js:31-58` silently defaults terminal/branch values and
  coerces invalid quantities; `:130-171` creates a `VERIFIED` payment as its
  own verifier and writes `StockMovement` directly.
- `pos-cashier-service.js:226-286` derives a retail price from inventory
  `baseCost` and a markup fallback even though the approved catalogue/price
  source is deferred.
- `commerce-p3-billing-pos.test.js:49-195` uses arbitrary identifiers and an
  in-memory transaction mock, so it does not exercise real scope, schema,
  payment verification, Inventory appendMovement or rollback behavior.

The complete evidence table and proposed acceptance tests are in the linked
candidate contract.

Follow-up review of the approved implementation found one additional UI
idempotency defect and three related deep-link state defects:

- `BillingWorkspace.jsx` generated a local key and stored it in React state,
  then called `requestBody(true)` in the same render. Because the state update
  is asynchronous, the first POST generated a second key; a retry used the
  first key. A lost first response could therefore leave the user unable to
  prove that the retry addressed the original request.
- The durable document view was nested under the currently listed order. The
  order API is deliberately capped at 50, so an issued document whose order
  is older than that window could be fetched successfully but not rendered.
- Selection changes did not advance the action generation fence, allowing a
  held refresh to restore a document after the user changed document type,
  branch or order. An inaccessible linked document cleared the URL but could
  leave stale state mounted.

Line's focused UI repair is now in the working tree. The focused browser proof
passed with `--no-deps --retries=0`: the first POST and retry carried the same
key, a document outside the 50-order list rendered from its durable snapshot,
a held refresh could not overwrite a new order selection, and a Business-B
deep link to a Business-A document was rejected by the UI and cleared from the
URL.

## Root Cause

The branch implemented a product-wide prototype before an approved billing/POS
contract existed. It filled missing business, legal, payment-recipient,
terminal and price authorities with constants, defaults and markup logic, and
its tests encoded those assumptions through synthetic persistence. The result
is a contract boundary failure, not an isolated field typo.

## Why the issue escaped detection

The branch was a one-commit addition based on an older main revision. The
current Commerce docs defer fiscal documents and do not expose the new routes,
models or integration requirements. Governance and route inventory therefore
had no accepted requirement to compare against, while the synthetic test
transaction could not reveal DTO, enum, scope, ledger or transaction defects.
The initial browser proof also checked the durable number after reload but did
not inspect the first issue request's idempotency key or exercise a document
outside the capped order list; the UI defects remained undetected.

## Proposed prevention

Approve the linked minimal contract and allocate new requirement ids before
implementation. Require configured Business OWNER inputs with explicit
unavailable outcomes; snapshot buyer issuance input, seller, tax, PromptPay and
payment facts; issue documents transactionally with a per-Business/type/year
sequence and idempotency; compose FR-166/FR-163 and Inventory `appendMovement`;
and add real SQLite integration, rollback, authorization, monetary, OpenAPI and
governance tests. Keep local fixtures clearly labeled and do not treat QR
encoding, local issuance or pending payment as bank, statutory or production
evidence. The UI must pass the exact local idempotency key into its first POST,
render a linked immutable document independently of the capped order list, and
fence scope and selection changes before accepting delayed responses.

## Status

The owner-approved implementation is complete in this source handoff. Backend,
schema, recovery, POS, SQL and BillingWorkspace repairs have focused evidence;
the parent integration task still owns the combined full-suite gate and
canonical document ledger reconciliation.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-10 | candidate | RCA for audited P3 contract and authority failures | 260d04c0 | RWANG |
| 0.2.0b | 2026-09-11 | beta | Owner-approved RCA scope for FR-186/FR-183 implementation | pending | RWANG |
| 0.2.1b | 2026-09-11 | beta | Published PR #318 claimed FR-182 for SCM; the same approved billing subject is renumbered to FR-186 through the id-ledger abandonment path, with POS FR-183 unchanged | pending | RWANG |
| 0.2.2b | 2026-09-11 | beta | Recorded the UI idempotency-key and durable deep-link findings; Line handoff remains open pending exact-key and capped-order regression proof | pending | RWANG |
| 0.2.3b | 2026-09-11 | beta | Recorded focused browser proof for exact-key retries, capped-order rendering, delayed selection and cross-Business deep-link clearing | pending | RWANG |
