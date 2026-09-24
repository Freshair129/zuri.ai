---
id: ZAI:SCM-HANDOFF
version: "0.1.0b"
status: candidate
last_update: "2026-09-24T11:55:00+07:00,Claude Opus 5.5 (Session 5)"
attributes:
  domain: inventory
  scope: session-5-scm-service-extraction-handoff
relations:
  - type: relates_to
    target: ZAI:ADR-109
  - type: relates_to
    target: ZAI:ADR-069
---

# SCM service extraction — Session 5 handoff

**Owner:** Session 5. **Branch:** `feat/scm-service-extraction`, worktree
`.claude/worktrees/scm-service-extraction`. **Base:** `main` @ `fad8ec62`.
**Tested implementation SHAs:** `7726b99b` (S5.1 + receipt slice),
`f60fceb6` (S5.4 POS checkout), `3b522a9d` (S5.4 payments), `ce304e84`
(S5.4 sales orders), `d160acaf` (S5.4 revenue read model) and `c3edef61`
(S5.4 pricing rules lifecycle + calculation). This file is updated in doc-only commits after
each of them. **PR:** [#546](https://github.com/Freshair129/zuri.ai/pull/546) — OPEN / DRAFT, not for merge. **Merge:** NOT_MERGED.
**Production:** NOT_RUN. Nothing routes to the SCM process; no data, stock,
price or credential was touched.

The coordination board (`REFACTOR-STATUS.md`) and its protocol exist only on
`feat/market-intelligence-service`. They are not on `main`. This lane does not
write the board. It sends the delta in §9 to the integrator (Session 1 by
default).

## 1. Checkpoint state

| Axis | Result | Evidence |
|---|---|---|
| CODE_IMPLEMENTED | PARTIAL | S5.1 pricing kernel; S5.3 PO → GRN → stock → PO slice; S5.4 POS checkout, payments (record / verify / reject / refund), sales orders (create / actions / fulfilment / list), the revenue read model and pricing rules lifecycle + calculation. Cost sheet, pricing catalog freeze/admission, billing and the POS terminal catalogue are not moved |
| PRICING_PARITY_VERIFIED | PASS | 64 pinned cases (47 priced, 17 refused). The legacy recorder and the SCM kernel reproduce the same golden (§6). Revenue parity: 7 pinned queries, legacy-recorded golden, SCM reproduces it from its own store (§4.4) |
| TRANSACTION_INVARIANTS_VERIFIED | PARTIAL | Receipt, POS, payment, sales-order and pricing groups: injected-fault rollback, CAS interleaving (receipt, payment, order, pricing rule), two-process SQLite contention (receipt, POS oversell, refund ceiling, fulfilment over scarce stock, one approval + one calculation key) |
| ISOLATED_TESTS_VERIFIED | PASS | 173 service tests (172 pass, 1 NOT_RUN on Windows), no Next.js/DB/global setup, about 6 s |
| CORE_CONTRACT_VERIFIED | NOT_RUN | `scm.delegation.v1` and the ReferenceAuthority port are PROPOSED; the issuer and the reference owners are synthetic in tests |
| CONSUMER_INTEGRATION_VERIFIED | NOT_RUN | No BFF/route calls SCM; legacy routes are unchanged |
| DATA_OWNERSHIP_ENFORCED | NOT_RUN | Service-local disposable SQLite only; no restricted role; no transfer |
| LOCAL_IMAGE_BUILD | NOT_RUN | Docker daemon not running on this host. It was deliberately not started: the same host Docker serves the production Compose project `zuri-ai` |
| HOSTED_IMAGE_BUILD | NOT_RUN | No CI workflow wired (root CI is integrator-owned; request in §8) |
| IMAGE_START_SMOKE | NOT_RUN | — |
| MIGRATION_REHEARSAL_VERIFIED | NOT_RUN | — |
| CI_VERIFIED | NOT_RUN | Draft PR #546 opened; existing workflows do not run `services/scm` tests (CI job requested in §8), so their result says nothing about the service |
| MERGE_STATUS | NOT_MERGED | — |
| PRODUCTION_CUTOVER | NOT_RUN | Not authorized |

## 2. Discovery: ownership and transactions (from source at `fad8ec62`)

### 2.1 Capability map

| Capability / flow | Status | Owner | Old executor → new | Transaction group | Notes |
|---|---|---|---|---|---|
| Pricing evaluator (`calculatePrice`, customization, rules validation/import) | MOVE_SCM (kernel) | Commerce | `commerce/domain/pricing-*.js` → generated `services/scm/src/kernel/commerce/*` | pure | One hand-edited source (ADR-109 D3) |
| Sell-side catalog projection | MOVE_SCM (kernel) | Commerce | `pricing-catalog-projection.js` → kernel | pure | Existing allowlist; no second DTO |
| Supplier create | MOVE_SCM (slice) | Procurement | `supplier-service.createSupplier` → `modules/procurement/application/purchase-orders.js` | Supplier + audit | Legacy route still live |
| PO create / UPDATE / SEND / CLOSE / CANCEL | MOVE_SCM (slice) | Procurement | `purchase-order-service` → same file | PO + lines + audit | CAS on version kept |
| Goods receipt | MOVE_SCM (slice) | Procurement (+ Inventory writer) | `goods-receipt-service.postGoodsReceipt` → `workflows/post-goods-receipt.js` | GRN + lines + RECEIPT movements + lot/serial + fence + PO + audit | Whole group in one unit of work |
| Inventory RECEIPT and ISSUE append | MOVE_SCM (slice) | Inventory | `inventory-stock-service.appendMovement` (RECEIPT + ISSUE paths: FEFO, storage-limit skip, dedication) → `modules/inventory/application/stock-ledger.js` | inside caller's group | ADJUSTMENT, serial ISSUE and unit conversion explicitly refused |
| Stock summary / movements read | MOVE_SCM (slice) | Inventory | `stockSummary`, `listMovements` | read | — |
| ADJUSTMENT, serial ISSUE, unit conversion | SHARED_TRANSITION | Inventory | legacy `appendMovement` | callers' groups | Callers (fulfilment, recipe, transfer, stocktake, work orders, merge) have not moved |
| POS checkout | MOVE_SCM (slice) | Commerce (+ Inventory writer) | `pos-cashier-service.checkoutPosSale` → `workflows/pos-checkout.js` | SalesOrder + lines + PENDING Payment + ISSUE movements + fence + audit | Whole group in one unit of work. Branch/Customer/slip as ReferenceAuthority facts; WarehouseLocation (Inventory) and BusinessBillingProfile (Commerce) read in-store |
| POS terminal catalogue (`getPosTerminalCatalogue`) | SHARED_TRANSITION | Commerce (reads Inventory, Branch) | legacy | read | Reads ProductMaster/InventoryCategory and Branch lists; moves with the catalogue read model |
| Sales order create / UPDATE / CONFIRM / COMPLETE (+ issueStock) / CANCEL / list | MOVE_SCM (slice) | Commerce (+ Inventory writer) | `sales-order-service` → `modules/commerce/application/sales-orders.js` | order + lines (+ ISSUE movements + fence) + audit | Customer / Conversation as CRM facts; legacy visibility rule kept (D-10) |
| Supplier cost-sheet preview/commit | SHARED_TRANSITION | Procurement (+ Inventory carton facts) | `supplier-cost-sheet-service` → `setProductCartonAttributes` | sheet + lines + Product carton + supersession + audit | S5.4 |
| Pricing rules draft / update / approve / revoke, list, active policy, preview, calculate | MOVE_SCM (slice) | Commerce | `pricing-rules-service` → `modules/commerce/application/pricing-rules.js`, `/v1/commerce/pricing-rules/**` | rule CAS + audit; calculation snapshot + audit | OWNER only; same kernel evaluator; §4.5 |
| Pricing catalog freeze / admission / publication, `priceLandedInventoryQuote`, Knowledge currency check | SHARED_TRANSITION | Commerce (+ Files, Knowledge) | `pricing-catalog-service`, `pricing-publication`, `pricing-inventory-service` | catalog freeze **also writes PricingCalculation**; then Files + Knowledge outside the tx | Second writer / readers of the moved tables (F-11); gates SCM-FILES, SCM-KNOWLEDGE, SCM-AGENT (F-5) |
| Billing profile / documents | SHARED_TRANSITION | Commerce | `billing-invoice-service` | profile **+ LegalEntity/Branch writes**; sequence + document | Identity-owned rows are written: needs an owner command path before moving |
| Payments record / verify / reject / refund | MOVE_SCM (slice) | Commerce | `payment-service` → `modules/commerce/application/payments.js` | Payment (+ order-row lock for refunds) + audit | Slip as a Files fact. Recording works only on orders the SCM store holds (D-8) |
| Revenue read model | MOVE_SCM (slice) | Commerce (read) | `revenue-read-model.getRevenueSummary` → `modules/commerce/application/revenue.js`, `GET /v1/commerce/revenue` | read | Parity-pinned against legacy (§4.4) |
| Revenue consumers (`/api/commerce/revenue`, Marketing insights `marketing-insights-service.js:79/134`) | SHARED_TRANSITION (consumer) | Commerce route (S5) / Marketing | still call legacy `getRevenueSummary` | read | Routing a cohort to SCM needs the core delegation issuer (gate SCM-CORE); Marketing's call site is Marketing-owned |
| Catalogue, identifiers, conversions, recipes, kitting, customization, de-kitting, transfers, locations, stocktake, reservations/ATP, shelf life, catalog intake | SHARED_TRANSITION | Inventory | `modules/inventory/application/*` | as listed in §2.2 | Not in this checkpoint |
| Agent tools (`smartgift-inventory-tools.js`) | KEEP_EXTERNAL (consumer) | Agent / S1 | — | — | **Only a test imports it** (not wired). Direct Prisma reads of Product/Recipe/StockMovement/WarehouseLocation — must use the SCM API when wired (gate SCM-AGENT) |
| LINE `#sku` intake (`line-catalog-command.js`) | KEEP_EXTERNAL (consumer) | Agent / S1 | — | via Inventory services | Gate SCM-AGENT |
| Knowledge `assertPricingCatalogCurrent` | ADAPTER needed | Knowledge | reads PricingCalculation/RuleSet directly | read | Gate SCM-KNOWLEDGE |
| Marketing revenue summary | ADAPTER needed | Marketing | reads SalesOrder | read | — |
| Backup/restore/phase-b/migrate scripts | SHARED_TRANSITION | Integrator | generic SNAPSHOT_MODELS over every SCM table | R/W all | **Would be a second writer after cutover** — gate SCM-CUTOVER |
| Core AuditEvent writer (`recordAudit`) | KEEP_EXTERNAL | Core | inside every SCM tx | — | SCM writes a local envelope + outbox instead (ADR-109 D6); relay not built |
| Warehouse bins/picking, purchase returns, quote lifecycle | PLANNED_NOT_IMPLEMENTED | — | — | — | Not added |

### 2.2 Transaction inventory (legacy, `$transaction` sites)

`inventory-stock-service` 116 / 323; `inventory-catalog-service` 113, 234, 411
(carton, CAS), 522 (MERGE appends movements), 672; `inventory-identity` 64 / 93
/ 110 / 135; `inventory-recipe` 63 / 116 / 154 (build → appendMovement);
`inventory-atp` 162 / 222 / 280; customization WO 144 / 213 / 265 / 384;
kitting WO 103 / 192 / 236 / 352; de-kitting 67; location-transfer 145;
warehouse-location 40 / 83; shelf-life 89; stocktake 173 / 214 (fence revision +
hash); catalog-intake 132 / 183 / 250; **goods-receipt 98**; purchase-order 127
/ 181; supplier 29 / 68; supplier-cost-sheet 223 / 292; sales-order 126 / 225;
**pos-cashier 129**; payment 62 / 118; billing 351 (`runTransactionWithRetry`);
pricing-rules 75 / 87 / 103 / 159; pricing-catalog 81 / 118. Every one also
writes the core audit row.

### 2.3 Cross-owner references kept as opaque ids (not moved)

The real foreign keys are SalesOrder → Customer and Conversation,
Payment → FileAsset and CommerceDocument → Branch. Opaque id columns are
StockMovement / StockReservation / work orders → customerId and salesOrderId,
plus every `*ByPersonId`. SCM keeps these as references verified through the
delegated scope. It does not copy those masters.

## 3. What runs in the SCM process now

```text
services/scm/
  src/main.js                    composition root (only reader of process.env)
  src/config.js                  validated config; refuses self-migration in production
  src/http/server.js             v1 API: business commands + reads, typed errors, body/timeout limits
  src/application/commands.js    command bus: authority → key lookup → execute → receipt (one unit of work)
  src/infrastructure/            sqlite-store (FIFO queue + BEGIN IMMEDIATE), schema (DDL + OWNERS),
                                 delegation (scm.delegation.v1 + ladder), evidence (receipt/audit/outbox)
  src/kernel/**                  GENERATED mirror of apps/server pure domain code (12 files)
  src/modules/inventory/         adapters (only writer of 5 Inventory tables), application/stock-ledger, index
  src/modules/procurement/       adapters (only writer of 5 Procurement tables), application/purchase-orders
  src/modules/commerce/pricing/  public pricing API over the kernel
  src/workflows/post-goods-receipt.js  the cross-module atomic receipt (owner: Procurement)
  src/workflows/pos-checkout.js        the cross-module atomic POS sale (owner: Commerce)
  src/modules/commerce/          adapters (only writer of SalesOrder/Line, Payment, BusinessBillingProfile, PricingRuleSet, PricingCalculation), orders, payments, revenue, pricing rules
  src/infrastructure/reference-authority.js  ReferenceAuthority port: unavailable (default) + fixture (SCM_ENV=test only)
  contracts/v1/                  scm-api.v1.json, pricing-parity-cases/golden
  scripts/                       sync-kernel, write-pricing-cases, run-tests (fails on zero tests)
  Dockerfile (+ .dockerignore)   context = this package only; no apps/server, no mounts
```

API v1: `POST /v1/procurement/suppliers`, `POST /v1/procurement/purchase-orders`,
`GET /v1/procurement/purchase-orders/{id}`,
`POST /v1/procurement/purchase-orders/{id}/actions`,
`POST /v1/procurement/purchase-orders/{id}/receipts`,
`POST /v1/commerce/pos/checkout`, `GET /v1/commerce/orders/{id}`,
`GET /v1/inventory/stock`, `GET /v1/inventory/movements`,
`GET /v1/operations/{action}/{key}`, `/healthz`, `/readyz`, plus the sales
order, payment, revenue and `/v1/commerce/pricing-rules/**` routes added in
S5.4. Contract: `services/scm/contracts/v1/scm-api.v1.json` (revision
`v1-draft.6`, PROPOSED).

## 4. Invariants proven in this slice

| Invariant | Test |
|---|---|
| GRN, ledger rows, lot, PO state, audit, outbox and receipt ids agree; restart readback identical | `component/goods-receipt` happy path |
| Replay: same key + payload → stored outcome, no new rows; different payload → 409 | `component` idempotency |
| Lost response → lookup by key, never re-executes; crash (SIGKILL) after commit → restart → lookup + replay | `component`, `workflow/scm-process-flow` |
| A key is not a read capability (revoked scope / other actor denied) | `component` |
| Over-receipt refused whole with the per-line list | `component` |
| Two-ladder rule (403 `PROCUREMENT_RECEIPT_REQUIRES_INVENTORY_AUTHORITY`; missing inventory domain → 404); buyer-only and inventory-only both denied | `component` |
| Wrong Business / wrong Tenant / expired / over-long / forged delegation denied before any effect; body-supplied owner/role ignored | `component`, `contract` |
| FR-196 self-post refusal and attested exception, audited (**untested in legacy**) | `component` |
| SERVICE lines, lot data on uncounted lines, archived / foreign SKUs, unknown lines refused; UNTRACKED received on paper only | `component` |
| Lot required / serial count / serial duplicate / serial already in stock; first expiry never overwritten | `component` |
| PO stale version, cancel-after-receipt, lines-locked-after-send, short-close | `component` |
| Ledger and receipts append-only at the store (triggers) | `component` |
| Injected fault after GRN insert / first movement / before PO update / after audit → nothing persists; same key then commits once | `recovery/receipt-rollback` |
| PO version moved between plan and update → retryable 409, group rolled back | `recovery/receipt-version-cas` |
| 12 concurrent receipts across 2 processes on one line of 5 → exactly 5 commit; ledger = receipt lines = 5; codes unique | `recovery/two-process-receipt` |
| Module adapters write only their owner's tables; no cross-module adapter import; no apps/server / Next / Prisma / `@/` import; kernel pure; only main/config read env | `unit/module-boundaries` |
| Kernel byte-identical to the generated mirror | `unit/kernel-sync` |
| Image copies only services/scm; lockfile pins runtime deps | `unit/image-context` |

### 4.1 POS checkout (`test/component/pos-checkout.test.js`, `test/recovery/two-process-pos.test.js`)

Every case of legacy `fr183-pos.test.js` is mirrored, marked `[legacy]`:

| Invariant | Result |
|---|---|
| Completed WALK_IN order, PENDING payment (never VERIFIED: `verifiedAt`/`verifiedByPersonId` null), located ISSUE with `POS:<code>` reference, exact cash change, `stockIssuedAt`, four audit rows; restart readback identical | PASS |
| Manual price kept exactly (no pricing-engine call); untracked and free-text lines sold without a ledger row | PASS |
| int32 overflow refused before any write; maximum cash change exact (2 147 483 646 satang) | PASS |
| Cash short → `POS_CASH_INSUFFICIENT`; non-cash mismatch → `POS_PAYMENT_AMOUNT_MISMATCH` | PASS |
| Commerce order authority **and** Inventory write authority required (404 / 403 `POS_STOCK_ISSUE_REQUIRES_INVENTORY_AUTHORITY`); procurement grants do not sell; an unauthorized caller triggers **no** reference lookup | PASS |
| Branch must be ACTIVE and of this Business; location must be ACTIVE, physical and of this Business | PASS |
| Customer: own and tenant-shared accepted; deleted / foreign / unknown → `CUSTOMER_NOT_FOUND`; CRM display name not copied into SCM | PASS |
| Slip missing/deleted → `PAYMENT_SLIP_NOT_FOUND` after the stock issue ran → the whole sale rolls back | PASS |
| Shortage and duplicate bank reference roll everything back; bank reference unique per Tenant | PASS |
| Serial / archived / foreign products refused as before | PASS |
| FEFO by expiry, storage-limit lots skipped, `INVENTORY_LOT_STORAGE_EXPIRED` with the blocked lot | PASS |
| Dedicated stock only for its own order/customer | PASS |
| QR needs an active, verified PromptPay profile; stays PENDING with a payload | PASS |
| Same key → replay (no new rows); different payload → 409; lookup by key; replay needs the inventory domain (on-hand disclosure) | PASS |
| Reference owner unavailable → 503 retryable, no effect; an already-committed sale still replays | PASS |
| Fault at afterOrderInsert / afterStockIssue / beforePayment / afterAudit → nothing persists; same key then commits once | PASS |
| 8 concurrent single-unit sales over 3 units across 2 processes → exactly 3 commit, on-hand 0, 3 PENDING payments, unique codes | PASS (SQLite; same single-winner lock pattern as below) |
| A real process with no reference owner refuses POS (503); the fixture seam is refused outside `SCM_ENV=test` | PASS |

Mutation check (run once, not committed): making the payment `VERIFIED` fails 2
tests; removing the dedication check fails 1 test.

### 4.5 Pricing rules lifecycle + calculation (`test/component/pricing-rules.test.js`, `test/recovery/pricing-concurrency.test.js`, contract HTTP round trip)

All seven cases of legacy `fr253-pricing-rules.test.js` are mirrored with the
same inputs and expectations, marked `[legacy]`. The price itself is the kernel
evaluator already parity-pinned in S5.1; a calculation's `result` equals the
preview and `calculatePrice(defaultPricingRules(), input)`.

| Invariant | Result |
|---|---|
| OWNER only: a member holding every Commerce permission, an owner without the commerce domain, and another Business's owner get the same 404 on list, draft, update, action, preview, calculate and active; a foreign source/compare/rule id → 404 | PASS |
| Draft edits by CAS (`PRICING_RULE_VERSION_CONFLICT`); non-DRAFT → `PRICING_RULE_IMMUTABLE`; audit `DRAFT_CREATED → DRAFT_UPDATED → APPROVED` with reason and before/after snapshots | PASS |
| Audit failure rolls the rule write back | PASS |
| Preview and calculation share one evaluator; snapshot carries rule id/version/hash, input hash, `USER_ENTERED`, `publishable: false`; private columns never returned | PASS |
| Caller status/provenance/publishable claims and unknown input fields refused; malformed rules → 422 with `details`; nothing persisted | PASS |
| Future policy not active early; expiry exclusive; after the latest policy is revoked there is **no fallback** to the older one (409 `PRICING_RULE_NOT_ACTIVE`), the stored snapshot stays unchanged | PASS |
| Past effective date / expiry not after it → 422; no policy → 409, never the template | PASS |
| Revoke needs APPROVED and takes no dates; an offset date is stored as UTC | PASS |
| A key is bound per Business to the **normalized** request: `123.45` and `123.450` replay; a second owner re-using the key gets the same snapshot; a different request → `PRICING_CALCULATION_IDEMPOTENCY_CONFLICT` | PASS |
| Replay and outcome lookup re-check the policy (a withdrawn price is never re-offered); lookup is owner-only | PASS |
| The store refuses to rewrite approved rule content or any calculation, and to delete either (triggers); status transitions stay possible | PASS |
| Fault after the calculation audit → nothing persists; the same key then commits once | PASS |
| Rule version moved between check and update → 409, the concurrent edit rolls back with it | PASS |
| Two processes: 4 simultaneous approvals of one draft → exactly 1; 6 simultaneous calculations on one key by two owners → one row, one audit, one id in every answer | PASS (SQLite) |

Mutation check (run once, not committed): dropping the explicit-id-must-be-latest
rule, making expiry inclusive, dropping the owner guard, the replay guard, the
normalized hash, the in-unit key check, the past-date check, the DRAFT-only
update rule, or the version predicate of the CAS — each of the 9 fails at least
one test.

### 4.4 Revenue read model (`test/unit/revenue-parity.test.js`, `apps/server/tests/unit/scm-revenue-parity.test.js`)

Five synthetic orders and 7 queries are pinned in
`contracts/v1/revenue-parity-cases.json`. The queries cover the Bangkok-midnight
boundary (16:59:59Z → the 6th, 17:30Z → the 7th), a single Bangkok day, from-only,
to-only, an empty range and a malformed day. The golden is **recorded by the
legacy `getRevenueSummary`** (in-memory db stub, factory viewer). The SCM read
model writes the same rows into its own SQLite store, reads them back through
SQL, the kernel calculator and the DTO, and reproduces every output exactly:
8/8 on both sides. Values checked by hand for `all`: net 1223.45 = 900 − 100 +
300 + 123.45 + 200 − 200. The pending PAYMENT is counted, the pending REFUND is
not, and the REJECTED 999 is not. Without the commerce domain the read is 404.
Legacy AC-163.4 itself (built on legacy writers) keeps running in apps/server.

### 4.3 Sales orders (`test/component/sales-orders.test.js`, `test/recovery/sales-order-concurrency.test.js`)

Legacy `fr166-sales-order.test.js` AC-162.1–162.6 are mirrored.

| Invariant | Result |
|---|---|
| `ORD-` code, exact totals from lines, product lends its name, one `SALES_ORDER_CREATED` audit | PASS |
| A Conversation makes the sale CHAT and supplies its Customer; mismatch → `CONVERSATION_CUSTOMER_MISMATCH`; other-Tenant customer, invisible Business, unknown conversation → 422; foreign product → `PRODUCT_NOT_FOUND` | PASS |
| Legacy visibility rule kept: a customer bound to another Business the actor can **see** is accepted; one the actor cannot see is refused | PASS |
| Ladder: commerce domain gate, then OWNER or SALES_REP write; members read; unknown order 404 | PASS |
| UPDATE lines only while DRAFT; CONFIRM; notes still editable; wrong transition → `SALES_ORDER_STATUS_INVALID`; stale version → `SALES_ORDER_VERSION_CONFLICT`; COMPLETE without stock | PASS |
| COMPLETE + issueStock: inventory 403 first; every counted line issued (untracked/free-text not); audit `issued` in the legacy shape; whole-order shortage reported with per-line detail and nothing moved; serial refused | PASS |
| F-10 parity: a dedicated SKU is issued by fulfilment (the issue names neither customer nor order) | PASS (parity, not endorsement) |
| CANCEL keeps the row; list hides closed orders unless asked; summary `{open, unpaid, pendingPayments}` | PASS |
| Cohort in one store: order → payment → verify → cancel → refund → REFUNDED | PASS |
| Create and COMPLETE replay on their keys; a timed-out COMPLETE never issues twice; replay by a member → 404 | PASS |
| Fault after stock issue / before order update / after audit → no issue, still CONFIRMED, no audit/outbox/receipt; same key then completes once | PASS |
| Order version moved between check and update → 409; the stock issued in that unit rolls back with it (fence unchanged) | PASS |
| Two processes fulfil two orders (3 + 3) over 5 units at once → exactly one COMPLETED, the other `COMMERCE_STOCK_SHORTAGE` and still CONFIRMED | PASS (SQLite) |

Mutation check (run once, not committed): removing the inventory 403, the
whole-order shortage pre-check, the conversation/customer mismatch, the
lines-locked rule, the order CAS predicate or the customer visibility rule each
fails at least one test.

### 4.2 Payments (`test/component/payments.test.js`, `test/recovery/payment-version-cas.test.js`, `test/recovery/two-process-refund.test.js`)

Legacy AC-163.1–163.3 and the payment half of `fr196-segregation-of-duties` are
mirrored. AC-163.4 (the revenue read model) has not moved and is not claimed.

| Invariant | Result |
|---|---|
| A rep records PENDING with a `PAY-` code; the order stays UNPAID (pending shown apart); bank reference unique; slip must be this Business's and not deleted; member / unknown order / foreign order → 404; one `PAYMENT_RECORDED` audit | PASS |
| Verify needs the verifier permission or ownership (rep, no-domain owner → 404); verified money moves PARTIAL → PAID; REJECT keeps a reason and never counts; stale version → `PAYMENT_VERSION_CONFLICT`; non-PENDING → `PAYMENT_STATUS_INVALID` | PASS |
| FR-196: the recorder (an OWNER included) cannot verify their own payment; `selfVerifyAttested` passes and the audit payload says `selfVerified: true` (else `false`) | PASS |
| A PENDING payment from POS is verified here by a second person | PASS |
| Refunds bounded by verified net (`PAYMENT_REFUND_EXCEEDS_PAID`), allowed on a CANCELLED order; a PAYMENT on a CANCELLED order refused; REFUNDED state | PASS |
| Record and verify replay on the same key; a lost verify response is found by key; a timed-out verify retried with its key is a replay, not a version conflict | PASS |
| Files owner down → a slip-bearing record is refused (503), a slip-less record proceeds | PASS |
| Fault before the payment update / after audit → still PENDING at version 1, no audit/outbox/receipt; same key then commits | PASS |
| Payment version moved between check and update → 409, nothing written | PASS |
| 1000 verified, four refunds of 400 verified at once across 2 processes → exactly 2 VERIFIED (net 200), 2 remain PENDING | PASS (SQLite; this run did interleave: one commit per process) |

Mutation check (run once, not committed): removing the self-verify guard, the
refund ceiling, the bank-reference check or the CAS predicate each fails at least one test.

**Honest limit of the concurrency proof.** On SQLite, `BEGIN IMMEDIATE`
serializes writers across processes. In every run, the process that won the
first lock (A) re-took it before the waiting process (B) woke, so all of B's
attempts arrived after completion (`PURCHASE_ORDER_NOT_RECEIVABLE`). The test
proves no over-receipt, cross-process visibility and unique codes. It does
**not** prove interleaved commits or PostgreSQL behaviour. The CAS test forces
the PostgreSQL-shaped interleaving instead.

## 5. Recorded differences from legacy

| Id | Kind | What | Why |
|---|---|---|---|
| D-1 | Boundary, no behaviour change | A lot's first `expiresAt` is set through Inventory's `setLotExpiryIfUnset`, not by Procurement writing `ProductLot` | Owner writes its own table |
| D-2 | Intentional correctness change | Receipt PO update is `WHERE id AND version` (CAS). The loser gets a retryable 409 and writes nothing | See defect F-1 |
| D-3 | Transitional refusal | SCM writer refuses ISSUE/ADJUSTMENT (`SCM_MOVEMENT_KIND_NOT_MIGRATED`) and non-base units (`SCM_UNIT_CONVERSION_NOT_MIGRATED`) | Their atomic groups have not moved |
| D-4 | New contract | Mutations require `Idempotency-Key`; outcome lookup endpoint | New API with no legacy clients; legacy routes unchanged |
| D-5 | Ownership, DTO change | `order.customer` is `{id, code}` (code as returned by CRM at write time), not `{id, code, displayName}` via a Customer join | Customer is CRM-owned; SCM keeps the reference, not the master |
| D-6 | DTO superset | POS `payment` returns all Payment columns (adds `kind`, `note`, `verifiedAt`…); response adds `references: {verifiedAt, authority}` | Declares the reference consistency window |
| D-8 | Transitional scope | `POST /v1/commerce/orders/{id}/payments` accepts only orders the SCM store holds (POS or SCM-created orders); legacy-created orders answer 404 there | No cross-store write; legacy orders move with the cohort transfer, not by dual write |
| D-10 | Contract requirement | Customer/Conversation visibility is `scope.visible(businessId)`: the delegation must carry a grant for every Business the actor can see that a request may reference, not only the order's Business | Keeps the legacy `seesBusiness` rule without SCM reading Membership |
| D-9 | Concurrency hardening, no value change | Before a REFUND's ceiling read, the order row is touched with a lock-only UPDATE (`updatedAt = updatedAt`) | Serializes two refund verifications of one order on PostgreSQL; see F-9 |
| D-11 | Transport contract | Pricing: the calculation key is the `Idempotency-Key` header (8–200 of `[A-Za-z0-9._:-]`), not a body `idempotencyKey` (1–200, any text); responses are wrapped (`{ruleSet}`, `{calculation}`) and a replay adds `replayed`/`operation`; a lookup of a calculation whose policy was withdrawn answers 409 like a replay | One key convention for every SCM mutation; legacy key semantics (per Business, normalized request, conflict code, replay re-check) are kept inside it |
| D-12 | Hardening, no behaviour change on legal paths | Store triggers: approved rule content (rules, hash, name, scope, source) and every calculation are immutable; neither can be deleted | Legacy enforced this only in the service |
| D-7 | Consistency window | Branch/Customer/slip are read as facts **before** the unit of work (a remote read must not hold the writer lock). A reference revoked between that read and the commit is not seen; the window is bounded by the request deadline and reported | Legacy read them inside its transaction (same DB); no legacy precedence changes, because the facts are judged inside the unit of work in legacy order |

## 6. Verification log

Environment: Windows 11, Node v24.19.0, `node:sqlite`. Code SHA `7726b99b`.

| Level | Command | Discovered / executed / skipped | Exit | Duration |
|---|---|---|---|---|
| SCM all | `node services/scm/scripts/run-tests.mjs` | 103 / 102 pass / 1 skipped (graceful SIGTERM: NOT_RUN on Windows) | 0 | 2.2 s |
| Pricing parity, legacy recorder | `npx vitest run tests/unit/scm-pricing-parity.test.js tests/unit/pricing-engine.test.js` (apps/server) | 157 / 157 / 0 | 0 | 7.2 s |
| Server SCM regression | `npx vitest run` fr164, fr165, fr155, task-zai-053, fr253-pricing-rules, fr253-pricing-catalog, fr183-pos, fr166, fr184-stocktake, procurement-domain, pricing-engine, scm-pricing-parity | 12 files / 222 / 0 | 0 | 33.1 s |
| Kernel drift | `node services/scm/scripts/sync-kernel.mjs --check` | 12 files | 0 | <1 s |
| Governance | `npm --prefix apps/server run govern` | one CRITICAL before pinning (ADR-109 unpinned) → pinned with `docs:ids -- --write`; rerun in §6.1 | — | 46.8 s |
| Setup | `npm --prefix apps/server ci` | — | 0 | 29.9 s |

S5.4 POS (code SHA `f60fceb6`, same environment):

| Level | Command | Discovered / executed / skipped | Exit | Duration |
|---|---|---|---|---|
| SCM all | `node services/scm/scripts/run-tests.mjs` | 126 / 125 pass / 1 skipped (graceful SIGTERM, Windows) | 0 | 4.5 s |
| POS component | `node --test test/component/pos-checkout.test.js` | 20 / 20 / 0 | 0 | — |
| Server regression (commerce/inventory) | `npx vitest run` fr183-pos, fr163-payment, fr166-sales-order, fr165-goods-receipt, fr155-inventory-stock, fr179-shelf-life-guard, fr176-customization-work-order, commerce-domain, commerce-billing-domain, scm-pricing-parity | 10 files / 121 / 0 | 0 | — |
| Kernel drift | `sync-kernel.mjs --check` | 14 files | 0 | <1 s |

S5.4 payments (code SHA `3b522a9d`, same environment):

| Level | Command | Discovered / executed / skipped | Exit | Duration |
|---|---|---|---|---|
| SCM all | `node services/scm/scripts/run-tests.mjs` | 136 / 135 pass / 1 skipped (graceful SIGTERM, Windows) | 0 | 4.7 s |
| Payments component | `node --test test/component/payments.test.js` | 8 / 8 / 0 | 0 | — |
| Server regression (payments) | `vitest` fr163-payment, fr196-segregation-of-duties, fr183-pos, fr166-sales-order, commerce-domain | 5 files / 30 / 0 | 0 | — |

S5.4 pricing rules (code SHA `c3edef61`):

| Level | Command | Discovered / executed / skipped | Exit | Duration |
|---|---|---|---|---|
| SCM all | `node services/scm/scripts/run-tests.mjs` | 173 / 172 pass / 1 skipped (graceful SIGTERM, Windows) | 0 | ~6 s |
| Pricing component + recovery + contract | `node --test` pricing-rules, pricing-concurrency, scm-api-contract | 12 + 2 + 5 / all pass / 0 | 0 | — |
| Legacy pricing regression | `vitest` fr253-pricing-rules, fr253-pricing-routes, pricing-engine, scm-pricing-parity (apps/server) | 4 files / 173 / 0 | 0 | 8.8 s |
| Kernel drift | `sync-kernel.mjs --check` | 14 files | 0 | <1 s |

S5.4 revenue (code SHA `d160acaf`):

| Level | Command | Discovered / executed / skipped | Exit | Duration |
|---|---|---|---|---|
| SCM all | `node services/scm/scripts/run-tests.mjs` | 158 / 157 pass / 1 skipped (graceful SIGTERM, Windows) | 0 | ~5 s |
| Revenue parity, legacy recorder | `vitest tests/unit/scm-revenue-parity.test.js` | 8 / 8 / 0 | 0 | — |
| Server regression | `vitest` fr163-payment, scm-revenue-parity, marketing-insights-service, commerce-domain | 4 files / 25 / 0 | 0 | — |
| Governance | `npm --prefix apps/server run govern` | — | 0 (no CRITICAL) | — |

Not run: full `npm test` / `build` / e2e of apps/server (not in the inner loop
for this slice), Docker image build/start, PostgreSQL, CI.

### 6.1 Governance after pinning

`npm --prefix apps/server run govern` with ADR-109, this handoff, the ledger pin
and the regenerated `domain-state.json` staged: **exit 0, no CRITICAL**. The
remaining WARNING/INFO lines are the pre-existing baseline (broken
`llms-full.txt` links, accepted-debt baselines).

## 7. Defects and findings (not fixed in legacy here)

| Id | Finding | Evidence | Status | Proposed handling |
|---|---|---|---|---|
| F-1 | Legacy `postGoodsReceipt` plans against the PO read at the start and updates `version: {increment: 1}` with no predicate. On PostgreSQL READ COMMITTED, two concurrent receipts of stocked lines can both pass the outstanding check (the ledger fence serializes their appends but does not re-plan) → **over-receipt**. SQLite surfaces a busy/snapshot error instead | Code reading `goods-receipt-service.js:98–177`; SCM CAS test | PLAUSIBLE — not reproduced (no PostgreSQL here) | Separate hotfix PR: failing PostgreSQL race test, then `updateMany({where:{id,version}})` → 409. Not mixed into the extraction |
| F-2 | `GOODS_RECEIPT_SELF_POST_FORBIDDEN` has no legacy test | grep of apps/server/tests | CONFIRMED gap | Legacy test in the hotfix PR; SCM test exists |
| F-3 | Receipts, POS checkout, order create and payment record take no idempotency key. A timed-out client retry creates a second GRN/order and stock effect | Code | CONFIRMED gap | SCM API requires keys; legacy transition needs a contract review (prompt §11.2) |
| F-4 | GRN/PO/order codes are count-then-probe; a race gives a non-retried unique violation | Code | CONFIRMED (legacy) | SCM runs code generation inside the writer lock / CAS |
| F-5 | `priceLandedInventoryQuote` returns `rulesJson` (the private rule document) and accepts caller `sourceRefs`; its only caller (agent tools) is not wired | `pricing-inventory-service.js` | TO_VERIFY with S1 before any agent wiring | Gate SCM-AGENT must use an allowlisted DTO |
| F-6 | Procurement ↔ Inventory import cycle (inventory-catalog imports procurement cost helpers; procurement domain imports `zInventoryCode`) | Code | CONFIRMED | Kept in the kernel as-is (pure); break when catalog moves |
| F-7 | Customer erasure does not touch SCM `customerId` references (SalesOrder, StockMovement, StockReservation) | `identity/erase-customer-principal.js` | CONFIRMED, cross-owner | Report to Identity/CRM owner; not SCM's decision |
| F-8 | While both stores exist, three tenant-wide uniqueness rules cannot hold across them: `Payment.bankReference`, `ORD-…` and `PAY-…` codes | By construction (two databases) | CONFIRMED (design). **SCM capability complete** for the Commerce cohort: all writers (ce304e84) and the revenue read (d160acaf) exist in SCM. Open: consumer routing and the cohort data transfer | Cutover gate: per Tenant, one single-writer switch moves POS, payments, sales orders and the revenue read together, after a transfer of that Tenant's orders/payments/codes; no dual-write period |
| F-10 | Legacy fulfilment (`issueStockForOrder`) issues without `customerId`/`salesOrderId`, so a SKU dedicated to another customer or order leaves stock on COMPLETE; POS passes both and refuses | `sales-order-service.js:208`; SCM parity test | CONFIRMED (behaviour); intent UNKNOWN | Owner decision: if unintended, pass the order and its customer on the fulfilment issue (a behaviour change with its own FR/test) — not changed during extraction |
| F-11 | `pricing-catalog-service` (catalog freeze) **also inserts PricingCalculation** rows (key prefix per freeze) and reads the active policy; `pricing-publication`, `pricing-inventory-service` (F-5) and Knowledge `assertPricingCatalogCurrent` read PricingRuleSet/PricingCalculation directly | `pricing-catalog-service.js:82/93`, `pricing-publication.js:15/19`, `pricing-inventory-service.js:25` | CONFIRMED (design) | These tables have one owner only after the catalog group moves with them (behind SCM-FILES/SCM-KNOWLEDGE) or reads them through the SCM API; until then SCM pricing serves no consumer, and the per-Business key space is shared with catalog keys at transfer |
| F-9 | Legacy `applyPaymentAction` reads the verified net for a REFUND and updates the payment by CAS on the payment row only. On PostgreSQL READ COMMITTED, two refunds of one order verified concurrently can both pass the ceiling → refunded > paid | Code reading `payment-service.js:135–145`; SCM two-process test + D-9 | PLAUSIBLE — not reproduced (no PostgreSQL here) | Same hotfix PR as F-1: a PostgreSQL race test first, then an order-row lock before the read |

## 8. Dependencies, blockers and shared changes requested

| Gate | Waiting phase | Waiting for | From | Unblocks when | Safe now |
|---|---|---|---|---|---|
| SCM-ARCH | Any move beyond this slice's owned code | Review of ADR-109 + this matrix | Owner + reviewers | ADR-109 accepted | Pricing/receipt tests, S5.4 characterization |
| SCM-CORE | Real BFF → SCM calls; POS in a real process | Identity owner signs off `scm.delegation.v1` (issuer, key distribution, lifetime, revocation), the audit relay mapping, a Branch + Customer + Conversation reference façade (facts: tenant, business, status/deletedAt, customerId, code) for ReferenceAuthority, and grants for every visible Business (D-10) | Identity/Core owner + CRM owner + S5 | Reviewed contract SHA + provider tests; a façade the real process can call | Everything service-local |
| COMMON | CI for services/scm | A workflow job `node services/scm/scripts/run-tests.mjs` + `docker build -f services/scm/Dockerfile .` + disposable start smoke | Integrator (root CI owner) | Job merged | Local tests |
| SCM-AGENT | S5.4 agent/LINE tools | Read/mutation/confirmation/receipt contract | S1 + S5 | Reviewed contract | POS/fulfilment moves |
| SCM-FILES | Payment-slip facts (POS, payments), cost-sheet originals, catalog artifacts | FilePort exact-version read + a `fileAsset` fact lookup (businessId, deletedAt) for ReferenceAuthority | S3 + S5 | Reviewed FilePort (ADR-107) + fixtures | Non-file groups; POS without slips |
| SCM-KNOWLEDGE | Catalog publication | Admission/receipt/revocation contract | Knowledge owner + S5 | Reviewed contract | Calculations without publication |
| SCM-CUTOVER | Any production routing | Migration/restore/rollback rehearsal + backup scripts through SCM + operator approval; POS + payments + sales orders switch together per Tenant (F-8) | Integrator/operator + S5 | Rehearsal evidence + authorization | Disposable rehearsal |
| (engine) | PostgreSQL claim | A PostgreSQL adapter + concurrency run on a disposable DB | S5 | Test PASS on PostgreSQL | SQLite work |

**Shared files touched in this branch:** `docs/.id-ledger.json` (+ADR-109 only,
the same pattern as ADR-108 on the Market branch) and
`apps/server/runtime/domain-state.json` (regenerated: commerce test count +1).
Both are integrator-reconciled on merge. No schema, migration, root CI, Compose,
PRD/FEATURES/ROADMAP or tracker change.

## 9. Status delta for the integrator (REFACTOR-STATUS.md)

```yaml
session: S5
workstream: scm
owner: Session 5 implementation owner
observed_at: "2026-09-24T11:55:00+07:00"
base_sha: fad8ec6252941ca3de01afdb3116484f86b366c3
code_head_sha: c3edef61
handoff_source_commit: "the doc commit after c3edef61 on feat/scm-service-extraction"
branch: feat/scm-service-extraction
pr_number: 546
current_tranche: S5.4 (Commerce cohort + pricing rules/calculation in SCM) → supplier cost-sheet commit or PostgreSQL adapter next (owner's choice)
execution_status: IN_PROGRESS
merge_status: NOT_MERGED
production_status: NOT_RUN
completed:
  - claim: "S5.0 ownership/transaction/caller inventory from source"
    evidence: [docs/migrations/service-extraction/SCM-HANDOFF.md §2]
  - claim: "S5.1 single-source pricing kernel + 64-case parity"
    code_paths: [services/scm/src/kernel, services/scm/contracts/v1/pricing-parity-*.json, apps/server/tests/unit/scm-pricing-parity.test.js]
  - claim: "S5.3 SCM process + owned SQLite store + PO→GRN→stock→PO slice with receipts, rollback, restart, two-process test"
    code_paths: [services/scm]
  - claim: "S5.4 POS checkout as one SCM unit of work (order + PENDING payment + ISSUE/FEFO + audit + receipt), ReferenceAuthority port"
    code_paths: [services/scm/src/workflows/pos-checkout.js, services/scm/src/modules/commerce, services/scm/src/infrastructure/reference-authority.js]
  - claim: "S5.4 payments record/verify/reject/refund (FR-163, FR-196) as SCM units of work"
    code_paths: [services/scm/src/modules/commerce/application/payments.js]
  - claim: "S5.4 sales orders create/UPDATE/CONFIRM/COMPLETE(+issueStock)/CANCEL/list (FR-166) as SCM units of work"
    code_paths: [services/scm/src/modules/commerce/application/sales-orders.js]
  - claim: "S5.4 revenue read model over the SCM store, parity-pinned against the legacy engine"
    code_paths: [services/scm/src/modules/commerce/application/revenue.js, services/scm/contracts/v1/revenue-parity-cases.json, services/scm/contracts/v1/revenue-parity-golden.json, apps/server/tests/unit/scm-revenue-parity.test.js]
  - claim: "S5.4 pricing rules draft/update/approve/revoke + calculate/preview/active (FR-253) as SCM units of work on the parity-pinned kernel"
    code_paths: [services/scm/src/modules/commerce/application/pricing-rules.js, services/scm/src/modules/commerce/adapters/pricing-repo.js]
verified:
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: 7726b99b, command: "node services/scm/scripts/run-tests.mjs", discovered: 103, executed: 102, skipped: 1, exit_code: 0, duration_seconds: 2.2, environment: "win32, node 24.19.0" }
  - { level: PRICING_PARITY, result: PASS, verified_code_sha: 7726b99b, command: "vitest scm-pricing-parity + pricing-engine", discovered: 157, executed: 157, skipped: 0, exit_code: 0, duration_seconds: 7.2 }
  - { level: SERVER_REGRESSION_SCM, result: PASS, verified_code_sha: 7726b99b, command: "vitest 12 SCM files", discovered: 222, executed: 222, skipped: 0, exit_code: 0, duration_seconds: 33.1 }
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: f60fceb6, command: "node services/scm/scripts/run-tests.mjs", discovered: 126, executed: 125, skipped: 1, exit_code: 0, duration_seconds: 4.5, environment: "win32, node 24.19.0" }
  - { level: SERVER_REGRESSION_COMMERCE, result: PASS, verified_code_sha: f60fceb6, command: "vitest fr183/fr163/fr166/fr165/fr155/fr179/fr176 + commerce domain + parity", discovered: 121, executed: 121, skipped: 0, exit_code: 0 }
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: 3b522a9d, command: "node services/scm/scripts/run-tests.mjs", discovered: 136, executed: 135, skipped: 1, exit_code: 0, duration_seconds: 4.7, environment: "win32, node 24.19.0" }
  - { level: SERVER_REGRESSION_PAYMENTS, result: PASS, verified_code_sha: 3b522a9d, command: "vitest fr163/fr196/fr183/fr166 + commerce-domain", discovered: 30, executed: 30, skipped: 0, exit_code: 0 }
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: ce304e84, command: "node services/scm/scripts/run-tests.mjs", discovered: 150, executed: 149, skipped: 1, exit_code: 0, duration_seconds: 4.9, environment: "win32, node 24.19.0" }
  - { level: SERVER_REGRESSION_SALES_ORDERS, result: PASS, verified_code_sha: ce304e84, command: "vitest fr166/fr163/fr183/fr155 + commerce-domain + commerce-routes", discovered: 39, executed: 39, skipped: 0, exit_code: 0 }
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: d160acaf, command: "node services/scm/scripts/run-tests.mjs", discovered: 158, executed: 157, skipped: 1, exit_code: 0, environment: "win32, node 24.19.0" }
  - { level: REVENUE_PARITY, result: PASS, verified_code_sha: d160acaf, command: "vitest scm-revenue-parity (legacy recorder) + node --test revenue-parity (SCM)", discovered: 16, executed: 16, skipped: 0, exit_code: 0 }
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: c3edef61, command: "node services/scm/scripts/run-tests.mjs", discovered: 173, executed: 172, skipped: 1, exit_code: 0, environment: "win32, node 24.19.0" }
  - { level: SERVER_REGRESSION_PRICING, result: PASS, verified_code_sha: c3edef61, command: "vitest fr253-pricing-rules/fr253-pricing-routes/pricing-engine/scm-pricing-parity", discovered: 173, executed: 173, skipped: 0, exit_code: 0, duration_seconds: 8.8 }
  - { level: LOCAL_IMAGE_BUILD, result: NOT_RUN, reason: "docker daemon down; not started because host Docker serves production" }
  - { level: POSTGRES, result: NOT_RUN }
  - { level: CI, result: NOT_RUN }
remaining:
  - "S5.4 remaining: pricing catalog freeze/admission/publication (behind SCM-FILES/SCM-KNOWLEDGE; F-11), supplier cost-sheet commit, billing (behind an Identity command path for LegalEntity/Branch), POS terminal catalogue — each as a whole group"
  - "Consumer routing (BFF → SCM) for the Commerce cohort, behind SCM-CORE"
  - "PostgreSQL adapter + concurrency proof; image build/start smoke; BFF consumer; core delegation issuer; audit outbox relay"
  - "Legacy hotfix for F-1/F-2 as a separate PR"
contracts:
  - { name: scm-api, revision: v1-draft.6, provider_owner: S5, consumer_owner: "BFF (unassigned)", review_status: PROPOSED, provider_conformance: "LOCAL PASS", consumer_conformance: NOT_RUN }
  - { name: scm.delegation.v1, provider_owner: "Identity/Core", consumer_owner: S5, review_status: PROPOSED, provider_conformance: NOT_RUN, consumer_conformance: "LOCAL PASS (synthetic issuer)" }
  - { name: ReferenceAuthority (branch/customer/fileAsset facts), provider_owner: "Core + CRM + Files (S3)", consumer_owner: S5, review_status: PROPOSED, provider_conformance: NOT_RUN, consumer_conformance: "LOCAL PASS (fixture provider)" }
blockers:
  - { dependency: "scm.delegation.v1 review + core issuer", kind: CONTRACT, phase_blocked: "real consumer integration", owner_to_unblock: "Identity/Core owner + S5", condition_to_unblock: "reviewed contract SHA + provider tests", safe_work_now: ["S5.4 service-local moves", "PostgreSQL adapter"] }
  - { dependency: "root CI job for services/scm", kind: INTEGRATION_ORDER, phase_blocked: "CI_VERIFIED/HOSTED_IMAGE_BUILD", owner_to_unblock: integrator, condition_to_unblock: "job merged", safe_work_now: ["local tests"] }
next_action: "Owner picks the next tranche: supplier cost-sheet commit (Procurement + Inventory carton facts) or the PostgreSQL adapter; owner decision on F-10 pending."
owned_paths: [services/scm/**, docs/migrations/service-extraction/SCM-HANDOFF.md, docs/decisions/ADR-109-SCM-SERVICE-EXTRACTION.md, apps/server/tests/unit/scm-pricing-parity.test.js]
shared_changes_requested: ["docs/.id-ledger.json +ADR-109", "root CI job for services/scm", "board row: Commerce+Inventory+Procurement DEFERRED_AS_GROUP → SCM / Session 5 IN_PROGRESS (evidence above)", "Branch/Customer fact façade (core, CRM) and fileAsset fact lookup (S3) for ReferenceAuthority"]
board_expected_source_commit: "REFACTOR-STATUS.md 0.1.0b on feat/market-intelligence-service"
board_update: BOARD_UPDATE_PENDING
```

## 10. Next exact action

1. Read the hosted check results on PR #546 and record them here (CI_VERIFIED is NOT_RUN until then).
2. Next tranche (owner's choice): the supplier cost-sheet commit
   (`supplier-cost-sheet-service`, Procurement + Inventory carton facts, one
   unit of work), or the PostgreSQL adapter that turns the SQLite concurrency
   proofs (F-1, F-9 shapes) into PostgreSQL ones. Pricing catalog
   freeze/admission stays behind SCM-FILES / SCM-KNOWLEDGE (F-11).
3. Owner decision on F-10 (dedication on fulfilment) — recorded, not changed.
4. When SCM-CORE lands: route `/api/commerce/revenue` (S5-owned) to SCM per
   cohort, and hand Marketing's call site to its owner.
4. Separately, a legacy hotfix PR for F-1, F-2 and F-9, each with a failing
   PostgreSQL race test first.
