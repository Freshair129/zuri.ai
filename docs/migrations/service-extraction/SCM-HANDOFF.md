---
id: ZAI:SCM-HANDOFF
version: "0.1.0b"
status: candidate
last_update: "2026-09-24T14:30:00+07:00,Claude Opus 5.5 (Session 5)"
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
**Tested implementation SHA:** `7726b99b`. This file and ADR-109 are a later
doc-only commit on top. **PR:** [#546](https://github.com/Freshair129/zuri.ai/pull/546) — OPEN / DRAFT, not for merge. **Merge:** NOT_MERGED.
**Production:** NOT_RUN. Nothing routes to the SCM process; no data, stock,
price or credential was touched.

The coordination board (`REFACTOR-STATUS.md`) and its protocol exist only on
`feat/market-intelligence-service`. They are not on `main`. This lane does not
write the board. It sends the delta in §9 to the integrator (Session 1 by
default).

## 1. Checkpoint state

| Axis | Result | Evidence |
|---|---|---|
| CODE_IMPLEMENTED | PARTIAL | S5.1 pricing kernel; S5.3 PO → GRN → stock → PO slice. POS, fulfilment, cost sheet, pricing rules/catalog and billing are not moved |
| PRICING_PARITY_VERIFIED | PASS | 64 pinned cases (47 priced, 17 refused). The legacy recorder and the SCM kernel reproduce the same golden (§6) |
| TRANSACTION_INVARIANTS_VERIFIED | PARTIAL | Receipt group only: rollback at 4 injected faults, CAS interleaving, two-process SQLite contention |
| ISOLATED_TESTS_VERIFIED | PASS | 103 service tests, no Next.js/DB/global setup, about 2.2 s |
| CORE_CONTRACT_VERIFIED | NOT_RUN | `scm.delegation.v1` is PROPOSED; issuer is synthetic in tests |
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
| Inventory RECEIPT append | MOVE_SCM (slice) | Inventory | `inventory-stock-service.appendMovement` (RECEIPT path) → `modules/inventory/application/stock-ledger.js` | inside caller's group | ISSUE/ADJUSTMENT explicitly refused |
| Stock summary / movements read | MOVE_SCM (slice) | Inventory | `stockSummary`, `listMovements` | read | — |
| ISSUE / ADJUSTMENT, FEFO, dedication, shelf life, unit conversion | SHARED_TRANSITION | Inventory | legacy `appendMovement` | callers' groups | Callers (POS, fulfilment, recipe, transfer, stocktake, work orders, merge) have not moved |
| POS checkout | SHARED_TRANSITION | Commerce (+ Inventory) | `pos-cashier-service.checkoutPosSale` | SalesOrder + PENDING Payment + ISSUE movements + audit | S5.4. Reads Branch, WarehouseLocation, Customer, FileAsset, BusinessBillingProfile |
| Sales order COMPLETE + issueStock | SHARED_TRANSITION | Commerce (+ Inventory) | `sales-order-service.applyOrderAction` | order + ISSUE movements | S5.4 |
| Supplier cost-sheet preview/commit | SHARED_TRANSITION | Procurement (+ Inventory carton facts) | `supplier-cost-sheet-service` → `setProductCartonAttributes` | sheet + lines + Product carton + supersession + audit | S5.4 |
| Pricing rules lifecycle, calculation, catalog freeze/admission | SHARED_TRANSITION | Commerce | `pricing-rules-service`, `pricing-catalog-service` | rule CAS; calculation + idempotency; then Files + Knowledge outside the tx | S5.4; gates SCM-FILES and SCM-KNOWLEDGE |
| Billing profile / documents | SHARED_TRANSITION | Commerce | `billing-invoice-service` | profile **+ LegalEntity/Branch writes**; sequence + document | Identity-owned rows are written: needs an owner command path before moving |
| Payments record/verify | SHARED_TRANSITION | Commerce | `payment-service` | Payment CAS; reads FileAsset (slip) | S5.4 |
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
  src/workflows/post-goods-receipt.js  the cross-module atomic receipt
  contracts/v1/                  scm-api.v1.json, pricing-parity-cases/golden
  scripts/                       sync-kernel, write-pricing-cases, run-tests (fails on zero tests)
  Dockerfile (+ .dockerignore)   context = this package only; no apps/server, no mounts
```

API v1: `POST /v1/procurement/suppliers`, `POST /v1/procurement/purchase-orders`,
`GET /v1/procurement/purchase-orders/{id}`,
`POST /v1/procurement/purchase-orders/{id}/actions`,
`POST /v1/procurement/purchase-orders/{id}/receipts`,
`GET /v1/inventory/stock`, `GET /v1/inventory/movements`,
`GET /v1/operations/{action}/{key}`, `/healthz`, `/readyz`. Contract:
`services/scm/contracts/v1/scm-api.v1.json` (revision `v1-draft.1`, PROPOSED).

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

## 8. Dependencies, blockers and shared changes requested

| Gate | Waiting phase | Waiting for | From | Unblocks when | Safe now |
|---|---|---|---|---|---|
| SCM-ARCH | Any move beyond this slice's owned code | Review of ADR-109 + this matrix | Owner + reviewers | ADR-109 accepted | Pricing/receipt tests, S5.4 characterization |
| SCM-CORE | Real BFF → SCM calls | Identity owner signs off `scm.delegation.v1` (issuer, key distribution, lifetime, revocation), plus the audit relay mapping | Identity/Core owner + S5 | Reviewed contract SHA + a core issuer with provider tests | Everything service-local |
| COMMON | CI for services/scm | A workflow job `node services/scm/scripts/run-tests.mjs` + `docker build -f services/scm/Dockerfile .` + disposable start smoke | Integrator (root CI owner) | Job merged | Local tests |
| SCM-AGENT | S5.4 agent/LINE tools | Read/mutation/confirmation/receipt contract | S1 + S5 | Reviewed contract | POS/fulfilment moves |
| SCM-FILES | Cost-sheet originals, slips, catalog artifacts | FilePort exact-version read/create + authority | S3 + S5 | Reviewed FilePort (ADR-107) + fixtures | Non-file groups |
| SCM-KNOWLEDGE | Catalog publication | Admission/receipt/revocation contract | Knowledge owner + S5 | Reviewed contract | Calculations without publication |
| SCM-CUTOVER | Any production routing | Migration/restore/rollback rehearsal + backup scripts through SCM + operator approval | Integrator/operator + S5 | Rehearsal evidence + authorization | Disposable rehearsal |
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
observed_at: "2026-09-24T14:30:00+07:00"
base_sha: fad8ec6252941ca3de01afdb3116484f86b366c3
code_head_sha: 7726b99b3df5f349360afe375395945d3a93156d
handoff_source_commit: "the doc commit after 7726b99b on feat/scm-service-extraction"
branch: feat/scm-service-extraction
pr_number: 546
current_tranche: S5.3 (slice done) → S5.4 next
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
verified:
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: 7726b99b, command: "node services/scm/scripts/run-tests.mjs", discovered: 103, executed: 102, skipped: 1, exit_code: 0, duration_seconds: 2.2, environment: "win32, node 24.19.0" }
  - { level: PRICING_PARITY, result: PASS, verified_code_sha: 7726b99b, command: "vitest scm-pricing-parity + pricing-engine", discovered: 157, executed: 157, skipped: 0, exit_code: 0, duration_seconds: 7.2 }
  - { level: SERVER_REGRESSION_SCM, result: PASS, verified_code_sha: 7726b99b, command: "vitest 12 SCM files", discovered: 222, executed: 222, skipped: 0, exit_code: 0, duration_seconds: 33.1 }
  - { level: LOCAL_IMAGE_BUILD, result: NOT_RUN, reason: "docker daemon down; not started because host Docker serves production" }
  - { level: POSTGRES, result: NOT_RUN }
  - { level: CI, result: NOT_RUN }
remaining:
  - "S5.4: POS checkout, sales-order fulfilment, cost-sheet commit, pricing rules/calculation, billing — each as a whole group"
  - "PostgreSQL adapter + concurrency proof; image build/start smoke; BFF consumer; core delegation issuer; audit outbox relay"
  - "Legacy hotfix for F-1/F-2 as a separate PR"
contracts:
  - { name: scm-api, revision: v1-draft.1, provider_owner: S5, consumer_owner: "BFF (unassigned)", review_status: PROPOSED, provider_conformance: "LOCAL PASS", consumer_conformance: NOT_RUN }
  - { name: scm.delegation.v1, provider_owner: "Identity/Core", consumer_owner: S5, review_status: PROPOSED, provider_conformance: NOT_RUN, consumer_conformance: "LOCAL PASS (synthetic issuer)" }
blockers:
  - { dependency: "scm.delegation.v1 review + core issuer", kind: CONTRACT, phase_blocked: "real consumer integration", owner_to_unblock: "Identity/Core owner + S5", condition_to_unblock: "reviewed contract SHA + provider tests", safe_work_now: ["S5.4 service-local moves", "PostgreSQL adapter"] }
  - { dependency: "root CI job for services/scm", kind: INTEGRATION_ORDER, phase_blocked: "CI_VERIFIED/HOSTED_IMAGE_BUILD", owner_to_unblock: integrator, condition_to_unblock: "job merged", safe_work_now: ["local tests"] }
next_action: "Open a draft PR for feat/scm-service-extraction (no merge). Then S5.4 characterization of POS checkout (pos-cashier-service.js:129) as the next whole group."
owned_paths: [services/scm/**, docs/migrations/service-extraction/SCM-HANDOFF.md, docs/decisions/ADR-109-SCM-SERVICE-EXTRACTION.md, apps/server/tests/unit/scm-pricing-parity.test.js]
shared_changes_requested: ["docs/.id-ledger.json +ADR-109", "root CI job for services/scm", "board row: Commerce+Inventory+Procurement DEFERRED_AS_GROUP → SCM / Session 5 IN_PROGRESS (evidence above)"]
board_expected_source_commit: "REFACTOR-STATUS.md 0.1.0b on feat/market-intelligence-service"
board_update: BOARD_UPDATE_PENDING
```

## 10. Next exact action

1. Read the hosted check results on PR #546 and record them here (CI_VERIFIED is NOT_RUN until then).
2. S5.4 first group: characterize `checkoutPosSale`, then move it whole:
   - SalesOrder + PENDING Payment + ISSUE with FEFO/dedication/shelf life + audit;
   - stays PENDING (never VERIFIED);
   - manual price stays manual;
   - Branch/FileAsset/BillingProfile as verified references.
3. Separately, a legacy hotfix PR for F-1/F-2 with a failing PostgreSQL race test first.
