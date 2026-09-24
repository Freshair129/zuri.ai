---
id: ZAI:SCM-HANDOFF
version: "0.1.0b"
status: candidate
last_update: "2026-09-25T06:30:00+07:00,Claude Opus 5.5 (Session 5)"
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
(S5.4 sales orders), `d160acaf` (S5.4 revenue read model), `c3edef61`
(S5.4 pricing rules lifecycle + calculation), `17b542b9` (S5.4 supplier
cost sheets), `2db0b1e9` (S5.5 PostgreSQL store adapter), `27dbf55e` (S5.4
POS terminal catalogue), `8f9a23db` (S5.4 Inventory catalogue writers), `61cf0a26` (S5.4 SKU identity)
`75e6e830` (S5.4 recipes, work orders, de-kitting, product ARCHIVE/MERGE) and
`e2afcc5f` (S5.4 reservation writers + public ATP reads), `e285c4f4` (S5.4
stocktake, standalone transfers, warehouse locations, the rest of the stock core) and
`8fd4d4a9` (S5.4 shelf-life, catalogue hygiene, replenishment, catalogue intake), then `bc24e5bb` (the F-18 fix). This file is updated in doc-only commits after
each of them. **PR:** [#546](https://github.com/Freshair129/zuri.ai/pull/546) — OPEN / DRAFT, not for merge. **Merge:** NOT_MERGED.
**Legacy hotfix (separate lane):** [#557](https://github.com/Freshair129/zuri.ai/pull/557) — branch
`fix/scm-legacy-pg-races` from `main` @ `85d8fd06`, worktree
`.claude/worktrees/scm-legacy-race-hotfix`, commits `d374bcb7` (F-1/F-9/F-12)
and `385fe279` (F-2 test). S1 review round 1 (head `385fe279`) returned
REQUEST_CHANGES with one P1: the race-suite target guard could be bypassed by a
`?host=` override. It is fixed in `00dff8b3`: the guard refuses any query or
fragment and checks pg's own parse. After the fix the guard cases pass with no
database, the race suite passes 5/5 on embedded PostgreSQL 17, and govern exits 0.
S1 re-reviewed head `00dff8b3` and returned PASS (static review). **MERGED**
into `main` at `7363c931` (2026-09-24T10:26:26Z). MC0 merged it on the user's
instruction, with CI green on `00dff8b3`. It was deployed to production by MC0 (not S5) at 2026-09-24T18:09Z in `release-caabd8a7-ki17-overlay`. Merge rule (all lanes,
2026-09-24): no merge until S1 sends REVIEW_RESULT = PASS for the PR's latest
head SHA (a new push needs a new review), and even then merging is the user's
decision in the S5 chat.
**Legacy hotfix F-14:** [#561](https://github.com/Freshair129/zuri.ai/pull/561) — branch
`fix/legacy-work-order-cas` from `main` @ `93f5cc06`, worktree
`.claude/worktrees/legacy-work-order-cas`. Review round 1 (head `dd689c39`): S1
REQUEST_CHANGES, P2 — no deterministic barrier in the race tests. Fixed test-only in
`be171333`. Each race now pauses both transactions after their first read of the
order until both have read it. The tests assert one commit, a loser that is exactly
VERSION_CONFLICT, and no loser ledger or audit rows. They cover RELEASE / COMPLETE /
CANCEL of both work-order types. On the original code all 6 fail deterministically
(`won: 2`); on #561 they pass 11/11, 3 of 3 runs. S1 returned PASS at `be171333`
(static review; the opt-in PostgreSQL suite is my local evidence). CI was green.
**MERGED** into `main` at `9e25aa1f` (2026-09-24T16:25:12Z) by MC0 under the user's
merge authority. It was deployed to production by MC0 (not S5) at 2026-09-24T18:09Z in `release-caabd8a7-ki17-overlay`.
**Legacy hotfix F-15/F-16/F-17:** [#564](https://github.com/Freshair129/zuri.ai/pull/564) — branch
`fix/legacy-reservation-races`, head `e63ac8d5`, **stacked on #561's first head
`dd689c39`**. Built by a subagent in worktree
`.claude/worktrees/agent-aa3556c553fb7b7ae` on 2026-09-24, on the user's "fix it all".
- Reproduced on the legacy code: F-16, 8 holds of 3 on 10 units all succeeded (24
  held); F-17, 4 CONVERTs → 4 ORDER holds; F-15, unhandled P2002.
- After the fix: F-16 holds 3 (9 held); F-17 leaves 1 ORDER hold; F-15 returns 409
  RECIPE_BATCH_SIZE_EXISTS with its statuses.
- Race suite 10/10, 3 of 3 runs; `npm test` 803 files / 6767 tests; build clean;
  govern exit 0.
- After #561 merged: `main` merged in (`3436417e`), so the diff is only its own 4
  files. The race-test conflict was resolved (header and imports only).
- F-16 / F-17 now use the same deterministic barrier: two racers pause after their
  first read (the product for F-16, the hold for F-17) until both have read.
  main's unfixed service fails both, 3/3 (`won: 2`); the fix passes 13/13, 3 of 3.
- Full `npm test`: 804 files / 6810 tests. Build clean. govern exit 0.
- Review round 1 (head `3436417e`): S1 REQUEST_CHANGES, two P2 findings.
  (a) Same-day order-code race: CONVERT inserted the ORDER hold before its
  compare-and-swap. (b) The PR body claimed an F-16 audit assertion the test did
  not make.
- Fixed in `812b21f0`: CONVERT now runs the compare-and-swap before allocating the
  code, and a new same-day race case covers it (the reviewed head fails it 3/3 with
  a unique-code collision). F-16 asserts the single CREATED audit.
- Race suite 14/14, 3 of 3 runs; `npm test` 804 files / 6810 tests; build clean;
  govern exit 0.
- S1 **PASS** at `812b21f0` (static review; the PostgreSQL / full-suite evidence is local). Hosted CI is green on that head (tests, build, govern, verify, edge-verify).
- **MERGED** into `main` at `caabd8a7` (2026-09-24T17:48:56Z, head `812b21f0`) by MC0 under the user's merge authority. It was deployed to production by MC0 (not S5) at 2026-09-24T18:09Z in `release-caabd8a7-ki17-overlay` (MC0 verified health, LINE server and workers; rollback target `release-c4c4c562`). S5 neither merged nor deployed.
**Production:** the SCM service is NOT_RUN in production. The legacy fixes #557, #561 and #564 run there since MC0's deploy of `caabd8a7`. Nothing routes to the SCM process; no data, stock,
price or credential was touched.

The coordination board (`REFACTOR-STATUS.md`) and its protocol exist only on
`feat/market-intelligence-service`. They are not on `main`. This lane does not
write the board. It sends the delta in §9 to the integrator (Session 1 by
default).

## 1. Checkpoint state

| Axis | Result | Evidence |
|---|---|---|
| CODE_IMPLEMENTED | PARTIAL | S5.1 pricing kernel; S5.3 PO → GRN → stock → PO slice; S5.4 POS checkout, payments (record / verify / reject / refund), sales orders (create / actions / fulfilment / list), the revenue read model, pricing rules lifecycle + calculation and supplier cost-sheet preview/commit. the POS terminal catalogue read, the Inventory catalogue writers + SKU identity (F-13), recipes, customization / kitting work orders, de-kitting, the transfer core and product ARCHIVE / MERGE (§4.10), the reservation writers + public ATP reads (§4.11), stocktake, standalone transfers, warehouse locations and the rest of the stock core — ADJUSTMENT, serial ISSUE, lots, serial units (§4.12), and shelf-life, catalogue hygiene, replenishment and catalogue intake (§4.13). With them the whole Inventory group has moved. S5.5 PostgreSQL store adapter behind the same port (both engines run the whole suite). Pricing catalog freeze/admission and billing are not moved |
| PRICING_PARITY_VERIFIED | PASS | 64 pinned cases (47 priced, 17 refused). The legacy recorder and the SCM kernel reproduce the same golden (§6). Revenue parity: 7 pinned queries (§4.4). Cost-sheet parity: 4 pinned previews — code, preview hash, source hash, SKU-match suggestions, locked-FX costs (§4.6). POS catalogue parity: 2 pinned catalogues (§4.8). Each golden is recorded by legacy and reproduced by SCM from its own store |
| TRANSACTION_INVARIANTS_VERIFIED | PARTIAL | Every moved group on **both engines**: injected-fault rollback, CAS interleaving (receipt, payment, order, pricing rule, cost sheet, kitting work order), and two-process contention on SQLite **and on PostgreSQL 17 at READ COMMITTED with real interleaving** (receipt, POS oversell, refund ceiling, fulfilment, approval + calculation key, cost sheets, kitting completion). The guard proof shows the F-1/F-9/F-12, W-1, R-1, R-2, S-1 and I-1 races break on PostgreSQL without each SCM guard (§4.7, §4.10–§4.13). Not yet: a managed PostgreSQL / production-sized load |
| ISOLATED_TESTS_VERIFIED | PASS (one open intermittent under heavy load, F-19) | 298 service tests at `bc24e5bb`: SQLite 296 pass, 2 NOT_RUN (graceful SIGTERM on Windows; the F-18 row-lock barrier case is PostgreSQL-only); a disposable PostgreSQL 17 297 pass, 1 NOT_RUN, in two consecutive full runs. F-18 is fixed (D-28). F-19 was seen once only under 12-way parallel load; no Next.js/app DB/global setup |
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
| ADJUSTMENT, serial ISSUE; public movement / lot / serial-unit commands and reads | MOVE_SCM (slice) | Inventory | legacy `appendMovement`, `recordMovement`, `createLot`, `listLots`, `listSerialUnits` → `stock-ledger.js`, `/v1/inventory/{stock-movements,lots,serial-units}` | one movement per unit of work (+ serial status, lot) + audit | §4.12; D-3 retired (`e285c4f4`) |
| POS checkout | MOVE_SCM (slice) | Commerce (+ Inventory writer) | `pos-cashier-service.checkoutPosSale` → `workflows/pos-checkout.js` | SalesOrder + lines + PENDING Payment + ISSUE movements + fence + audit | Whole group in one unit of work. Branch/Customer/slip as ReferenceAuthority facts; WarehouseLocation (Inventory) and BusinessBillingProfile (Commerce) read in-store |
| POS terminal catalogue (`getPosTerminalCatalogue`) | MOVE_SCM (slice) | Commerce (reads Inventory; Branch from core) | `pos-cashier-service.getPosTerminalCatalogue` → `modules/commerce/application/pos-catalogue.js` + Inventory `catalogueFacts`, `GET /v1/commerce/pos/catalogue` | read | Branch list as ReferenceAuthority `branches` facts; ProductMaster/InventoryCategory read in-store (writers not moved, F-13); §4.8 |
| Sales order create / UPDATE / CONFIRM / COMPLETE (+ issueStock) / CANCEL / list | MOVE_SCM (slice) | Commerce (+ Inventory writer) | `sales-order-service` → `modules/commerce/application/sales-orders.js` | order + lines (+ ISSUE movements + fence) + audit | Customer / Conversation as CRM facts; legacy visibility rule kept (D-10) |
| Supplier cost-sheet preview / commit / get / list | MOVE_SCM (slice) | Procurement (+ Inventory carton writer) | `supplier-cost-sheet-service` → `modules/procurement/application/supplier-cost-sheets.js`; carton → Inventory `application/product-carton.js` | sheet + lines + Product carton (Inventory authority, CAS, audit) + supersession + CAS confirm + audit | Whole group in one unit of work; §4.6 |
| Cost-sheet `.xlsx` upload + template | KEEP_EXTERNAL (converter) | Procurement route (BFF) | `supplier-cost-workbook` | none | Converts a workbook into the same JSON envelope before preview (BR-009: a new surface adds a converter, never a second write path) |
| Readers of cost lines / carton facts / identifiers: Product page `supplierCostPriceBreaks`, catalogue hygiene `CARTON_DATA_MISSING`; writers of ProductIdentifier | SHARED_TRANSITION | Inventory | `inventory-catalog-service.getProduct`, `inventory-hygiene-service`, `inventory-identity-service` | read / identifier writes | Legacy readers still read legacy tables; the SCM SKU matcher reads identifiers from the SCM store only (F-13) |
| Pricing rules draft / update / approve / revoke, list, active policy, preview, calculate | MOVE_SCM (slice) | Commerce | `pricing-rules-service` → `modules/commerce/application/pricing-rules.js`, `/v1/commerce/pricing-rules/**` | rule CAS + audit; calculation snapshot + audit | OWNER only; same kernel evaluator; §4.5 |
| Pricing catalog freeze / admission / publication, `priceLandedInventoryQuote`, Knowledge currency check | SHARED_TRANSITION | Commerce (+ Files, Knowledge) | `pricing-catalog-service`, `pricing-publication`, `pricing-inventory-service` | catalog freeze **also writes PricingCalculation**; then Files + Knowledge outside the tx | Second writer / readers of the moved tables (F-11); gates SCM-FILES, SCM-KNOWLEDGE, SCM-AGENT (F-5) |
| Billing profile / documents | SHARED_TRANSITION | Commerce | `billing-invoice-service` | profile **+ LegalEntity/Branch writes**; sequence + document | Identity-owned rows are written: needs an owner command path before moving |
| Payments record / verify / reject / refund | MOVE_SCM (slice) | Commerce | `payment-service` → `modules/commerce/application/payments.js` | Payment (+ order-row lock for refunds) + audit | Slip as a Files fact. Recording works only on orders the SCM store holds (D-8) |
| Revenue read model | MOVE_SCM (slice) | Commerce (read) | `revenue-read-model.getRevenueSummary` → `modules/commerce/application/revenue.js`, `GET /v1/commerce/revenue` | read | Parity-pinned against legacy (§4.4) |
| Revenue consumers (`/api/commerce/revenue`, Marketing insights `marketing-insights-service.js:79/134`) | SHARED_TRANSITION (consumer) | Commerce route (S5) / Marketing | still call legacy `getRevenueSummary` | read | Routing a cohort to SCM needs the core delegation issuer (gate SCM-CORE); Marketing's call site is Marketing-owned |
| Inventory catalogue writers: category, family, factory, master, product create; bundles; product UPDATE / PHASE_OUT / REACTIVATE; lists; product page | MOVE_SCM (slice) | Inventory (+ Procurement price breaks on the page) | `inventory-catalog-service` → `modules/inventory/application/catalog.js` | row + audit; product CAS | §4.9; the page composes Procurement's CONFIRMED-sheet price breaks in the query layer |
| SKU identity: identifiers, unit conversions, resolve, FlowAccount SKU; ledger unit conversion | MOVE_SCM (slice) | Inventory | `inventory-identity-service`, `setFlowAccountSku` → `modules/inventory/application/identity.js`; `appendMovement` unit path → `stock-ledger.js` | row + audit; CAS | §4.9 |
| Product ARCHIVE and MERGE | MOVE_SCM (slice) | Inventory | legacy `applyProductAction` → `modules/inventory/application/catalog.js` | product CAS + (MERGE) ISSUE/RECEIPT + re-pointed identifiers, conversions, bundle items, recipe lines, recipes + survivor bump + audit | §4.10; the reservation guard reads SCM's StockReservation, written by SCM since `e2afcc5f` |
| Recipes (create / actions / explosion / build), customization and kitting work orders, de-kitting, the transfer core, the ATP read | MOVE_SCM (slice) | Inventory | `inventory-recipe-service`, `customization-work-order-service`, `kitting-work-order-service`, `de-kitting-service`, `location-transfer-service.transferInTransaction`, `inventory-atp-service.availableToPromiseFor` → `modules/inventory/application/{recipes,customization,kitting,de-kitting,transfers,atp}.js`, `/v1/inventory/{recipes,de-kitting,customization-work-orders,kitting-work-orders}/**` | one unit of work each (order CAS + ledger rows + audit) | §4.10 |
| Reservations create / list / RELEASE / CONVERT / expiry stamping; public ATP and max-buildable reads | MOVE_SCM (slice) | Inventory | `inventory-atp-service` → `modules/inventory/application/atp.js`, `/v1/inventory/reservations/**`, `GET /v1/inventory/atp` | hold (+ ledger fence) + audit; CAS on the hold | §4.11 (D-23) |
| Warehouse locations (create / actions / located view), standalone transfer, stocktake preview / commit / read | MOVE_SCM (slice) | Inventory | `warehouse-location-service`, `location-transfer-service.transferStock`, `inventory-stocktake-service` → `locations.js`, `stocktake.js`, `/v1/inventory/{locations,location-stock,transfers,stocktakes}` | location CAS; transfer pair; stocktake under the ledger fence + ADJUSTMENTs + audit | §4.12 |
| Shelf-life audit + maintenance (FR-179), catalogue hygiene (FR-206), replenishment (FR-207), catalogue intake preview / commit / cancel / reads (FR-208) | MOVE_SCM (slice) | Inventory | `inventory-shelf-life-service`, `inventory-hygiene-service`, `catalog-intake-service` → `shelf-life.js`, `hygiene.js`, `catalog-intake.js`, `/v1/inventory/{shelf-life,catalog-hygiene,replenishment,catalog-intakes}/**` | maintenance: lot + audit; intake commit: every action through the catalogue / identity writers + intake CAS + audit, one unit of work | §4.13 (D-26, D-27) |
| Catalogue intake `.xlsx` upload + template (FR-209) | KEEP_EXTERNAL (converter) | Inventory route (BFF) | `catalog-workbook` | none | Converts a workbook into the JSON envelope before preview, as for cost sheets (D-26) |
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
  src/infrastructure/            sqlite-store (FIFO queue + BEGIN IMMEDIATE), pg-store (+ pg-connection/pg-worker,
                                 sql-dialect; READ COMMITTED + bounded re-run), store (engine choice), schema (DDL per dialect + OWNERS),
                                 delegation (scm.delegation.v1 + ladder), evidence (receipt/audit/outbox)
  src/kernel/**                  GENERATED mirror of apps/server pure domain code (16 files)
  src/modules/inventory/         adapters (only writer of 5 Inventory tables), application/stock-ledger, index
  src/modules/procurement/       adapters (only writer of 7 Procurement tables), application/purchase-orders, supplier-cost-sheets
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
S5.4, and every Inventory route since. Contract: `services/scm/contracts/v1/scm-api.v1.json`
(revision `v1-draft.14`, 96 routes, `notMigrated` empty, PROPOSED).

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

### 4.13 Shelf-life, catalogue hygiene, replenishment, catalogue intake (`test/component/inventory-shelf-life-hygiene.test.js`, `inventory-catalog-intake.test.js`, `test/recovery/two-process-catalog-intake.test.js`)

Legacy `fr179-shelf-life-guard.test.js` AC-179.1 and AC-179.5 (the issue-side cases
AC-179.2–179.4 are the stock writer's, mirrored in §4.12 / §4.1), `fr201-inventory-sku-governance.test.js`
AC-206.1 and AC-207.1, and `fr208-inventory-catalog-intake.test.js` AC-208.1–208.6 are
mirrored with the same inputs and expectations, marked `[legacy]`. AC-209.1 (the
workbook converter) stays at the edge (D-26). Schema v10 adds `InventoryCatalogIntake`;
the planner is the kernel's `catalog-intake.js` (16th mirrored file).

| Invariant | Result |
|---|---|
| Shelf-life audit: OK / DUE / EXPIRED with age, due-in and hard deadline; a product with no storage limit is absent; `thresholdDays` narrows; an empty lot only with `includeEmpty` | PASS |
| Maintenance resets the clock (an EXPIRED lot issues again), is audited with the value it replaced (also for a backdated one), is refused for a product that does not age, a CLOSED lot, a member, an unknown lot or a lot of another Business | PASS |
| Hygiene: lookalikes, legacy nature mismatch, service with stock fields, master without axes, dormant (counted, empty, idle), SKU without identifier; `dormantDays` clamped 1..3650; writes nothing | PASS |
| Replenishment: every TRACKED, ACTIVE SKU below its reorder point (or safety stock) with the declared quantity or the gap; phased-out and services not counted | PASS |
| Intake preview: resolves before it plans a create, persists the plan and its hash, writes no catalogue row; idempotent per (Business, channel, correlation); a different payload under one correlation 409; a re-preview recomputes (REPREVIEWED) | PASS |
| Intake commit: exactly the plan in one unit of work through the catalogue / identity writers (each keeps its audit); stale / expired / cancelled / not committable refused; a code taken in another Business of the Tenant makes the plan stale and writes nothing; a merged duplicate's code matches its survivor; commit and preview replay once committed | PASS |
| Cancel by version, PREVIEWED only; reads need the domain; by-code needs write authority and the intake's own Business; `requesterOnly` refuses anyone but the previewer (D-27) | PASS |
| Two processes commit one intake (3 rounds × a creating plan and an UNCHANGED-only plan): one commits, the other replays; the catalogue changes once | PASS on SQLite and PostgreSQL |
| I-1 guard proof: without the lock-only touch the UNCHANGED-only loser answers 409 `INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT` instead of the replay (3/3); SQLite passes. A creating plan still replays without it (the loser re-runs on the unique violation), so the lock changes the loser's answer, never the catalogue | PASS (the race is real) |

Mutation check (run once, not committed): 23 guards removed in turn, 20 caught. The 3
survivors are equivalent: the maintenance write check and the cancel Business check
repeat the command's own `authorize`, and hygiene's `onHand` for an uncounted SKU is
read by the kernel only for TRACKED rows.

### 4.12 Stock core, warehouse locations, transfers, stocktake (`test/component/inventory-stock.test.js`, `inventory-locations.test.js`, `inventory-stocktake.test.js`, `test/recovery/two-process-stocktake.test.js`)

Legacy `fr155-inventory-stock.test.js` (AC-155.1–155.6), `fr174-warehouse-locations.test.js`
(AC-174.1–174.7) and `fr184-inventory-stocktake.test.js` (all 7 cases, plus a read-back)
are mirrored with the same inputs and expectations, marked `[legacy]`. The stocktake
contract takes UUID ids (as legacy Businesses are), so its suite uses synthetic UUID
Businesses. fr184's two "real concurrent" cases run serialized in-process and
truly concurrent across two processes on both engines.

| Invariant | Result |
|---|---|
| RECEIPT adds, ISSUE removes, ADJUSTMENT corrects with its own sign; on-hand recomputed; one audit per movement | PASS |
| Refusals by code (untracked, lot / serial on a NONE SKU, lot required, unknown SKU, member, unknown Business) | PASS |
| Lots by code on receipt (receivedQty follows) and by the explicit path (factory of the same Business, dates in order, code unique per SKU) | PASS |
| Serial units: one row per serial; IN_STOCK → ISSUED; a serial cannot be issued twice or unknown; no serial ADJUSTMENT; a returned serial is received again (audited RECEIVED / ISSUED / RECEIVED) | PASS |
| The summary's counts block (products, tracked, untracked, services, phaseOut, belowSafetyStock, belowReorderPoint); FEFO across open lots | PASS |
| Locations: Tenant-unique code, typed, 404 for a member; UPDATE / ARCHIVE by CAS; a location holding stock (any SKU) cannot be archived; an archived one refuses transfers | PASS |
| Standalone transfer: on-hand unchanged, one ISSUE + one RECEIPT per lot, refused for one place twice / unknown / other Business / more than held / a member; branded stock never into generic stock; lot identity kept and receivedQty not inflated | PASS |
| Located view: per location plus the unlocated remainder beside the total | PASS |
| Stocktake: authority, product / serial / lot validation; preview writes no movement or audit; an omitted unlocated bucket blocks; a selected location may leave another out; commit posts signed ADJUSTMENTs, advances the fence once per movement, replays its body key and refuses a changed payload; stale after a movement with no partial write | PASS |
| Two processes commit two previews of one snapshot → one posts, the other STALE | PASS on SQLite and PostgreSQL |
| S-1 guard proof: without the early fence both commits post (3/3); SQLite passes. Legacy already takes this fence (no legacy defect) | PASS (the race is real) |

Mutation check (run once, not committed): 14 guards removed in turn, 12 caught; the
lot-factory survivor got the `[SCM]` case above and is now caught; the fence-revision
stale check is equivalent (the snapshot hash includes the revision).

### 4.11 Reservations and Available-to-Promise (`test/component/inventory-reservations.test.js`, `test/recovery/two-process-reservation.test.js`, `reservation-version-cas.test.js`)

Legacy `fr180-atp-reservations.test.js` (AC-180.1–180.6) is mirrored with the same
inputs and expectations, marked `[legacy]`; its injected `now` is the harness clock.
The lifecycle and work-order suites now place and release holds with the real
command (they inserted rows before this tranche).

| Invariant | Result |
|---|---|
| A QUOTE hold expires after 7 days; ATP drops by exactly what it holds; no ledger row is written | PASS |
| The same stock cannot be promised twice (details name requested / available); an uncounted SKU cannot be promised; an ORDER hold needs a sales order; 404 without write authority | PASS |
| A hold whose clock ran out is already spent before any sweep; the sweep stamps EXPIRED and changes no ATP figure | PASS |
| CONVERT ends the quote CONVERTED and places a non-expiring ORDER hold in the same unit of work; a committed hold cannot be converted; a stale version → 409 | PASS |
| No hold is ever deleted; `live` is computed on read | PASS |
| Max buildable sets come from ATP (a 900-unit quote squeezes 500 sets to 300, naming the short component) | PASS |
| A replayed key places no second hold; a released hold cannot be released again; an unknown recipe → 404 | PASS |
| CONVERT with the version moving between check and update → 409, the ORDER hold it inserted rolls back | PASS on SQLite and PostgreSQL |
| Two processes, 8 holds of 3 over 10 units → at most 3 held; 2 CONVERTs of one hold → exactly 1 ORDER hold | PASS on SQLite and PostgreSQL |
| R-1 guard proof: without the ledger fence, 4 holds of 3 were placed on 10 units (1/3 runs); SQLite passes | PASS (the race is real) |
| R-2 guard proof: without the hold compare-and-swap, both CONVERTs commit and two ORDER holds exist (3/3; codes made collision-free in both arms, as F-1's proof does); SQLite passes | PASS (the race is real) |

Mutation check (run once, not committed): 9 reservation guards removed in turn — all 9 caught.

### 4.10 Recipes, work orders, de-kitting, product ARCHIVE / MERGE (`test/component/inventory-recipes.test.js`, `inventory-work-orders.test.js`, `inventory-lifecycle.test.js`, `test/recovery/work-order-version-cas.test.js`, `two-process-kitting.test.js`)

Legacy `fr156-inventory-recipe.test.js` (AC-156.1–156.5), `fr176-customization-work-order.test.js`
(AC-176.1–176.7), `fr177-kitting-work-order.test.js` (AC-177.1, 177.2–177.7; 177.1b is the
FlowAccount uniqueness already mirrored in §4.9), `fr178-de-kitting.test.js` (AC-178.1–178.4)
and `fr201-inventory-sku-governance.test.js` AC-205.1 / AC-205.2 are mirrored with the
same inputs and expectations, marked `[legacy]`. The recipe explosion, scrap buffer,
completion rule, dedication rule, ATP, costing, transfer rule and lifecycle / merge
rules are the shared kernel (`warehouse-location.js` joined the mirror: 15 files).
Locations are seeded (their writers move with stocktake/transfers) and quote holds
are inserted directly (their writers move with the ATP group, D-21).

| Invariant | Result |
|---|---|
| Recipes: code unique per Tenant, (product, batchSize) unique, same-Business components, never the output; UPDATE replaces the line set, ARCHIVE keeps the row, both by CAS | PASS |
| Explosion vs the ledger (fixed lines do not scale; uncounted lines never block); max buildable; build issues FEFO and receives the output in one unit of work, refused whole on shortage (details name the short lines) or a SERIAL component / output; a LOT output needs its lot | PASS |
| Customization: OPEN creates the dedicated CUSTOM_COMPONENT output (code `<raw>-<CWO>`); RELEASE moves net + buffer to the workshop without changing on-hand; COMPLETE issues worked and scrapped units separately, receives the output at raw landed + setup/planned + run cost, returns the buffer; scrap overrun → BLOCKED_SHORTAGE with the shortfall; CANCEL returns unworked blanks; branded stock refuses another customer / order (BR-028) | PASS |
| Kitting: FlowAccount finished-set SKU required (BR-032); frozen BOM with the 2 % buffer; ATP (a live quote hold) refuses a run the on-hand would allow, an expired hold does not (BR-031); per-set × attempts consumed; blended landed unit cost (components + labour / sets); buffer and cancelled staging returned; over-assembly, completion before release and double completion refused | PASS |
| Transfer core: a lot-tracked blank keeps its lot at the workshop and the move is not counted as intake (`receivedQty` unchanged) | PASS |
| De-kitting: surviving components return at their landed cost (none when never costed); destroyed lines written off; a branded component never returns to generic stock but may go to WIP (still dedicated) or quarantine; LOT components refused | PASS |
| ARCHIVE: stock or an ACTIVE reservation blocks (BR-040); MERGE: plain stock moves through the ledger; identifiers, pack sizes (clash → RETIRED), bundle items, recipe lines and output recipes follow the survivor; blockers named (bundle / BOM holding both, output or component is the survivor, same-batch survivor recipe, open work orders); survivor audited `PRODUCT_ABSORBED_MERGE`; a live promise blocks MERGE too | PASS |
| F-15: a survivor recipe at the same batch size blocks by name even when ARCHIVED (legacy died on the unique index) | PASS (D-22) |
| Kitting COMPLETE: the version moving between check and update → 409 and the consumption rolls back; two processes completing one order → exactly one posts, output received once | PASS on SQLite and PostgreSQL |
| W-1 guard proof: without the work-order compare-and-swap, two processes complete one order twice on PostgreSQL (3/3: `[COMPLETED, COMPLETED]`); SQLite still passes | PASS (the race is real; SQLite hides it) |
| Same on PostgreSQL (whole suite on both engines, 252 tests) | PASS |

Mutation check (run once, not committed): 33 guards removed in turn across recipes,
work orders, de-kitting, the transfer core, ATP, ARCHIVE and MERGE — 30 caught on the
first pass; the two survivors that were real gaps (the transfer's lot-intake undo and
MERGE's reservation guard) got the tests above and are now caught; one is equivalent
(the ATP liveness filter — the kernel's `availableToPromise` re-checks liveness).

### 4.9 Inventory catalogue writers and SKU identity (`test/component/inventory-catalog.test.js`, `test/component/inventory-identity.test.js`, contract HTTP round trip)

Legacy `fr154-inventory-catalog.test.js` (AC-154.1–154.6) and the in-scope cases
of `fr201-inventory-sku-governance.test.js` (AC-201.1, AC-202.1, AC-202.2, the
PHASE_OUT/REACTIVATE half of AC-205.1, AC-203.1, AC-204.1) are mirrored with the
same inputs and expectations, marked `[legacy]`. The rules themselves (nature,
variant key, lookalike fingerprint, lifecycle, identifier collision, unit
conversion) are the shared kernel. Not mirrored: ARCHIVE's reservation guard and
MERGE (not moved), the hygiene report and replenishment (not moved).

| Invariant | Result |
|---|---|
| Codes unique per Tenant, category slug per Business, masters reference same-Business category/family/factory, one audit row each | PASS |
| Authority: members read, OWNER or `inventory.catalog.write` write, every refusal is 404; a malformed body is refused by validation first (legacy order) | PASS |
| A SERVICE master yields SKUs with no stock fields; a GOOD master refuses a service (`INVENTORY_NATURE_MISMATCH` with details); axes default the policy | PASS |
| Variant key unique per master (details name the holder), values must cover the axes; the colour column stands in; a corrected variant is re-keyed and re-checked | PASS |
| Lookalike guard under a master without axes; the `allowLookalike` override is audited with `lookalikeOf` | PASS |
| UPDATE / PHASE_OUT / REACTIVATE by CAS (a concurrent edit between check and update → 409 and rolls back); PHASE_OUT refuses receipts and keeps issuing; ARCHIVE / MERGE → 409 `SCM_PRODUCT_ACTION_NOT_MIGRATED` | PASS |
| Bundles of same-Business SKUs report the complete sets the ledger allows | PASS |
| The product page composes on-hand, receipt costing and the price breaks of CONFIRMED sheets only (a superseded sheet's lines do not show) | PASS |
| Identifiers: GTIN check digit, unique per Tenant, scannable kinds share a value space, a pack barcode needs a known unit; RETIRE keeps the row and the value taken; an identifier of another SKU in the path → 404 | PASS |
| Conversions: never the base unit, a serial SKU or a service; a BOX12 receipt lands 24 in base units with `unitConversion` in the result and the audit; a retired conversion stops converting | PASS |
| Resolve: code → FlowAccount code → ACTIVE identifier (with the pack factor); follows a merged duplicate; a miss is 200 with `product: null` | PASS |
| FlowAccount SKU: pattern refused first (422 even for an unauthorized caller, as legacy), unique per Tenant, audited from/to | PASS |
| Same on PostgreSQL (whole suite on both engines, 221 tests) | PASS |

Mutation check (run once, not committed): 11 catalogue guards and 10 identity
guards each removed in turn — 20 caught; the one survivor (the SQL status filter
on conversions) is an equivalent mutant, because the kernel's `toBaseQuantity`
ignores non-ACTIVE conversions as well.

### 4.8 POS terminal catalogue (`test/component/pos-catalogue.test.js`, `test/unit/pos-catalogue-parity.test.js`, `apps/server/tests/unit/scm-pos-catalogue-parity.test.js`)

One synthetic catalogue is pinned in `contracts/v1/pos-catalogue-parity-cases.json`
(two Businesses): TRACKED / UNTRACKED / SERVICE SKUs, a lot and a serial SKU, a
SKU with no name (master's Thai name), a master in a retired category, an
INACTIVE master still naming its SKUs, ARCHIVED and PHASED_OUT SKUs, a lower-case
code, ledger sums to 7 / 2 / 0, a virtual and an inactive location, an inactive
Branch and another Business's rows. The golden is **recorded by the legacy
`getPosTerminalCatalogue`** (db stub applying the legacy where / orderBy); SCM
reproduces both cases from its own store plus Branch facts, 2/2.

| Invariant | Result |
|---|---|
| Commerce domain AND inventory domain; either missing, an unknown Business or an empty id → 404/422, and the Branch owner is not asked | PASS |
| A plain member (both domains, no permission) reads it; every item has `unitPrice: null` and no price field | PASS |
| Branch facts come from the owner after authorization; SCM keeps ACTIVE ones by code; an unavailable owner → 503 `SCM_REFERENCE_AUTHORITY_UNAVAILABLE` (no catalogue without sites) | PASS |
| On-hand is recomputed from the ledger: selling the last 3 units through POS turns the SKU unavailable (onHand 0) | PASS |
| Same on PostgreSQL (whole suite on both engines, 202 tests) | PASS |

Mutation check (run once, not committed): dropping the inventory-domain gate,
the ACTIVE Branch filter, the non-virtual location filter, the ACTIVE SKU
filter, the master-name fallback, `onHand: null` for untracked SKUs, the ACTIVE
category filter, or asking the Branch owner before authorization — each of the
8 fails at least one test.

### 4.7 PostgreSQL store adapter (`test/unit/pg-store.test.js`, the whole suite with `--engine=postgres`, `scripts/prove-guards-on-postgres.mjs`)

**Shape.** `pg-store.js` has the SQLite store's port exactly (`read`,
`transaction`, `ping`, `close`; synchronous `sql.get/all/run` inside), so no
module changed. One `pg` client lives in a worker thread; a call blocks on
`Atomics.wait` the way `node:sqlite` blocks during a statement
(`pg-connection.js`). `sql-dialect.js` turns the one SQL text into PostgreSQL:
mixed-case names quoted (the Prisma field names), `?` → `$n`, literals and
comments untouched. Triggers are declared once (`schema.TRIGGERS`) and emitted
per dialect; `POSTGRES_DDL` widens `REAL` to `DOUBLE PRECISION` and keeps ISO-8601
text timestamps so ordering and comparison are identical on both engines.

**Isolation and retries.** A unit runs at READ COMMITTED; a read runs in a READ
ONLY REPEATABLE READ snapshot. 40001 / 40P01 / 23505 re-run the unit from the
start (at most 5 attempts, then 409 `SCM_CONCURRENT_CONFLICT`, retryable); the
re-run re-reads the idempotency receipt first, so a lost unique race becomes a
replay, the next code or the domain's own refusal. `lock_timeout` (5 s) → 503
`SCM_STORE_BUSY`; a lost connection → 503 `SCM_STORE_UNAVAILABLE` and the next
unit reconnects.

**Test engine.** `node scripts/run-tests.mjs --engine=postgres` starts
embedded PostgreSQL 17.10 (devDependency `embedded-postgres`, a temp directory,
127.0.0.1, random port, UTF-8 / C locale), gives every test store its own
database, and removes everything afterwards. Two-process tests start real SCM
processes with `SCM_STORE=postgres`.

| Invariant | Result |
|---|---|
| Whole suite on PostgreSQL: 197 tests, 196 pass, 1 NOT_RUN (graceful SIGTERM, Windows) — every use case, rollback, CAS, replay, lookup, restart and HTTP contract test | PASS |
| Races really interleave on PostgreSQL: receipts commit alternately from A and B; two refunds verified by different processes; POS sales alternate — and every invariant holds (5 received of 5, net ≥ refunds, 3 sold of 3, one CONFIRMED sheet, one calculation) | PASS |
| Adapter: dialect; schema refused when absent, created on request, idempotent re-apply with all 10 triggers; camelCase keys, counts/sums as numbers, 8-byte reals, Thai UTF-8; trigger refusals surface; unique-race re-run sees the peer; lasting conflict → 409 after 5 attempts; lock held → 503 busy within the timeout; one snapshot per read; read-only reads; killed backend → 503 then reconnect; config refuses a missing/wrong URL without echoing it | PASS (9 tests) |

**Guard proof** (`node scripts/prove-guards-on-postgres.mjs --runs=3`; each guard
removed in a temp copy of the package, never in the tree):

| Finding | SCM guard | Intact, PostgreSQL | Guard removed, PostgreSQL | Guard removed, SQLite |
|---|---|---|---|---|
| F-1 over-receipt | PurchaseOrder compare-and-swap (D-2) | PASS | **fails 3/3** (6 received on a line of 5) | PASS (hidden by the writer lock) |
| F-9 refunds beyond paid | order-row lock before the ceiling read (D-9) | PASS | **fails 3/3** (3 × 400 verified on 1000 paid) | PASS (hidden) |
| F-12 two CONFIRMED sheets | partial unique index (D-13) | PASS | **fails 3/3** (2 CONFIRMED for one supplier) | PASS (hidden) |

For F-1 the receipt codes are made collision-free in both arms of the proof:
with the real count-then-probe codes, two racing receipts also collide on the
`GRN-` code and the store's unique-violation re-run happens to re-plan the loser,
which masks the shape (in legacy the same collision is F-4's unretried error).

### 4.6 Supplier cost sheets (`test/component/supplier-cost-sheets.test.js`, `test/recovery/cost-sheet-concurrency.test.js`, `test/unit/cost-sheet-parity.test.js`, `apps/server/tests/unit/scm-cost-sheet-parity.test.js`)

The three cases of legacy `task-zai-053-supplier-cost-sheet.test.js` are
mirrored with the same envelope, marked `[legacy]`. Four previews are pinned in
`contracts/v1/cost-sheet-parity-cases.json` (explicit and derived source hash;
product-code, identifier, ambiguous and unmatched SKUs; an archived SKU and a
RETIRED identifier that must not match; two refusals). The golden — sheet code,
preview hash, source hash, source ref, line count and every suggestion with its
locked-FX cost — is **recorded by the legacy `previewSupplierCostSheet`** (db
stub, factory viewer); the SCM preview reproduces it from its own store, 4/4.
Hand check: 0.333 USD × 34 = 11.322 THB → ceiled once to 1133 satang.

| Invariant | Result |
|---|---|
| Preview stores the source and suggestions only (no lines); `SCS-` code; supplier `{id, code, name}`; the same source under a new key → `replayed: true`; a changed payload under a reused hash → `PROCUREMENT_COST_SHEET_SOURCE_HASH_REUSED` | PASS |
| Commit needs the preview hash (`PREVIEW_STALE`) and a confirmed mapping per SKU (`MAPPING_UNCONFIRMED`); duplicate mapping, foreign SKU (`PRODUCT_NOT_FOUND`), archived SKU, and conflicting carton facts for one product (`CARTON_CONFLICT` with details) are refused with **nothing** written | PASS |
| Two ladders: a buyer (po.write) previews, but commits only with Inventory write authority; without it → 404 and no carton, line, audit, outbox or receipt; view-only / inventory-only / no procurement domain → 404 | PASS |
| Commit writes carton facts through Inventory's writer (`PRODUCT_CARTON_ATTRIBUTES_SET`, Product version +1), lines with locked-FX costs (42.5 / 37.4), confirms by CAS (version 2); a second commit replays | PASS |
| A newer confirmed sheet supersedes the supplier's previous one; a superseded sheet cannot be committed; commit by `sourceSha256` works | PASS |
| Store: one CONFIRMED sheet per supplier (partial unique index), immutable source (FX, hashes, preview) and immutable lines | PASS |
| Fault after the carton write / after the lines / after the audit → nothing persists; the same key then commits once and replays | PASS |
| Sheet version moved between read and confirm → 409 `PROCUREMENT_COST_SHEET_VERSION_CONFLICT`; the carton facts and lines of that unit roll back | PASS |
| Two processes: 4 commits of one sheet → 1 committed + 3 replays, 2 lines; two sheets of one supplier at once → exactly one CONFIRMED | PASS (SQLite) |

Mutation check (run once, not committed): dropping Inventory's write check, the
confirmed-mapping rule, the preview-hash check, the source-hash reuse check,
the foreign-product check, the carton-conflict check, the supersession, the
superseded refusal, the version predicate of the confirm, or identifier
matching — each of the 10 fails at least one test.

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

**Honest limit of the SQLite concurrency proof** (superseded for PostgreSQL by
§4.7, which does interleave). On SQLite, `BEGIN IMMEDIATE`
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
| D-3 | Transitional refusal — **retired in `e285c4f4`** | The SCM writer refused ADJUSTMENT and serial ISSUE until their groups moved; units convert since `61cf0a26`, ARCHIVE / MERGE run since `75e6e830`, ADJUSTMENT and serial ISSUE since `e285c4f4` | The contract's `notMigrated` list is empty |
| D-4 | New contract | Mutations require `Idempotency-Key`; outcome lookup endpoint | New API with no legacy clients; legacy routes unchanged |
| D-5 | Ownership, DTO change | `order.customer` is `{id, code}` (code as returned by CRM at write time), not `{id, code, displayName}` via a Customer join | Customer is CRM-owned; SCM keeps the reference, not the master |
| D-6 | DTO superset | POS `payment` returns all Payment columns (adds `kind`, `note`, `verifiedAt`…); response adds `references: {verifiedAt, authority}` | Declares the reference consistency window |
| D-8 | Transitional scope | `POST /v1/commerce/orders/{id}/payments` accepts only orders the SCM store holds (POS or SCM-created orders); legacy-created orders answer 404 there | No cross-store write; legacy orders move with the cohort transfer, not by dual write |
| D-10 | Contract requirement | Customer/Conversation visibility is `scope.visible(businessId)`: the delegation must carry a grant for every Business the actor can see that a request may reference, not only the order's Business | Keeps the legacy `seesBusiness` rule without SCM reading Membership |
| D-9 | Concurrency hardening, no value change | Before a REFUND's ceiling read, the order row is touched with a lock-only UPDATE (`updatedAt = updatedAt`) | Serializes two refund verifications of one order on PostgreSQL; see F-9 |
| D-11 | Transport contract | Pricing: the calculation key is the `Idempotency-Key` header (8–200 of `[A-Za-z0-9._:-]`), not a body `idempotencyKey` (1–200, any text); responses are wrapped (`{ruleSet}`, `{calculation}`) and a replay adds `replayed`/`operation`; a lookup of a calculation whose policy was withdrawn answers 409 like a replay | One key convention for every SCM mutation; legacy key semantics (per Business, normalized request, conflict code, replay re-check) are kept inside it |
| D-12 | Hardening, no behaviour change on legal paths | Store triggers: approved rule content (rules, hash, name, scope, source) and every calculation are immutable; neither can be deleted | Legacy enforced this only in the service |
| D-13 | Hardening, no behaviour change on legal paths | Cost sheets: a partial unique index keeps at most one CONFIRMED sheet per supplier; triggers keep a sheet's source (FX, hashes, preview) and its lines immutable | Makes the legacy intent hold on any engine; see F-12 |
| D-14 | Transport contract | Cost-sheet preview/commit need an `Idempotency-Key` like every SCM mutation; the legacy source-hash replay (`replayed: true`) is kept inside it and answers 200 | One key convention; legacy replay semantics unchanged |
| D-15 | Engine design | The unit-of-work port stays synchronous; on PostgreSQL one `pg` connection per process runs in a worker thread and the caller blocks while a statement runs (as on `node:sqlite`). A unit waiting on a row lock holds its process for up to `lock_timeout` (5 s) | No module changes and one test suite for both engines; throughput scales by processes, not by concurrent units in one process (an async port is a later, separate refactor) |
| D-16 | Error code under real interleaving | On PostgreSQL, the losing side of a fulfilment race can be refused by the Inventory writer's own re-check (`INVENTORY_INSUFFICIENT_STOCK`) instead of the whole-order pre-check (`COMMERCE_STOCK_SHORTAGE`); the order is still refused whole and nothing moves | The pre-check can read before the winner commits; the writer re-checks under the ledger fence. Legacy has the same two checks |
| D-17 | Ownership, availability | The catalogue's Branch list comes from the core owner as ReferenceAuthority `branches` facts (legacy read the Branch table in the same database); while that owner is unavailable the catalogue is a retryable 503 instead of a list without sites | Branch is core-owned; SCM never copies it |
| D-18 | Ordering | SKUs, categories, locations and Branches are ordered by `code` in **binary** order (SQLite BINARY; the test PostgreSQL uses the C locale), so `SKU-A` sorts before `sku-lower`. A legacy production PostgreSQL with a linguistic collation may order mixed-case codes differently | The SCM database must be created with `LC_COLLATE = C` (a SCM-CUTOVER rehearsal item) for identical ordering on every engine |
| D-19 | Coded refusal instead of a database error | Creating a SKU with a `flowAccountSku` already used in the Tenant answers 409 `INVENTORY_FLOWACCOUNT_SKU_TAKEN` with `{flowAccountSku, takenBy}` (legacy create surfaced the unique-index violation) | The same code `setFlowAccountSku` already uses |
| D-20 | Concurrency hardening, no value change | Work-order RELEASE / COMPLETE / CANCEL update the order by compare-and-swap on version in the same unit of work as their ledger rows; the loser gets 409 `*_WORK_ORDER_VERSION_CONFLICT` and nothing it moved persists | Legacy updates by id after its version check; see F-14 (W-1 proof) |
| D-21 | Transitional ownership — **retired in `e2afcc5f`** | StockReservation was read in SCM (kitting OPEN's ATP, the ARCHIVE / MERGE guards) before its writers moved; kitting OPEN, ARCHIVE and MERGE could not cut over before them | The writers moved in `e2afcc5f`; one cutover unit remains per Tenant (reservations with the work orders and the catalogue) |
| D-23 | Concurrency hardening, no value change | A new hold takes the Business's ledger fence before it reads on-hand and the live holds (serializing it with every other hold and every stock movement of the Business); RELEASE / CONVERT / EXPIRE compare-and-swap the hold (`version` and still ACTIVE) | Legacy takes neither: see F-16, F-17 (R-1 / R-2 proofs) |
| D-22 | Coded refusal instead of a database error | MERGE names a same-batch survivor recipe as a `RECIPE_BATCH_SIZE_EXISTS` blocker even when either recipe is ARCHIVED (the entry then adds `recipeStatus` / `survivorRecipeStatus`); legacy only checked a live pair and died on UNIQUE (productId, batchSize) | Same outcome (nothing merged), explained; see F-15 |
| D-24 | Error code for a message-only legacy refusal | A missing stocktake answers 404 `INVENTORY_STOCKTAKE_NOT_FOUND`; legacy threw 404 with the message `Inventory stocktake not found` and no code | Every SCM refusal carries a code |
| D-25 | Transport contract | Stocktake preview / commit need an `Idempotency-Key` like every SCM mutation; the legacy body `idempotencyKey` keeps its replay / conflict semantics inside it (a replay answers 200 with `replayed: true`) | Same pattern as D-14 |
| D-26 | Surface at the edge | The catalogue-intake workbook upload (`.xlsx` → envelope) and the template stay at the edge (BFF); SCM accepts the JSON envelope every surface converges on | BR-009: a new surface adds a converter, never a second write path; same as the cost-sheet workbook |
| D-27 | Concurrency hardening + transport | A maintenance record and an intake commit / cancel take a lock-only touch on the lot / intake before reading it, so concurrent calls serialize: each maintenance audits the value it replaced, and a second commit of one intake replays instead of answering 409 (legacy: 409 `INVENTORY_CATALOG_INTAKE_VERSION_CONFLICT` or a unique-index error). The LINE rule "only the previewer may confirm or cancel" is `requesterOnly: true` in the body, checked against the delegated actor (legacy passed `requestedById` in-process). Commands need an `Idempotency-Key`; responses are wrapped (`{{lot}}`, `{{intake}}`, `{{intakes}}`) | No value change; I-1 proof in §4.13 |
| D-28 | Concurrency hardening, no value change | A cost-sheet commit locks a DRAFT sheet (lock-only touch, as D-9) and re-reads it before deciding, so a concurrent commit of the same sheet waits and replays instead of answering 409 `PRODUCT_VERSION_CONFLICT` | F-18; contract promises the replay |
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

S5.4 stocktake, standalone transfers, locations, stock core (code SHA `e285c4f4`):

| Level | Command | Discovered / executed / skipped | Exit | Duration |
|---|---|---|---|---|
| SCM all, SQLite | `node services/scm/scripts/run-tests.mjs` | 283 / 282 pass / 1 skipped (graceful SIGTERM, Windows) | 0 | ~35 s |
| SCM all, PostgreSQL 17.10 | `node services/scm/scripts/run-tests.mjs --engine=postgres` | run 1: 283 / 281 pass / 1 fail (F-18) / 1 skipped; run 2: 283 / 282 pass / 1 skipped | 1 then 0 | ~2 min each |
| Guard proof | `prove-guards-on-postgres.mjs --only=S-1 --runs=3` | without the early fence 3/3 fail on PostgreSQL; control PASS; SQLite passes | 0 | ~2 min |
| Kernel drift | `sync-kernel.mjs --check` | 15 files | 0 | <1 s |
| Governance | `npm run govern` | — | 0 (no CRITICAL) | — |

S5.4 reservation writers + public ATP reads (code SHA `e2afcc5f`):

| Level | Command | Discovered / executed / skipped | Exit | Duration |
|---|---|---|---|---|
| SCM all, SQLite | `node services/scm/scripts/run-tests.mjs` | 261 / 260 pass / 1 skipped (graceful SIGTERM, Windows) | 0 | ~30 s |
| SCM all, PostgreSQL 17.10 | `node services/scm/scripts/run-tests.mjs --engine=postgres` | 261 / 260 pass / 1 skipped | 0 | ~2 min |
| Guard proof | `prove-guards-on-postgres.mjs --only=R-1,R-2,W-1 --runs=3` | R-1 1/3, R-2 3/3 (collision-free codes), W-1 2/3 fail without the guard; controls PASS; SQLite passes | 0 | ~6 min |
| Governance | `npm run govern` | — | 0 (no CRITICAL) | — |

Legacy hotfix F-14 (#561, head `dd689c39`, branch `fix/legacy-work-order-cas`):

| Level | Command | Discovered / executed / skipped | Exit | Duration |
|---|---|---|---|---|
| Race suite, original code | `vitest tests/integration/scm-legacy-races.postgres.test.js` (opt-in loopback DB) | F-14 × 3 FAIL (40 sets; 80 staged; 40 branded) | 1 | — |
| Race suite, fixed | same, 3 runs | 8 / 8 each run | 0 | ~12 s |
| Full suite + build | `npm test` + `npm run build` (apps/server) | 809 files: 803 pass / 6 skipped (opt-in); 6766 tests | 0 | — |
| Governance | `npm run govern` | `domain-state.json` untouched (S1's lease) | 0 | — |

S5.4 recipes, work orders, de-kitting, product ARCHIVE / MERGE (code SHA `75e6e830`):

| Level | Command | Discovered / executed / skipped | Exit | Duration |
|---|---|---|---|---|
| SCM all, SQLite | `node services/scm/scripts/run-tests.mjs` | 252 / 251 pass / 1 skipped (graceful SIGTERM, Windows) | 0 | ~30 s |
| SCM all, PostgreSQL 17.10 | `node services/scm/scripts/run-tests.mjs --engine=postgres` | 252 / 251 pass / 1 skipped | 0 | ~2 min |
| Guard proof W-1 | `node services/scm/scripts/prove-guards-on-postgres.mjs --only=W-1 --runs=3` | intact PASS; without the CAS PostgreSQL fails 3/3 (`[COMPLETED, COMPLETED]`), SQLite passes | 0 | ~2 min |
| F-15 on legacy | scratch vitest in apps/server (not committed) | legacy MERGE → `PrismaClientKnownRequestError` P2002 on `productRecipe.updateMany`, duplicate stays ACTIVE | — | — |
| Kernel drift | `sync-kernel.mjs --check` | 15 files | 0 | <1 s |
| Governance | `npm run govern` | — | 0 (no CRITICAL) | — |

S5.4 Inventory catalogue writers + SKU identity (code SHAs `8f9a23db`, `61cf0a26`):

| Level | Command | Discovered / executed / skipped | Exit | Duration |
|---|---|---|---|---|
| SCM all, SQLite | `node services/scm/scripts/run-tests.mjs` | 221 / 220 pass / 1 skipped (graceful SIGTERM, Windows) | 0 | ~25 s |
| SCM all, PostgreSQL 17.10 | `node services/scm/scripts/run-tests.mjs --engine=postgres` | 221 / 220 pass / 1 skipped | 0 | ~2 min |
| Kernel drift | `sync-kernel.mjs --check` | 14 files | 0 | <1 s |

S5.5 PostgreSQL adapter (code SHA `2db0b1e9`):

| Level | Command | Discovered / executed / skipped | Exit | Duration |
|---|---|---|---|---|
| SCM all, SQLite | `node services/scm/scripts/run-tests.mjs` | 197 / 196 pass / 1 skipped (graceful SIGTERM, Windows) | 0 | ~25 s (the adapter test starts its own PostgreSQL) |
| SCM all, PostgreSQL 17.10 | `node services/scm/scripts/run-tests.mjs --engine=postgres` | 197 / 196 pass / 1 skipped | 0 | ~2 min |
| Guard proof | `node services/scm/scripts/prove-guards-on-postgres.mjs --runs=3` | F-1, F-9, F-12: intact PASS; removed → PostgreSQL fails 3/3, SQLite passes | 0 | ~5 min |
| PostgreSQL smoke | `node services/scm/scripts/pg-smoke.mjs` | PostgreSQL 17.10 on x86_64-windows | 0 | ~6 s start |
| Kernel drift | `sync-kernel.mjs --check` | 14 files | 0 | <1 s |

S5.4 supplier cost sheets (code SHA `17b542b9`):

| Level | Command | Discovered / executed / skipped | Exit | Duration |
|---|---|---|---|---|
| SCM all | `node services/scm/scripts/run-tests.mjs` | 188 / 187 pass / 1 skipped (graceful SIGTERM, Windows) | 0 | ~7 s |
| Cost-sheet parity, legacy recorder | `vitest tests/unit/scm-cost-sheet-parity.test.js` | 5 / 5 / 0 | 0 | — |
| Legacy procurement regression | `vitest` task-zai-053, scm-cost-sheet-parity, supplier-cost-sheet-routes, fr164-procurement, fr165-goods-receipt | 5 files / 22 / 0 | 0 | 11.3 s |
| Kernel drift | `sync-kernel.mjs --check` | 14 files | 0 | <1 s |
| Governance | `npm --prefix apps/server run govern` | — | 0 (no CRITICAL; `domain-state.json` +1 test, stable on a second graph run) | — |

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

S5.4 shelf-life, hygiene, replenishment, catalogue intake (code SHA `8fd4d4a9`):

| Level | Command | Discovered / executed / skipped | Exit | Duration |
|---|---|---|---|---|
| SCM all, SQLite | `node services/scm/scripts/run-tests.mjs` | 297 / 296 pass / 1 skipped (graceful SIGTERM, Windows) | 0 | ~40 s |
| SCM all, PostgreSQL 17.10 | `node services/scm/scripts/run-tests.mjs --engine=postgres` | run 1: 297 / 296 pass / 1 skipped; run 2 (after test-only additions): 297 / 295 pass / 1 fail (F-18: the same-sheet loser answered `PRODUCT_VERSION_CONFLICT`, the test expects `SCM_STORE_BUSY`) / 1 skipped | 0 then 1 | ~2.5 min each |
| Guard proof | `prove-guards-on-postgres.mjs --only=I-1 --runs=3` | without the intake lock 3/3 fail on PostgreSQL; control PASS; SQLite passes | 0 | ~2 min |
| Legacy regression | `npx vitest run` fr179-shelf-life-guard, fr201-inventory-sku-governance, fr208-inventory-catalog-intake (apps/server) | 3 files / 21 / 0 | 0 | — |
| Kernel drift | `sync-kernel.mjs --check` | 16 files | 0 | <1 s |

### 6.1 Governance after pinning

`npm --prefix apps/server run govern` with ADR-109, this handoff, the ledger pin
and the regenerated `domain-state.json` staged: **exit 0, no CRITICAL**. The
remaining WARNING/INFO lines are the pre-existing baseline (broken
`llms-full.txt` links, accepted-debt baselines).

## 7. Defects and findings (not fixed in legacy here)

| Id | Finding | Evidence | Status | Proposed handling |
|---|---|---|---|---|
| F-1 | Legacy `postGoodsReceipt` plans against the PO read at the start and updates `version: {increment: 1}` with no predicate. On PostgreSQL READ COMMITTED, concurrent receipts each pass the outstanding check → **over-receipt** | **Reproduced on the legacy code itself** (PR #557, `scm-legacy-races.postgres.test.js`, PostgreSQL 17.10): 12 received on a line of 5, 3/3 runs; also the SCM port without its CAS (§4.7) | **CONFIRMED** — **fixed in #557 (merged `7363c931`)** (PO `updateMany({where:{id,version}})` → 409 `PURCHASE_ORDER_VERSION_CONFLICT`); green 3/3 | Merged in #557 (`7363c931`), deployed in `caabd8a7` by MC0; not mixed into the extraction |
| F-2 | `GOODS_RECEIPT_SELF_POST_FORBIDDEN` had no legacy test | grep of apps/server/tests | **Test added in #557** (`fr165-goods-receipt.test.js`): refusal, attested post audited `selfVerified: true`, another receiver `false`; removing the guard or the audit field fails it | Review with #557 |
| F-3 | Receipts, POS checkout, order create and payment record take no idempotency key. A timed-out client retry creates a second GRN/order and stock effect | Code | CONFIRMED gap | SCM API requires keys; legacy transition needs a contract review (prompt §11.2) |
| F-4 | GRN/PO/order codes are count-then-probe; a race gives a non-retried unique violation | Code | CONFIRMED (legacy) | SCM runs code generation inside the writer lock / CAS |
| F-5 | `priceLandedInventoryQuote` returns `rulesJson` (the private rule document) and accepts caller `sourceRefs`; its only caller (agent tools) is not wired | `pricing-inventory-service.js` | TO_VERIFY with S1 before any agent wiring | Gate SCM-AGENT must use an allowlisted DTO |
| F-6 | Procurement ↔ Inventory import cycle (inventory-catalog imports procurement cost helpers; procurement domain imports `zInventoryCode`) | Code | CONFIRMED | Kept in the kernel as-is (pure); break when catalog moves |
| F-7 | Customer erasure does not touch SCM `customerId` references (SalesOrder, StockMovement, StockReservation) | `identity/erase-customer-principal.js` | CONFIRMED, cross-owner | Report to Identity/CRM owner; not SCM's decision |
| F-8 | While both stores exist, three tenant-wide uniqueness rules cannot hold across them: `Payment.bankReference`, `ORD-…` and `PAY-…` codes | By construction (two databases) | CONFIRMED (design). **SCM capability complete** for the Commerce cohort: all writers (ce304e84) and the revenue read (d160acaf) exist in SCM. Open: consumer routing and the cohort data transfer | Cutover gate: per Tenant, one single-writer switch moves POS, payments, sales orders and the revenue read together, after a transfer of that Tenant's orders/payments/codes; no dual-write period |
| F-10 | Legacy fulfilment (`issueStockForOrder`) issues without `customerId`/`salesOrderId`, so a SKU dedicated to another customer or order leaves stock on COMPLETE; POS passes both and refuses | `sales-order-service.js:208`; SCM parity test | **OWNER RULING 2026-09-24: unintended** (proposed via Mission Control, confirmed by the owner in the S5 chat) | Not changed during extraction: parity kept in legacy and SCM until a separate FR is implemented (pass the order and its customer on the fulfilment issue, with its own test). The FR id is declared by S1 (PRD registry owner) when the COMMON_RESOURCES queue reaches item (d); S1 then informs S5 |
| F-11 | `pricing-catalog-service` (catalog freeze) **also inserts PricingCalculation** rows (key prefix per freeze) and reads the active policy; `pricing-publication`, `pricing-inventory-service` (F-5) and Knowledge `assertPricingCatalogCurrent` read PricingRuleSet/PricingCalculation directly | `pricing-catalog-service.js:82/93`, `pricing-publication.js:15/19`, `pricing-inventory-service.js:25` | CONFIRMED (design) | These tables have one owner only after the catalog group moves with them (behind SCM-FILES/SCM-KNOWLEDGE) or reads them through the SCM API; until then SCM pricing serves no consumer, and the per-Business key space is shared with catalog keys at transfer |
| F-12 | Legacy commit supersedes the supplier's other CONFIRMED sheets with an unguarded `updateMany` before its own CAS, and no constraint holds "one CONFIRMED per supplier". On PostgreSQL READ COMMITTED two commits can each supersede before the other confirms → two CONFIRMED sheets | **Reproduced on the legacy code itself** (#557): 2 CONFIRMED, 3/3 runs (sheets without carton facts — with them the Product CAS happens to serialize the commits) | **CONFIRMED** — **fixed in #557 (merged `7363c931`)** (lock-only touch of the supplier row before the supersession; no migration); green 3/3. SCM additionally keeps the partial unique index (D-13) | Merged in #557 (`7363c931`), deployed in `caabd8a7` by MC0; a DB-level index in legacy would need a migration (schema owner) |
| F-13 | SCM read Inventory tables whose writers had not moved (`ProductIdentifier`, `ProductMaster`, `InventoryCategory`) | Design | **Writers moved** (`8f9a23db`, `61cf0a26`); recipes, work orders and product ARCHIVE / MERGE moved in `75e6e830`. Open: StockReservation is read in SCM but written in legacy (D-21), and the cutover transfer of catalogue rows | Move the reservation writers (ATP group) before kitting OPEN / ARCHIVE / MERGE cut over; transfer catalogue rows per Tenant at cutover under the single-writer switch |
| F-14 | Legacy work-order RELEASE / COMPLETE / CANCEL (`kitting-work-order-service`, `customization-work-order-service`) check `order.version` and then `update({where:{id}})` with no version predicate. On PostgreSQL READ COMMITTED two concurrent COMPLETEs of one order can both pass the check → components consumed twice and the output received twice | **The legacy shape reproduced in SCM's copy**: without the SCM compare-and-swap, two processes complete one kitting order twice on PostgreSQL 3/3 (W-1, §4.10); SQLite hides it. Not yet run against the legacy code itself | **CONFIRMED on the legacy code** (#561, PostgreSQL 17): 4 × COMPLETE of a 10-set kitting order → 40 sets; 4 × RELEASE staged 80 instead of 20; 4 × customization COMPLETE → 40 from 10; with the round-2 barrier all 6 RELEASE / COMPLETE / CANCEL races give two winners on the original code | **Fix proposed in #561** (`casUpdate`: `updateMany({id, version})`, 409 on 0 rows); deterministic race suite 11/11, 3 of 3 runs (`be171333`); full `npm test` 803 files / 6766 tests; build clean. S1 PASS at `be171333`; **MERGED** `9e25aa1f`; deployed in `caabd8a7` by MC0 |
| F-16 | Legacy `createReservation` reads on-hand and the ACTIVE holds with no lock, then inserts. Under PostgreSQL READ COMMITTED concurrent holds (or a hold and a stock issue) can each pass the ATP check → promised > on-hand | **The legacy shape reproduced in SCM's copy**: without the fence, 4 holds of 3 on 10 units (R-1, 1/3 runs); SQLite hides it. Not yet run against the legacy code itself | **CONFIRMED on the legacy code** (#564): 8 × 3 on 10 → all 8 held (24); deterministic 2 × 6 on 10 → both held | **Fixed in #564** (`acquireLedgerFence` before the ATP read); MERGED `caabd8a7`, deployed by MC0 |
| F-17 | Legacy `applyReservationAction` checks the version and then updates the hold by id alone; two concurrent CONVERTs of one quote each place an ORDER hold → the same units committed twice | **The legacy shape reproduced in SCM's copy**: two ORDER holds 3/3 (R-2); SQLite hides it. Not yet run against the legacy code | **CONFIRMED on the legacy code** (#564): 4 CONVERTs → 4 ORDER holds | **Fixed in #564** (CAS on (id, version, ACTIVE) before the ORDER code is allocated; expiry stamps only ACTIVE rows); MERGED `caabd8a7`, deployed by MC0 |
| F-18 | Two concurrent commits of ONE cost sheet on PostgreSQL READ COMMITTED: the loser read the sheet as DRAFT before the winner committed, went on to the Product carton compare-and-swap, waited on the winner's row and then matched 0 rows, answering 409 `PRODUCT_VERSION_CONFLICT` instead of the contract's replay. SQLite's writer lock always produced the replay, so the answer depended on timing. Legacy `supplier-cost-sheet-service` has the same unlocked shape | Reproduced in SCM: 5/120 runs under 12-way parallel load (same sheet `["committed","PRODUCT_VERSION_CONFLICT","replayed","replayed"]`); a forced overlap (a third connection holds the Product row until both commits wait) gives it every time | **FIXED in SCM `bc24e5bb`** (D-28): a DRAFT sheet is locked (lock-only touch) and re-read before deciding; forced-overlap regression case (PostgreSQL-only) fails before the fix and passes after; 240 loop runs under the same load, 0 failures. No assertion loosened | Legacy: same shape, outcome-only (a 409 instead of a replay, nothing written twice); not fixed there |
| F-19 | Under 12-way parallel load plus full PostgreSQL suites, `test/recovery/two-process-receipt.test.js:35` failed once: one losing receipt answered 409 `SCM_CONCURRENT_CONFLICT` (the store's retryable answer after 5 re-runs on 40001 / 40P01 / 23505). That code is emitted by `pg-store.js` but is missing from the contract's `retryableCodes` and from the test's accepted list | Subagent's load loop (once); not seen in normal full runs | OPEN | Proposed: list `SCM_CONCURRENT_CONFLICT` (retryable, no effect) in the contract and accept it in the receipt race's refusal list, after confirming it is never emitted after a partial effect. Not changed here |
| F-15 | Legacy MERGE's blocker check ignores an ARCHIVED survivor recipe at the batch size of the duplicate's recipe, but `@@unique([productId, batchSize])` covers archived rows, so the re-point dies with an unhandled Prisma P2002 | **Reproduced on the legacy code** (scratch vitest, not committed): P2002 on `productRecipe.updateMany`, transaction rolled back | CONFIRMED (legacy) — nothing is corrupted, the refusal is unexplained | SCM names it as a blocker (D-22). **Fixed in #564, MERGED `caabd8a7`, deployed by MC0** (the user said "fix it all" on 2026-09-24, overriding the earlier backlog decision): `mergeBlockers` names every same-batch survivor recipe |
| F-9 | Legacy `applyPaymentAction` reads the verified net for a REFUND and updates the payment by CAS on the payment row only. On PostgreSQL READ COMMITTED, concurrent refund verifications can each pass the ceiling → refunded > paid | **Reproduced on the legacy code itself** (#557): 4 × 400 verified on 1000 paid, 3/3 runs; also the SCM port without its lock (§4.7) | **CONFIRMED** — **fixed in #557 (merged `7363c931`)** (lock-only touch of the order row before the read); green 3/3 | Merged in #557 (`7363c931`); deployed in `caabd8a7` by MC0 |

## 8. Dependencies, blockers and shared changes requested

| Gate | Waiting phase | Waiting for | From | Unblocks when | Safe now |
|---|---|---|---|---|---|
| SCM-ARCH | Any move beyond this slice's owned code | Review of ADR-109 + this matrix | Owner + reviewers | ADR-109 accepted | Pricing/receipt tests, S5.4 characterization |
| SCM-CORE | Real BFF → SCM calls; POS in a real process | Identity owner signs off `scm.delegation.v1` (issuer, key distribution, lifetime, revocation), the audit relay mapping, a Branch + Customer + Conversation reference façade (facts: tenant, business, status/deletedAt, customerId, code; **and the Branch list of a Business for the POS catalogue**) for ReferenceAuthority, and grants for every visible Business (D-10) | Identity/Core owner + CRM owner + S5 | Reviewed contract SHA + provider tests; a façade the real process can call | Everything service-local |
| COMMON | CI for services/scm | A workflow job `node services/scm/scripts/run-tests.mjs` + `docker build -f services/scm/Dockerfile .` + disposable start smoke | Integrator (root CI owner) | Job merged | Local tests |
| SCM-AGENT | S5.4 agent/LINE tools | Read/mutation/confirmation/receipt contract | S1 + S5 | Reviewed contract | POS/fulfilment moves |
| SCM-FILES | Payment-slip facts (POS, payments), cost-sheet originals, catalog artifacts | FilePort exact-version read + a `fileAsset` fact lookup (businessId, deletedAt) for ReferenceAuthority | S3 + S5 | Reviewed FilePort (ADR-107) + fixtures | Non-file groups; POS without slips |
| SCM-KNOWLEDGE | Catalog publication | Admission/receipt/revocation contract | Knowledge owner + S5 | Reviewed contract | Calculations without publication |
| SCM-CUTOVER | Any production routing | Migration/restore/rollback rehearsal + backup scripts through SCM + operator approval; POS + payments + sales orders switch together per Tenant (F-8) | Integrator/operator + S5 | Rehearsal evidence + authorization | Disposable rehearsal |
| (engine) | PostgreSQL claim | — | S5 | **Met locally**: whole suite + adapter tests + guard proof on PostgreSQL 17 (§4.7) | A managed/production-like PostgreSQL run (pooler, TLS, the real role) belongs to SCM-CUTOVER rehearsal |

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
observed_at: "2026-09-24T23:15:00+07:00"
base_sha: fad8ec6252941ca3de01afdb3116484f86b366c3
code_head_sha: bc24e5bb
handoff_source_commit: "the doc commit after bc24e5bb on feat/scm-service-extraction"
branch: feat/scm-service-extraction
pr_number: 546
current_tranche: S5.4 Inventory group complete (user approved 2026-09-25 after wrap-up): shelf-life, hygiene, replenishment, catalogue intake (8fd4d4a9); F-18 fixed (bc24e5bb); F-19 open (heavy-load only). S5.4 through stocktake/transfers/locations done (e285c4f4). #561 MERGED 9e25aa1f. #564 MERGED caabd8a7. Production runs caabd8a7 (MC0's deploy, 2026-09-24T18:09Z; S5 did not deploy). #546 stays draft, not for merge
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
  - claim: "S5.4 supplier cost-sheet preview/commit/get/list (TASK-ZAI-053) as SCM units of work, carton facts via Inventory's writer, legacy-recorded preview parity"
    code_paths: [services/scm/src/modules/procurement/application/supplier-cost-sheets.js, services/scm/src/modules/inventory/application/product-carton.js, services/scm/contracts/v1/cost-sheet-parity-cases.json, services/scm/contracts/v1/cost-sheet-parity-golden.json, apps/server/tests/unit/scm-cost-sheet-parity.test.js]
  - claim: "S5.4 Inventory catalogue writers (create, bundles, UPDATE/PHASE_OUT/REACTIVATE, product page) and SKU identity (identifiers, unit conversions incl. ledger conversion, resolve, FlowAccount SKU)"
    code_paths: [services/scm/src/modules/inventory/application/catalog.js, services/scm/src/modules/inventory/application/identity.js, services/scm/src/modules/inventory/adapters/catalog-repo.js, services/scm/src/modules/inventory/adapters/identity-repo.js]
  - claim: "S5.5 PostgreSQL store adapter behind the same port; whole suite on PostgreSQL 17; guard proof for F-1/F-9/F-12"
    code_paths: [services/scm/src/infrastructure/pg-store.js, services/scm/src/infrastructure/pg-connection.js, services/scm/src/infrastructure/pg-worker.js, services/scm/src/infrastructure/sql-dialect.js, services/scm/scripts/prove-guards-on-postgres.mjs, services/scm/test/unit/pg-store.test.js]
  - claim: "S5.4 POS terminal catalogue read (FR-183) on the SCM store + Branch facts, legacy-recorded parity"
    code_paths: [services/scm/src/modules/commerce/application/pos-catalogue.js, services/scm/src/modules/inventory/application/catalogue.js, services/scm/contracts/v1/pos-catalogue-parity-cases.json, services/scm/contracts/v1/pos-catalogue-parity-golden.json, apps/server/tests/unit/scm-pos-catalogue-parity.test.js]
  - claim: "S5.4 stocktake (FR-184), warehouse locations + standalone transfer (FR-174), and the rest of the stock core — ADJUSTMENT, serial ISSUE, movement / lot commands, lot / serial reads (FR-155); D-3 retired"
    code_paths: [services/scm/src/modules/inventory/application/stocktake.js, services/scm/src/modules/inventory/application/locations.js, services/scm/src/modules/inventory/application/stock-ledger.js, services/scm/src/modules/inventory/adapters/stocktake-repo.js, services/scm/src/modules/inventory/adapters/inventory-repo.js]
  - claim: "S5.4 reservation writers and public ATP / max-buildable reads (FR-180) as SCM units of work; ledger fence + hold CAS proven necessary on PostgreSQL (R-1, R-2)"
    code_paths: [services/scm/src/modules/inventory/application/atp.js, services/scm/src/modules/inventory/adapters/wip-repo.js]
  - claim: "S5.4 shelf-life audit + maintenance (FR-179), catalogue hygiene (FR-206), replenishment (FR-207) and catalogue intake preview/commit/cancel/reads (FR-208) as SCM units of work; the whole Inventory group has moved; intake lock proven on PostgreSQL (I-1)"
    code_paths: [services/scm/src/modules/inventory/application/shelf-life.js, services/scm/src/modules/inventory/application/hygiene.js, services/scm/src/modules/inventory/application/catalog-intake.js, services/scm/src/modules/inventory/adapters/intake-repo.js, services/scm/src/modules/inventory/adapters/report-repo.js]
  - claim: "Legacy hotfix F-14 (work-order CAS), reproduced on legacy code and fixed: draft PR #561"
    code_paths: [apps/server/src/modules/inventory/application/kitting-work-order-service.js, apps/server/src/modules/inventory/application/customization-work-order-service.js, apps/server/tests/integration/scm-legacy-races.postgres.test.js]
  - claim: "S5.4 recipes (FR-156), customization (FR-176) and kitting (FR-177) work orders, de-kitting (FR-178), the transfer core (FR-174), the ATP read (FR-180) and product ARCHIVE/MERGE (FR-205) as SCM units of work; work-order CAS proven necessary on PostgreSQL (W-1)"
    code_paths: [services/scm/src/modules/inventory/application/recipes.js, services/scm/src/modules/inventory/application/customization.js, services/scm/src/modules/inventory/application/kitting.js, services/scm/src/modules/inventory/application/de-kitting.js, services/scm/src/modules/inventory/application/transfers.js, services/scm/src/modules/inventory/application/atp.js, services/scm/src/modules/inventory/application/catalog.js, services/scm/src/modules/inventory/adapters/wip-repo.js]
verified:
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: bc24e5bb, command: "node services/scm/scripts/run-tests.mjs (sqlite) and --engine=postgres twice", discovered: 298, executed: "sqlite 296, postgres 297 (x2)", skipped: "sqlite 2, postgres 1", exit_code: 0, environment: "win32, node 24.19.0, sqlite + embedded PostgreSQL 17.10" }
  - { level: F18_LOAD_LOOP, result: PASS, verified_code_sha: d8d789b8, command: "cost-sheet-concurrency loop, 12-way parallel + full PostgreSQL suites", evidence: "before: 5/120 failed (PRODUCT_VERSION_CONFLICT); after: 0/240" }
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: 8fd4d4a9, command: "node services/scm/scripts/run-tests.mjs (sqlite) and --engine=postgres", discovered: 297, executed: 296, skipped: 1, exit_code: 0, environment: "win32, node 24.19.0, sqlite + embedded PostgreSQL 17.10", note: "a second PostgreSQL run hit F-18 once (PRODUCT_VERSION_CONFLICT where SCM_STORE_BUSY is expected)" }
  - { level: POSTGRES_GUARD_PROOF, result: PASS, verified_code_sha: 8fd4d4a9, command: "prove-guards-on-postgres.mjs --only=I-1 --runs=3", findings: "I-1 intake commit loser answers VERSION_CONFLICT instead of replay 3/3 without the lock; SQLite passes", exit_code: 0 }
  - { level: SERVER_REGRESSION_INVENTORY, result: PASS, verified_code_sha: 8fd4d4a9, command: "vitest fr179-shelf-life-guard, fr201-inventory-sku-governance, fr208-inventory-catalog-intake", discovered: 21, executed: 21, skipped: 0, exit_code: 0 }
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: e285c4f4, command: "node services/scm/scripts/run-tests.mjs (sqlite) and --engine=postgres", discovered: 283, executed: 282, skipped: 1, exit_code: 0, environment: "win32, node 24.19.0, sqlite + embedded PostgreSQL 17.10", note: "one earlier full PostgreSQL run had 1 intermittent failure in cost-sheet-concurrency (F-18)" }
  - { level: POSTGRES_GUARD_PROOF, result: PASS, verified_code_sha: e285c4f4, command: "prove-guards-on-postgres.mjs --only=S-1 --runs=3", findings: "S-1 stocktake double commit 3/3 without the early fence; SQLite passes", exit_code: 0 }
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: e2afcc5f, command: "node services/scm/scripts/run-tests.mjs (sqlite) and --engine=postgres", discovered: 261, executed: 260, skipped: 1, exit_code: 0, environment: "win32, node 24.19.0, sqlite + embedded PostgreSQL 17.10" }
  - { level: POSTGRES_GUARD_PROOF, result: PASS, verified_code_sha: e2afcc5f, command: "prove-guards-on-postgres.mjs --only=R-1,R-2,W-1 --runs=3", findings: "R-1 over-promise 1/3, R-2 double CONVERT 3/3, W-1 double completion 2/3 without each guard; controls PASS; SQLite passes", exit_code: 0 }
  - { level: LEGACY_RACE_POSTGRES, result: PASS, verified_code_sha: dd689c39, branch: fix/legacy-work-order-cas, command: "vitest scm-legacy-races.postgres.test.js (opt-in loopback DB)", evidence: "original code F-14 FAIL (40 of 10 sets; 80 staged of 20; 40 of 10 branded); fixed 8/8 x3" }
  - { level: LEGACY_FULL_SUITE, result: PASS, verified_code_sha: dd689c39, branch: fix/legacy-work-order-cas, command: "npm test && npm run build (apps/server)", discovered: "809 files", executed: "803 files / 6766 tests", skipped: "6 files (opt-in)", exit_code: 0 }
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
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: 17b542b9, command: "node services/scm/scripts/run-tests.mjs", discovered: 188, executed: 187, skipped: 1, exit_code: 0, environment: "win32, node 24.19.0" }
  - { level: COST_SHEET_PARITY, result: PASS, verified_code_sha: 17b542b9, command: "vitest scm-cost-sheet-parity (legacy recorder) + node --test cost-sheet-parity (SCM)", discovered: 9, executed: 9, skipped: 0, exit_code: 0 }
  - { level: SERVER_REGRESSION_PROCUREMENT, result: PASS, verified_code_sha: 17b542b9, command: "vitest task-zai-053/scm-cost-sheet-parity/supplier-cost-sheet-routes/fr164/fr165", discovered: 22, executed: 22, skipped: 0, exit_code: 0, duration_seconds: 11.3 }
  - { level: LOCAL_IMAGE_BUILD, result: NOT_RUN, reason: "docker daemon down; not started because host Docker serves production" }
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: 2db0b1e9, command: "node services/scm/scripts/run-tests.mjs", discovered: 197, executed: 196, skipped: 1, exit_code: 0, environment: "win32, node 24.19.0, sqlite" }
  - { level: POSTGRES, result: PASS, verified_code_sha: 2db0b1e9, command: "node services/scm/scripts/run-tests.mjs --engine=postgres", discovered: 197, executed: 196, skipped: 1, exit_code: 0, environment: "win32, node 24.19.0, embedded PostgreSQL 17.10, READ COMMITTED" }
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: 27dbf55e, command: "node services/scm/scripts/run-tests.mjs (sqlite) and --engine=postgres", discovered: 202, executed: 201, skipped: 1, exit_code: 0, environment: "win32, node 24.19.0, sqlite + embedded PostgreSQL 17.10" }
  - { level: POS_CATALOGUE_PARITY, result: PASS, verified_code_sha: 27dbf55e, command: "vitest scm-pos-catalogue-parity (legacy recorder) + node --test pos-catalogue-parity (SCM)", discovered: 5, executed: 5, skipped: 0, exit_code: 0 }
  - { level: POSTGRES_GUARD_PROOF, result: PASS, verified_code_sha: 2db0b1e9, command: "node services/scm/scripts/prove-guards-on-postgres.mjs --runs=3", findings: "F-1, F-9, F-12 reproduced 3/3 without the guard; intact control PASS", exit_code: 0 }
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: 61cf0a26, command: "node services/scm/scripts/run-tests.mjs (sqlite) and --engine=postgres", discovered: 221, executed: 220, skipped: 1, exit_code: 0, environment: "win32, node 24.19.0, sqlite + embedded PostgreSQL 17.10" }
  - { level: LEGACY_RACE_POSTGRES, result: PASS, verified_code_sha: 385fe279, branch: fix/scm-legacy-pg-races, command: "vitest tests/integration/scm-legacy-races.postgres.test.js (opt-in loopback DB)", evidence: "original code FAIL 3/3 (12 of 5 received; 4 × 400 refunds on 1000; 2 CONFIRMED); fixed PASS 3/3", environment: "embedded PostgreSQL 17.10" }
  - { level: LEGACY_FULL_SUITE, result: PASS, verified_code_sha: d374bcb7, branch: fix/scm-legacy-pg-races, command: "npm --prefix apps/server test && npm --prefix apps/server run build", discovered: "809 files", executed: "802 files / 6747 tests", skipped: "7 files (opt-in)", exit_code: 0 }
  - { level: ISOLATED_TESTS, result: PASS, verified_code_sha: 75e6e830, command: "node services/scm/scripts/run-tests.mjs (sqlite) and --engine=postgres", discovered: 252, executed: 251, skipped: 1, exit_code: 0, environment: "win32, node 24.19.0, sqlite + embedded PostgreSQL 17.10" }
  - { level: POSTGRES_GUARD_PROOF, result: PASS, verified_code_sha: 75e6e830, command: "node services/scm/scripts/prove-guards-on-postgres.mjs --only=W-1 --runs=3", findings: "W-1 (work-order CAS): double completion 3/3 without the guard; intact control PASS; SQLite passes without it", exit_code: 0 }
  - { level: CI, result: NOT_RUN }
remaining:
  - "S5.4 remaining: pricing catalog freeze/admission/publication (behind SCM-FILES/SCM-KNOWLEDGE; F-11) and billing (behind an Identity command path for LegalEntity/Branch). The Inventory group is complete"
  - "F-19: SCM_CONCURRENT_CONFLICT missing from the contract retryableCodes and the receipt race's accepted list (seen once under heavy load)"
  - "Consumer routing (BFF → SCM) for the Commerce cohort, behind SCM-CORE"
  - "Image build/start smoke; BFF consumer; core delegation issuer; audit outbox relay; a managed PostgreSQL rehearsal (pooler, TLS, restricted role) under SCM-CUTOVER"
  - "F-10 separate FR (declared by the PRD registry owner), then the fulfilment change in legacy and SCM together"
contracts:
  - { name: scm-api, revision: v1-draft.14, provider_owner: S5, consumer_owner: "BFF (unassigned)", review_status: PROPOSED, provider_conformance: "LOCAL PASS", consumer_conformance: NOT_RUN }
  - { name: scm.delegation.v1, provider_owner: "Identity/Core", consumer_owner: S5, review_status: PROPOSED, provider_conformance: NOT_RUN, consumer_conformance: "LOCAL PASS (synthetic issuer)" }
  - { name: ReferenceAuthority (branch/branches/customer/conversation/fileAsset facts), provider_owner: "Core + CRM + Files (S3)", consumer_owner: S5, review_status: PROPOSED, provider_conformance: NOT_RUN, consumer_conformance: "LOCAL PASS (fixture provider)" }
blockers:
  - { dependency: "scm.delegation.v1 review + core issuer", kind: CONTRACT, phase_blocked: "real consumer integration", owner_to_unblock: "Identity/Core owner + S5", condition_to_unblock: "reviewed contract SHA + provider tests", safe_work_now: ["S5.4 service-local moves", "PostgreSQL adapter"] }
  - { dependency: "root CI job for services/scm", kind: INTEGRATION_ORDER, phase_blocked: "CI_VERIFIED/HOSTED_IMAGE_BUILD", owner_to_unblock: integrator, condition_to_unblock: "job merged", safe_work_now: ["local tests"] }
next_action: "Inventory group complete and F-18 fixed (bc24e5bb). F-19 needs an owner decision on the contract retryable list. #546 stays draft, not for merge. Billing and the pricing catalog wait for their gates."
owned_paths: [services/scm/**, docs/migrations/service-extraction/SCM-HANDOFF.md, docs/decisions/ADR-109-SCM-SERVICE-EXTRACTION.md, apps/server/tests/unit/scm-pricing-parity.test.js, apps/server/tests/unit/scm-revenue-parity.test.js, apps/server/tests/unit/scm-cost-sheet-parity.test.js]
shared_changes_requested: ["FR id for F-10 (fulfilment issue carries salesOrderId/customerId) in docs/PRD-SDD-v1.0.md — PRD registry owner", "docs/.id-ledger.json +ADR-109", "root CI job for services/scm", "board row: Commerce+Inventory+Procurement DEFERRED_AS_GROUP → SCM / Session 5 IN_PROGRESS (evidence above)", "Branch/Customer fact façade (core, CRM) and fileAsset fact lookup (S3) for ReferenceAuthority"]
board_expected_source_commit: "REFACTOR-STATUS.md 0.1.0b on feat/market-intelligence-service"
board_update: BOARD_UPDATE_PENDING
```

## 10. Next exact action

1. Read the hosted check results on PR #546 and record them here (CI_VERIFIED is NOT_RUN until then).
2. The Inventory group is complete (`8fd4d4a9`, §4.13). Billing waits for an Identity
   command path; pricing catalog freeze/admission stays behind SCM-FILES /
   SCM-KNOWLEDGE (F-11). F-18 is fixed (`bc24e5bb`, D-28); F-19 is open.
2a. Wrap-up (2026-09-24): no new groups.
   - #561: MERGED at `9e25aa1f` (S1 PASS at `be171333`, CI green).
   - #564 (F-15/F-16/F-17): MERGED at `caabd8a7` (S1 PASS at `812b21f0`, CI green).
   - Both, with #557, were deployed by MC0 in `release-caabd8a7-ki17-overlay`
     (2026-09-24T18:09Z). S5 did not deploy.
3. PR #557 (legacy F-1/F-9/F-12 fixes + F-2 test) was MERGED at `7363c931` after
   S1 PASS @ `00dff8b3`. MC0 deployed it in `caabd8a7`. F-10 is ruled unintended; its FR id is requested from the PRD
   registry owner.
4. When SCM-CORE lands: route `/api/commerce/revenue` (S5-owned) to SCM per
   cohort, and hand Marketing's call site to its owner.
5. When SCM-CORE lands, the Branch owner's `branches` fact unblocks the POS
   catalogue in a real process (today a real process answers 503 by design).
