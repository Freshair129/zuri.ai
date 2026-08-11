# P1 Commerce — Parity Inventory (Zuri V1 → V2)

Read-only scan of `G:\zuri`. Scope: `pos`, `orders`, `products`, `inventory`,
`invoices`, `procurement`, plus commerce-adjacent areas found while scanning:
`quotes`, `payments`, `delivery` (nested under `pos`), and `catalog` (empty —
see note below).

No writes were made to `G:\zuri`.

---

## 1. Sub-area tables

### POS (cashier, tables, delivery dispatch, mobile ordering)

| Sub-area | API routes | Dashboard pages | Prisma models owned | Background workers touched | Evidence of real use | Verdict | Cutover risk | Why |
|---|---|---|---|---|---|---|---|---|
| POS core (orders, cashier) | `api/orders/route.js`, `api/orders/[id]/route.js`, `api/orders/[id]/pay/route.js`, `api/orders/[id]/void/route.js`, `api/pos/orders/route.js`, `api/pos/anonymous-session/route.js` (6) | `pos/page.jsx`, `pos/cashier/page.jsx`, `pos/monitor/page.jsx` | `Order`, `OrderItem`, `Transaction` | none directly; `stockDeduction` service runs inline in the same DB transaction (not a worker) | Wired into nav (`src/config/modules.js` → POS module); Playwright smoke test `tests/e2e/smoke/pos.spec.js`; integration test `src/tests/integration/modules/pos-cashier-page.test.jsx`; `orderRepo.test.js` (repo-level unit tests); ADR-057, ADR-079, ADR-081 document active redesign work (2026-04-19) | **must-have** | H | Core money-moving flow; VAT calc, V-Points loyalty, and FEFO stock deduction all hang off `Order` |
| POS tables / floor plan | `api/pos/tables/route.js`, `api/pos/tables/merge/route.js` (+ a stray `route.js.generated.js` artifact next to it), `api/pos/zones/route.js` | `pos/tables/page.jsx` | `PosTable`, `PosZone` | none | Floor-plan state explicitly required to live in DB, not client state (ADR-058, per `pos/CLAUDE.md`); table page links into `/pos/cashier` | **must-have** | M | DINE_IN order flow depends on table selection; low volume of routes but blocks the primary POS UX |
| POS delivery (rider dispatch) | `api/pos/delivery/**` — drivers, driver status, estimate, orders, orders/[id]/assign, orders/[id]/status, orders/[id]/track, zones (10 routes) | `pos/delivery/page.jsx`, `pos/delivery/drivers/page.jsx`, `pos/delivery/zones/page.jsx` | `DeliveryZone`, `DeliveryDriver`, `DeliveryOrder` | none found | Wired into POS nav ("Delivery" sub-item); `deliveryRepo.js` (154 lines) has real CRUD, no tests found (`deliveryRepo.test.js` does not exist) | **later** | M | Functionally complete but no test coverage found; ADR-081 (2026-04-19) shows the fulfillment model (DINE_IN/TAKEAWAY/DELIVERY_INSTANT/DELIVERY_POSTAL/DELIVERY_COLD) is still being reshaped — lifting mid-redesign is risky |
| POS mobile ordering | `api/pos/mobile/availability`, `api/pos/mobile/menu`, `api/pos/mobile/sync` | `pos/mobile/page.jsx` | reuses `Order`/`Product` | none | Extensively documented in `pos/CLAUDE.md` (cart-layout persistence, `CartReopenFab`, etc.); ADR-057, ADR-079 are dedicated ADRs for this surface | **later** | M | Actively evolving UI layer on top of the same Order model as core POS — safe to defer until core POS is stable in V2 |
| POS products page | `pos/products/page.jsx` (no dedicated API — shares `api/products`) | `pos/products/page.jsx` | shares `Product` | none | Not listed in `src/config/modules.js` sidebar sub-features for POS; reachable only via `kitchen/menu/page.jsx` link — "cannot tell from code" whether it's a primary or secondary entry point | **later** | L | Thin page over shared Product model; low risk either way |
| POS schedules | `api/pos/schedules/route.js` | none found | reuses `CourseSchedule` | none | Single route, no page found under `pos/` referencing it directly — "cannot tell from code" what consumes it | **later** | L | Small, unclear consumer — verify before lifting |

### Orders (see POS core above — `orders` and `pos/orders` share the same models/repo)

Orders is not a separate module in the code; `api/orders/*` and `api/pos/orders`
both write to `Order`/`OrderItem` via `orderRepo.js` and are covered in the POS
core row above. Kept as one row to avoid double-classifying the same models.

### Products / Catalog

| Sub-area | API routes | Dashboard pages | Prisma models owned | Background workers touched | Evidence of real use | Verdict | Cutover risk | Why |
|---|---|---|---|---|---|---|---|---|
| Products | `api/products/route.js`, `api/products/[id]/route.js`, `api/products/[id]/recipes/route.js` (3) | `pos/products/page.jsx` (POS-side); also read by `kitchen/menu/page.jsx` | `Product`, `ProductRecipe` | none | `productRepo.test.js` exists; `Product` is referenced from `Order.OrderItem`, `Enrollment`, `CourseSchedule` — actively used across modules | **must-have** | H | `Product` is a hub model: POS, Kitchen (recipes/stock deduction), and Courses (enrollments/schedules) all key off it |
| Catalog | none — `api/catalog` directory exists but is **empty** | none | — | — | The `pos.yaml` module manifest (aspirational, `status: scaffold`) claims `GET /api/catalog — product catalog for POS item picker`, but no route file exists under `api/catalog`. This is a manifest/reality mismatch, not a real endpoint. | **drop** (nothing to lift) | L | Documented but never implemented; confirm with owner before assuming any catalog-specific work is needed |

### Inventory

| Sub-area | API routes | Dashboard pages | Prisma models owned | Background workers touched | Evidence of real use | Verdict | Cutover risk | Why |
|---|---|---|---|---|---|---|---|---|
| Inventory (warehouse stock, movements, stock counts) | `api/inventory/lots/route.js`, `api/inventory/movements/route.js`, `api/inventory/stock/route.js` (3) | `kitchen/stock/page.jsx` (via the Kitchen module, not a standalone `/inventory` page) | `Warehouse`, `WarehouseStock`, `StockMovement`, `StockCount`, `StockCountItem`, `IngredientLot` (FEFO) | none directly; deduction runs inline via `src/lib/services/stockDeduction.js`, called from `api/orders/route.js` and `api/pos/orders/route.js` in the same DB transaction as order creation/payment | `inventoryRepo.test.js`, `stockDeduction.test.js` (extensive — idempotency, insufficient-stock, FEFO ordering), `ingredientRepo.test.js`; wired into nav under Kitchen ("สต๊อก") | **must-have** | H | Stock levels are money-adjacent (shrinkage, COGS) and FEFO deduction is transactionally coupled to every paid order — see §3 |
| Ingredient lots (`inventory/lots`) | `api/inventory/lots/route.js` | `kitchen/ingredients/page.jsx`, `kitchen/stock/page.jsx` | `IngredientLot`, `Ingredient` | none | Same as above | **must-have** | H | This route is on the ESLint "direct-Prisma" debt list (see §4) — a real lift blocker, not just a risk label |

### Invoices

| Sub-area | API routes | Dashboard pages | Prisma models owned | Background workers touched | Evidence of real use | Verdict | Cutover risk | Why |
|---|---|---|---|---|---|---|---|---|
| Invoices | `api/invoices/route.js`, `api/invoices/[id]/route.js`, `api/invoices/[id]/pdf/route.js`, `api/invoices/[id]/send-chat/route.js`, `api/invoices/generate-pdf/route.js` (5) | `invoices/page.jsx` | `Invoice` | `api/workers/invoice-pdf/route.js` (PDF render via Puppeteer/Chromium or WeasyPrint → Supabase Storage, queued via QStash) | `invoiceRepo.test.js`; `pos/CLAUDE.md` documents the billing flow (`Cart confirmed → Invoice created → sent to Chat → paid → slip verified → Transaction recorded`) as a **hard rule**: "ใบกำกับภาษีต้องผ่าน invoiceRepo — ห้ามสร้าง PDF ตรงจาก component" (invoices must go through invoiceRepo; never generate PDF directly from a component) | **must-have** | H | Thai tax-invoice compliance (running number, tax ID, address) + LINE/FB receipt dispatch; `invoices/page.jsx` exists but is **not present in `src/config/modules.js` nav** — reachable only by direct URL, so real usage volume is unclear ("cannot tell from code" how customers reach it in practice) |

### Procurement

| Sub-area | API routes | Dashboard pages | Prisma models owned | Background workers touched | Evidence of real use | Verdict | Cutover risk | Why |
|---|---|---|---|---|---|---|---|---|
| Purchase orders (PO lifecycle + GRN) | `api/procurement/po/route.js`, `api/procurement/po/[id]/approve/route.js`, `api/procurement/po/[id]/grn/route.js` (3) | `kitchen/procurement/page.jsx` (no standalone `/procurement` page — see manifest mismatch below) | `PurchaseOrderV2`, `POItem`, `POApproval`, `POAcceptance`, `POTracking`, `GoodsReceivedNote`, `GRNItem`, `PurchaseRequest`, `PurchaseRequestItem`, `POReturn`, `POIssue` | none found directly; GRN posting runs inline (creates `StockMovement` in the same transaction as the GRN, see `poRepo.recordGRN` + `inventoryRepo.createMovement`) | `poRepo.test.js`; `docs/product/module-manifests/procurement.yaml` is marked `status: scaffold` and describes routes (`/api/procurement/purchase-orders`, `/api/procurement/purchase-requests`, `/api/procurement/goods-received`, `/api/procurement/market-prices`) and a page (`/procurement`) that **do not match the actual code** (`api/procurement/po/*`, page at `/kitchen/procurement`). Treat this manifest as aspirational, not ground truth. | **must-have** | H | GRN receiving is the only path that increases stock (money + stock side effect); `api/procurement/po/route.js` has a live `// TODO: Extract filters...` comment suggesting the list endpoint is incomplete |
| Suppliers | `api/procurement/suppliers/route.js`, `api/procurement/suppliers/[id]/route.js` (2) | part of `kitchen/procurement/page.jsx` | `Supplier` | none | `supplierRepo.test.js` | **must-have** | M | Small surface but required for PO creation (PO needs `supplierId`) |
| Market prices | referenced by `api/workers/market-price/route.js` | none found | `MarketPrice` | `api/workers/market-price/route.js` | No dedicated CRUD API route under `procurement/` found; only a worker touches `MarketPrice` — "cannot tell from code" what populates it or how it's surfaced to users | **later** | L | Small, isolated model; unclear consumer, low urgency |

### Quotes (commerce-adjacent, lives under CRM in practice)

| Sub-area | API routes | Dashboard pages | Prisma models owned | Background workers touched | Evidence of real use | Verdict | Cutover risk | Why |
|---|---|---|---|---|---|---|---|---|
| Quotes | `api/quotes/route.js` (+ `.test.js`), `api/quotes/[id]/route.js` (+ `.test.js`) | **none found** — no `quotes/page.jsx` anywhere under `(dashboard)` | `Quote` | `api/workers/quote-aging/route.js` (+ `.test.js`, `.no-signature.test.js`) | `quoteRepo.js` (396 lines — the largest repo file scanned) is heavily built out: draft/send/outcome state machine, "stale" aging, `VALID_OUTCOMES`; has route-level tests; the aging worker has two dedicated test files including a signature-less variant. But there is genuinely no dashboard page — quotes must be created/viewed via the CRM UI or API only. | **later** | M | Backend is mature and tested, but with no discoverable UI, lifting this "page" is moot — the work is deciding whether a V2 quotes UI is even needed, not migrating an existing one |

### Payments (commerce-adjacent, small)

| Sub-area | API routes | Dashboard pages | Prisma models owned | Background workers touched | Evidence of real use | Verdict | Cutover risk | Why |
|---|---|---|---|---|---|---|---|---|
| Slip verification | `api/payments/verify-slip/route.js` (1 route only) | none — invoked from POS cashier UI (`pos/CLAUDE.md`: "Slip verification: Gemini Vision → /api/payments/verify-slip", confidence threshold 0.80) | none (stateless — calls `src/lib/ai/slipVerifier.js`, no DB write in the route itself) | none | Documented as part of the core billing flow in `pos/CLAUDE.md`; no test file found for this route | **must-have** | H | Small in code size but on the critical path for TRANSFER/QR payments — calls an external AI vision service (Gemini) per transaction, and money is not recorded as paid until this (or a manual override) succeeds |
| Payment methods (config) | none — no `api/payment-methods` routes found | none | `PaymentMethod` | none | Model exists in schema but no CRUD route found under scanned areas — "cannot tell from code" where it's populated (possibly `settings/`, out of this scan's scope) | **later** | L | Out of scope area (`settings`); flag for whoever owns that scan |

---

## 2. Shared models (migration-order hazards)

Models this area owns or heavily uses that other (non-commerce) areas also write to or depend on:

- **`Product`** — written by Products/POS; read by **Courses** (`Enrollment`, `CourseSchedule` both relate to `Product`) and by **Kitchen** (`ProductRecipe` → `Recipe`). A product can be food, a course, or retail merchandise (see ADR-081 "Product Domain Tabs" — Food / Course / Retail). Cannot migrate Products in isolation from Courses.
- **`Order`** — relates to `Customer` (CRM), `Conversation` (Inbox/LINE), `Employee` (closedBy/approvedBy), `Enrollment` (Courses), `PosTable`, `DeliveryOrder`. Order also carries AI-authored-order fields (`createdBy: 'AI'`, `requiresApproval`, `approvedById`) tied to the Marketing/AI "Sales Closer" feature (ZDEV-TSK-20260410-013) — a dependency on the AI/marketing module, not just CRM.
- **`Customer`** — owned by CRM, referenced by `Order.customerId` (nullable, walk-in orders allowed) and `Invoice.customerId`. Commerce is a consumer here, not the owner.
- **`Invoice`** — relates to `Order` and dispatches through the shared `receiptDispatch` service into Inbox/LINE messaging (`src/lib/services/receiptDispatch.js`).
- **`IntegrationConfig` / `IntegrationSyncLog`** (owned by the Integrations area) — read/written by `src/lib/accounting/AccountingService.js`, which orchestrates commerce data (orders/invoices) out to FlowAccount/Express accounting platforms. Commerce is upstream of Integrations here.
- **`Warehouse` / `WarehouseStock` / `StockMovement`** — nominally "Kitchen" models per `kitchen.yaml`'s manifest, but the actual stock-deduction code path (`stockDeduction.js`) is invoked directly from the **Orders** route, not from a Kitchen-owned entry point. Whoever owns "Kitchen" vs. "Commerce" boundaries needs to agree who lifts `inventoryRepo.js` first, since both POS orders and Procurement GRN write to it.
- **`Employee`** — Auth/Employees area owns it; Orders (`closedById`, `approvedById`), Invoices, and PO approvals all reference it for RBAC and audit attribution.

## 3. Side-effect inventory

Everything found that touches money, stock, printing, or external systems:

- **Money**
  - `Order.totalAmount`/`paidAmount`, VAT calc (7%, `system_config.yaml → vat.rate`, "included" mode) computed in `orderRepo.calculateTotals`.
  - `api/orders/[id]/pay/route.js` — `processPayment` closes the order, and separately fires a Pusher realtime event (`order-paid`) and an audit-log write (both wrapped in non-fatal try/catch — a payment can succeed even if the audit or realtime notification fails).
  - V Points loyalty accrual tied to `Transaction`, explicitly documented as idempotency-sensitive (ADR-059: "ห้ามให้ point ซ้ำ — check `Transaction.id` ก่อนเสมอ").
  - AI-authored orders over ฿5,000 require `OWNER` approval (`Order.requiresApproval`) before they can be treated as legitimate — a business-rule gate, not just a UI gate.
  - `AccountingService.js` (FlowAccount / Express adapters) syncs commerce data to external accounting platforms; `api/workers/accounting-sync`, `sync-accounting`, `accounting-reconciliation` workers exist.
- **Stock**
  - `src/lib/services/stockDeduction.js::deductForOrder` — FEFO deduction, batch-loads `Product → ProductRecipe → Recipe → RecipeIngredient → IngredientLot`, runs inside the **same Prisma transaction** as order create (`api/orders/route.js`, `api/pos/orders/route.js`) and again at payment (`orderRepo.processPayment`), guarded idempotent via `Order.stockDeductedAt`. This is the load-bearing side effect for the whole POS→Kitchen link.
  - `poRepo.recordGRN` + `inventoryRepo.createMovement` — GRN receiving increases `WarehouseStock` and logs a `StockMovement`, in one transaction (`api/procurement/po/[id]/grn/route.js`).
  - `inventoryRepo.adjustStock`, `createStockCount`/`completeStockCount` — manual stock adjustments and physical counts, both write `StockMovement`.
- **Printing**
  - `api/invoices/generate-pdf/route.js` + `api/workers/invoice-pdf/route.js` — enqueues via QStash, renders with Puppeteer/Chromium or WeasyPrint, uploads to Supabase Storage.
  - `api/invoices/[id]/pdf/route.js` — direct (non-queued) PDF path also exists; two PDF code paths for the same model is worth confirming with the owner (§5).
  - Kitchen `PrepSheet` model + `api/workers/prep-sheet/route.js` — printable daily prep checklist, generated on a QStash cron (~18:00–20:00 ICT per two slightly conflicting docs — `kitchen/CLAUDE.md` says 18:00, `kitchen.yaml` manifest says 20:00).
- **External systems**
  - `api/payments/verify-slip/route.js` → Gemini Vision (`src/lib/ai/slipVerifier.js`) — Thai bank-slip OCR, confidence threshold 0.80, on the critical path for TRANSFER/QR payments.
  - `api/invoices/[id]/send-chat/route.js` → `dispatchReceipt` → LINE/Facebook messaging (external channel).
  - `AccountingService.js` → FlowAccount / Express (external accounting SaaS) — `getActiveConfig`, `logSyncRun` write to `IntegrationConfig`/`IntegrationSyncLog`.
  - QStash (external job queue) is the trigger for invoice-pdf, prep-sheet, and (per `kitchen.yaml`, unverified) stock-deduct workers.

## 4. Lift blockers

- **Direct-Prisma routes bypass the repo layer.** Per `src/lib/repositories/CLAUDE.md`, 73 routes still `import { getPrisma } from '@/lib/db'` directly instead of going through a repository, and this list is frozen (can shrink, must never grow) in `.eslint-baseline-prisma-routes.json`. Commerce routes on that list (verified against the actual file, 73 total repo-wide):
  - `src/app/api/inventory/lots/route.js`
  - `src/app/api/invoices/generate-pdf/route.js`
  - `src/app/api/orders/route.js`
  - `src/app/api/pos/anonymous-session/route.js`
  - `src/app/api/pos/delivery/orders/[id]/track/route.js`
  - `src/app/api/pos/mobile/availability/route.js`
  - `src/app/api/pos/orders/route.js`
  - `src/app/api/pos/schedules/route.js`
  - `src/app/api/procurement/po/[id]/grn/route.js`
  - `src/app/api/workers/invoice-pdf/route.js`
  
  These have query logic embedded directly in the route handler (confirmed by reading `api/inventory/lots/route.js`), so lifting the page/route pair alone will not carry the same behavior unless the query logic is read too — the "endpoint contract" is bigger than the route file for these ten.
- **Tenant-isolation guard has real gaps.** Multi-tenant scoping is enforced two ways: (1) every repo query must hand-write `where: { tenantId }` and (2) a Prisma `$extends` guard reads `tenantId` from AsyncLocalStorage, but only routes wrapped in `withAuth` populate that context (137/198 routes repo-wide as of 2026-08-04). Workers and webhooks (which include `invoice-pdf`, `quote-aging`, `market-price`, `prep-sheet`, `sync-accounting`, etc.) are explicitly called out as NOT covered by the guard. If any commerce worker is lifted to V2 with a different auth wrapper, the safety net silently does not apply — the code must be re-audited, not assumed safe by pattern-matching on `withAuth`.
- **Generated/stray file next to a real route.** `src/app/api/pos/tables/merge/route.js.generated.js` sits alongside `route.js` — unclear if it's dead scaffolding or an active artifact; would need clarification before lifting `pos/tables/merge`.
- **`invoices/page.jsx` is not reachable from the sidebar** (`src/config/modules.js` has no `invoices` entry) — if V2 serves this page from a different backend but users only ever reach it by guessing the URL today, real usage may be near zero; verify before treating it as must-have UI (it stays must-have as an *endpoint*, per §3, but the *page* may not need lifting as-is).
- **Manifest/code mismatches.** `docs/product/module-manifests/pos.yaml`, `kitchen.yaml`, and `procurement.yaml` are all marked `status: scaffold` and describe models (`CartItem`, `CreditNote`, `Advance`, `InventoryItem`, `StockDeductionLog`), routes (`/api/catalog`, `/api/transactions`, `/api/procurement/purchase-orders`), and pages (`/procurement`) that do not exist in the current schema/routes. Do not use these manifests as a lift checklist without cross-checking against actual code — they read as design-time aspirational documents, not as-built records.
- **Two invoice-PDF code paths.** `api/invoices/[id]/pdf/route.js` (synchronous) and `api/invoices/generate-pdf/route.js` + `api/workers/invoice-pdf/route.js` (queued via QStash) both produce an invoice PDF. Unclear from code alone which is canonical/current — see open questions.
- **No seed/demo data mechanism found in V1.** No `prisma/seed*` file and no `db:seed` script exist in `G:\zuri\package.json`. "Evidence of real use" above therefore relies entirely on tests, nav wiring, and ADRs — there is no fixture data to visually compare V1 vs V2 screens against during cutover.

## 5. Open questions for the owner

1. **Quotes UI** — `quoteRepo.js` and its API/worker are mature and tested, but no dashboard page exists anywhere in the repo. Is a quotes UI in scope for V2, or is `Quote` meant to be created/consumed purely via API/LINE flows going forward? (Changes the verdict from "later" to either "must-have" or "drop".)
2. **Invoice PDF: which path is canonical?** — `api/invoices/[id]/pdf/route.js` (sync) vs. `api/invoices/generate-pdf/route.js` → `api/workers/invoice-pdf/route.js` (async/QStash). If both are live in production, migration needs to preserve both; if one is legacy, it should be marked `drop` rather than `must-have`.
3. **`invoices/page.jsx` navigation** — confirmed absent from `src/config/modules.js`. Is it reached via a link from elsewhere (e.g., an order detail view not covered by this scan) or is it effectively dead UI reachable only by direct URL? Changes whether the *page* (not the API, which stays must-have) is worth lifting as-is vs. rebuilt.
4. **Kitchen/Procurement ownership boundary** — `inventoryRepo.js`, `Warehouse`, `WarehouseStock`, `StockMovement` sit under the Kitchen manifest but are written to by both POS orders (via `stockDeduction.js`) and Procurement (via GRN). Which team/module owns lifting this shared layer first, so POS and Procurement don't both assume they control it?
5. **`api/catalog` and other manifest-only endpoints** — `pos.yaml` documents `GET /api/catalog` and `POST /api/transactions`, neither of which exist in code. Were these deprecated/renamed, or never built? Affects whether "Products/Catalog" should be scoped smaller than the manifest implies.
6. **Prep-sheet cron time discrepancy** (18:00 per `kitchen/CLAUDE.md` vs. 20:00 per `kitchen.yaml`) — low-stakes but worth a one-line confirmation so V2 doesn't inherit the wrong schedule.

---

## Writer Report — P1 Commerce
**Status**: DONE
**Output file**: docs/.rwang-tasks/parity-commerce.md
**Sub-areas covered**: POS core (orders/cashier), POS tables/floor plan, POS delivery, POS mobile ordering, POS products page, POS schedules, Products, Catalog (empty), Inventory (warehouse/movements/stock counts), Ingredient lots, Invoices, Procurement (PO/GRN), Suppliers, Market prices, Quotes, Payments (slip verification), Payment methods (config, out of primary scope)
**Verdict counts**: must-have 9 · later 7 · drop 1 · rebuild 0
**Concerns**: Three module manifests (`pos.yaml`, `kitchen.yaml`, `procurement.yaml`) are marked `status: scaffold` and describe routes/models/pages that don't match the actual code — flagged throughout so they aren't mistaken for as-built documentation. No V1 seed/demo-data mechanism exists, so "evidence of real use" leans on tests, nav wiring, and ADRs rather than runnable fixtures. Quotes has a fully-built, tested backend with no discoverable UI — needs an owner decision, not a code fix. Ten commerce routes bypass the repo layer (frozen ESLint debt list) and would need their inline Prisma queries re-read, not just their route file, before being trusted as a stable "endpoint contract" for lifting.
