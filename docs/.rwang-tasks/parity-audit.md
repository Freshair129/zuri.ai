# Parity Scan — Cross-Area Audit

Auditor pass over the six area inventories (`parity-{commerce,customer,growth,operations,platform,workers}.md`).
Every disagreement below was resolved by reading `G:\zuri` directly (read-only; no
files under `G:\zuri` were modified, no `.env` was read). Line references are to the
V1 working tree as of 2026-08-12.

## Verdict: **INCONSISTENT (30 findings)**

9 contradictions · 6 model-ownership collisions · 4 verdict conflicts ·
5 coverage-gap clusters · 6 per-tenant-cutover blockers.

The pack is *usable* — Workers, Customer, and Operations §3/§1.4 are well-evidenced and
survived spot-checking intact. But `parity-platform.md` carries three factual errors
beyond the LIFF one, one of which sizes the largest work item in the plan (W3, identity
rebuild); and a whole V1 feature domain (SaaS billing) plus the dashboard home page
(`/overview`) were claimed by nobody.

---

## 1. Contradictions resolved

| # | Claim A (area) | Claim B (area) | Which is right | Evidence |
|---|---|---|---|---|
| C1 | **Platform §0**: "`Employee.email` is `@unique` **globally** (`prisma/schema.prisma:56`) … One email can be an active employee of exactly one tenant system-wide today. This is the exact constraint the Person+Membership rebuild must lift." | **Operations §3**: "`@@unique([email, tenantId])` — the same email can exist as a *different* Employee row per tenant, with no link between them." | **Operations.** Platform is wrong, and cited a line that isn't an Employee field. | `schema.prisma:271` — `email String` (no `@unique`); `schema.prisma:312` — `@@unique([email, tenantId])`. Line 56 is a `Tenant` back-relation. **The real defect is worse:** `auth-config.js:61` calls `findByEmail(credentials?.email)` with no tenantId, and `employeeRepo.js:18` falls back to `prisma.employee.findFirst({ where: { email } })` with no `orderBy`. A person employed at two tenants can only ever log in as whichever row Postgres returns first — non-deterministically. That, not a DB constraint, is what `Person`+`Membership` has to fix. |
| C2 | **Growth §3.1**: campaign broadcast "Idempotency: Redis `SET NX` lock on `campaign:{id}:sending`." | **Workers §1/§3.2**: "The Redis key … only gates 'was this cancelled', it is not a mutual-exclusion lock on the worker itself." | **Workers' conclusion. Both descriptions are inaccurate.** | The `SET NX` is real but on a *different route*: `marketing/campaigns/[id]/send/route.js:36-38` (`redis.set(lockKey,'1',{nx:true,ex:3600})`) — it prevents a second human dispatch, once per campaign. The worker only reads: `workers/campaign-broadcast/route.js:34` `redis.exists(...)`, `:105` `redis.del(...)`. There is no atomic claim on `PENDING` rows, so Workers' operational finding (concurrent batches double-send) stands. |
| C3 | **Operations §1.1**: FEFO stock deduction "is triggered by `industry/culinary/kitchen/handlers/onClassStarted.js`, a hook". | **Commerce §3**: `stockDeduction.js::deductForOrder` runs inline in the order/payment transaction. | **Commerce.** | `src/modules/industry/culinary/kitchen/handlers/onClassStarted.js` is a **4-line TODO stub with an empty body**. Real call sites: `api/orders/route.js:76`, `api/pos/orders/route.js:67`, `orderRepo.js:352`. **Consequence:** Operations materially understates Kitchen's coupling — `IngredientLot`/`WarehouseStock` are written on every POS order and every payment, so kitchen inventory cannot be cut over independently of POS. This is the root of collision #1 below. |
| C4 | **Workers §1/§3.8/§5**: "`dailyBriefRepo.upsert` keys `DailyBrief` **only on `briefDate`, with no `tenantId`** … Two tenants processing the same calendar date will overwrite each other's brief." | (no other area disputes it) | **Half right — the schema is fine, and the consequence is wrong.** | `schema.prisma:1715` — `@@unique([tenantId, briefDate])`; `tenantId` is a real column. The bug is confined to `dailyBriefRepo.js:34-41` (`where: { briefDate }`). `briefDate` alone is **not a valid `WhereUniqueInput`**, so Prisma rejects the call rather than silently overwriting — i.e. `daily-brief/process/route.js:34` and `:204` most likely **throw**. Either the daily-brief pipeline is dead in production, or the deployed schema differs from the repo (Operations §5's migration-lineage warning makes that plausible). Cannot be settled from code; see §7 item 7. |
| C5 | **Commerce §4**: "No seed/demo data mechanism found in V1. No `prisma/seed*` file and no `db:seed` script exist." | — | **Incomplete.** | `src/app/api/dev/seed/route.js` exists (also `api/dev/debug-pos`). Commerce's derived conclusion — that there are no fixtures for V1↔V2 screen comparison during cutover — needs re-checking against that route. |
| C6 | **Operations open Q3**: "no `(dashboard)/team/**` page directory was found … Is the invite UI embedded inside `/employees` or `/settings`?" | **Platform**: cites `join/page.jsx` (the public *join* page, not the invite UI). | **Neither found it. Answered here.** | `src/app/(dashboard)/settings/mobile/team/page.jsx` — calls `GET /api/team/invite`, posts invites, gated by `can(roles,'team','A')`. Both scans missed it because neither enumerated `settings/mobile/*` (8 pages). Operations open question 3 is **closed**. |
| C7 | **Platform §4**: "no `Plan` model, no feature-flag table found anywhere in **the 72 models** scanned"; "**no `ApiKey` model** in the 72-model list. If V1 SMBs can issue their own API keys, I found no evidence of it." | — | **Both claims false; the model count is wrong.** | `grep -c "^model " prisma/schema.prisma` → **94** (the implementation plan §1.1 already says 94). `schema.prisma:201 model TenantApiKey` exists, with `src/lib/repositories/apiKeyRepo.js`, `src/lib/apiKeyAuth.js`, and three consuming routes. `schema.prisma:122 Subscription`, `:148 BillingEvent`, `:240 PaymentMethod` are a full FC-11b SaaS-billing domain. See §4. |
| C8 | **Customer §5.2**: `sync-messages` stub is "a gap to carry forward or resolve, not silently drop." | **Workers**: verdict "drop (or implement if still needed)." | **No real conflict — recorded so synthesis doesn't log a phantom one.** | Both read the same stub. Correct resolution: drop the *route*, carry the *gap* as an explicit requirement. |
| C9 | **Workers**: `cert-nightly`, `check-completion`, `prep-sheet`, `market-price` → "later (**niche** to culinary-school vertical)". | **Operations §1.8/§4**: certificates/attendance are must-have; V1's actual customer *is* a culinary school. | **Operations.** | `src/modules/industry/culinary/index.js` — `displayName: 'Culinary School'`, "V School and culinary schools". The culinary vertical is not a niche of V1; it is the pilot tenant. Workers' "niche" label would demote four workers that Operations shows are load-bearing for the certificate ladder. |

---

## 2. Model ownership collisions

Models claimed as *owned* by two or more areas. A model with two owners cannot be
migrated by either alone — these set migration order.

| # | Models | Claimed by | Resolution needed |
|---|---|---|---|
| 1 | `Ingredient`, `IngredientLot`, `Warehouse`, `WarehouseStock`, `StockMovement`, `StockCount`, `StockCountItem` | Commerce §1 (Inventory, must-have **H**) **and** Operations §1.1/§1.3 (must-have **M**) | **Commerce owns.** C3 proves the write path is POS orders, not a kitchen hook. Commerce §2 already flagged this ("whoever owns Kitchen vs Commerce needs to agree who lifts `inventoryRepo.js` first"). Two different risk ratings on the same models must be reconciled to **H**. |
| 2 | `Supplier`, `PurchaseRequest`, `PurchaseRequestItem`, `PurchaseOrderV2`, `POItem`, `POApproval`, `POAcceptance`, `POTracking`, `GoodsReceivedNote`, `GRNItem`, `POReturn`, `POIssue` (12 models) | Commerce §1 (Procurement, must-have **H**) **and** Operations §1.3 (must-have **M**) | Operations' own text argues it is "generic procurement, shared beyond kitchen … should be lifted once for all consumers". Agreed — but then it is not Operations-owned. Assign to Commerce, with Operations as consumer. |
| 3 | `ConversationAnalysis`, `CustomerInsight`, `TenantCRMPattern` | Customer §1.1/§1.3 (owns) · Growth §1c (daily-brief batch writes it) · Workers (`auto-tag`, `crm-enrich`, `crm-pattern` write it) | **Three writers across three areas, one model each.** Customer owns the schema; the write paths live in Workers' jobs and Growth's batch. None of the three can migrate this triad alone. |
| 4 | `Employee` (+ 12 back-relations, `schema.prisma:297-310`), `InvitationToken` | Operations §1.9/§1.10 (**must-have**) **and** Platform auth/team rows (**rebuild**) | Verdict conflict — see §3. |
| 5 | `Conversation`, `Message`, `ConversationLog`, `AgentStyle` | Customer §1.3 (owns) · Platform webhooks row (webhooks write them) · Growth §1c (Agent Mode writes `Message` + `ConversationLog`, toggles `Conversation.agentMode`) | Customer owns the model; the two highest-risk *writers* (LINE webhooks, Agent Mode) sit in other areas' scopes. |
| 6 | `IntegrationConfig`, `IntegrationSyncLog`, `IntegrationDocumentRef` | Platform §integrations (owns) · Commerce §2 (`AccountingService` writes) · Workers (3 accounting workers write) · **`webhook-processor` reads `IntegrationConfig` as its tenant router** | Platform owns it, but the model is doing double duty as a message-routing table (§5 blocker B). Any change to `IntegrationConfig` semantics breaks Instagram/WhatsApp inbound. |

Lower-severity overlaps also present and worth a single-owner line each: `Product` /
`ProductRecipe` (Commerce ↔ Operations), `CourseSchedule` (Commerce POS schedules ↔
Operations), `Certificate` (Operations ↔ two Workers jobs), `Quote` (Commerce ↔
`quote-aging`), `Order` (Commerce ↔ Growth's Sales Closer), `Notification` (Customer ↔
Growth's `actionExecutor`).

---

## 3. Verdict conflicts (especially wrong "drop"s)

**Every `drop` in the pack was checked.**

| Drop | Area | Verified? | Finding |
|---|---|---|---|
| `api/catalog` | Commerce | ✅ **Correct** | Directory exists and is empty. Manifest-only endpoint. |
| Loyalty (`Customer.walletBalance` / `walletPoints`) | Customer | ✅ **Correct — and Commerce is the one asserting without evidence** | Repo-wide grep: the only non-doc references are `exportRepo.js:25,76` (CSV export columns) and `components/pos/mobile/ReceiptModal.jsx:159` (display arithmetic). **No writer exists anywhere.** Commerce §3 asserts "V Points loyalty accrual tied to `Transaction`, explicitly documented as idempotency-sensitive (ADR-059)" — but `orderRepo.js:318` creates `Transaction` rows and touches **no wallet field**, and there is **no `transactionRepo.js`** in `src/lib/repositories/` despite `pos/CLAUDE.md:63` citing `transactionRepo.record(...)` (in a commented-out line). Commerce read a Thai ADR statement as if it described running code. **Caveat that must ship with the drop:** `crm/[id]/page.jsx:440` renders `customer?.vPoints` — a field that does not exist on `Customer` — so the CRM 360 page shows `0 VP` unconditionally today. Drop the two readers and the export column with it; do not leave them behind. |
| `food-erp` (FEAT22) | Operations | ✅ **Correct**, best-evidenced drop in the pack | `describe.skip`, zero importers, `$queryRaw` against tables absent from the schema. |
| `liff` | Platform | ❌ **Wrong — already corrected by controller.** See §7 for residual contamination. | |
| `sync-messages` | Workers | ✅ **Correct as a route**; the gap survives (C8). | |
| `extract-styles` ("drop-or-fix-first") | Workers | ✅ **Confirmed unsafe** | `workers/extract-styles/route.js:23-31` checks only that the `upstash-signature` header is *present*, then falls to a session check only when absent. Any caller setting that header skips auth entirely, and the body defaults to **all tenants**. This is a V1 security bug independent of migration. |

**No drop in this pack would break another area's dependency.** The one that looked
dangerous (loyalty, contradicted by Commerce) is safe: Commerce's contradicting claim
is documentation, not code.

**Four verdict conflicts do need resolving:**

1. **`Employee` — Operations "must-have" vs Platform "rebuild".** Both are right about
   different layers, and the plan must say so explicitly. ADR-003 **D10** rebuilds the
   *identity model*; ADR-003 **D4** requires the `Employee` **rows** and their 12
   back-relations to be migrated with UUIDs preserved. "Rebuild" as written reads as
   "do not migrate", which would orphan `Order.closedById`/`approvedById`,
   `CourseSchedule.instructorId`, `AuditLog.actorId`, `Quote.createdById` and eight
   more. **Restate as: rebuild the auth path, migrate the records.**
2. **Quotes — Commerce "later" vs Workers `quote-aging` "must-have".** A deferred module
   with a live worker violates D8. `quote-aging` dispatches `EVENT_QUOTE_STALE` /
   `EVENT_QUOTE_AGED` into the automation engine, which can send LINE/FB to a real
   customer (Growth §3.6). If quotes are deferred, `quote-aging` must be **disabled per
   tenant at cutover**, not deferred alongside it.
3. **Certificate/prep-sheet/market-price workers — Workers "later (niche)" vs Operations
   "must-have".** Operations wins (C9).
4. **Daily brief — Growth "must-have, every tenant gets one" vs Workers "H double-send
   risk".** Both may be moot: see C4. Do not size either until the live-DB question is
   answered.

---

## 4. Coverage gaps — what no scan covered

I enumerated `G:\zuri` myself: **209 API route files, 85 pages (68 under `(dashboard)`),
94 Prisma models** — matching `IMPLEMENTATION-PLAN-V2-REPLACE.md` §1.1 exactly. Diffed
against the union of all six reports.

### Gap 1 — SaaS billing / subscriptions: **zero coverage across all six scans**
Models `Subscription` (`:122`), `BillingEvent` (`:148`), `PaymentMethod` (`:240`).
Routes `api/settings/billing`, `api/webhooks/billing`. Pages
`(dashboard)/settings/mobile/billing`. `api/webhooks/billing` verifies a Stripe-style
HMAC (or raw hex for Omise) and **writes `Tenant.plan`** — a fifth external callback
class nobody listed, and a cutover flip item (§5 blocker E).
Note: Commerce mis-scoped `PaymentMethod` as a POS payment-method config ("possibly
`settings/`, out of this scan's scope"). It is not — `schema.prisma:240-258` sits in the
FC-11b billing block with `provider`, `providerPaymentMethodId`, `last4`, `expMonth` —
it is the tenant's stored card for *their Zuri subscription*.

### Gap 2 — Machine-auth / external data contract: **zero coverage**
`TenantApiKey` (`:201`), `ImportSnapshot` (`:224`), `src/lib/apiKeyAuth.js`
(`withApiKey`), `src/lib/repositories/apiKeyRepo.js`, consumed by
`api/export/events`, `api/export/events/counts`, `api/import/snapshots`.
This is a **third authentication mechanism** (session · QStash signature · tenant API
key) and a live external integration contract. Platform explicitly denied it exists
(C7). An outside system holds long-lived credentials pointed at V1's hostname today.

### Gap 3 — Tasks: **zero coverage**
`Task` model (`:1615`), `api/tasks`, `api/tasks/[id]`, `(dashboard)/tasks` (a four-column
Kanban with SINGLE/RANGE/PROJECT types), and it is **written by
`daily-brief/process` via `assignCTATasks`** — so it is coupled to a worker three
different areas discussed.

### Gap 4 — `(dashboard)/overview` and `/overview/actions`: **the dashboard home page**
`OverviewPageClient.jsx`, `overviewActions.js` (+ tests), `SmartGiftMetricsSection.jsx`.
ADR-003 **D2** names exactly one lift exception — "any overview/report whose mental model
is 'one shop'". This is that page, and no scan inventoried it. Also uncovered:
`(dashboard)/sales-kpi`, `(dashboard)/audit` (+ `api/audit`, `api/audit/export`),
`(dashboard)/uat`, `(dashboard)/help{,/contact,/faq}`, `(dashboard)/marketing/settings`,
`(auth)/forgot-password`, `(public)/privacy`, `(public)/track/[token]` (Commerce claimed
the tracking *API* but not the public page), `(public)/join/[tenantSlug]` (a **second**
join page distinct from `/join`), `m` (mobile shell), and the root `page.jsx`.
**The entire `(dashboard)/settings/mobile/*` tree** (8 pages: billing, danger, general,
integrations, notifications, team, workspace, index) is unclaimed — it contains the
team-invite UI Operations couldn't find (C6).

### Gap 5 — Unclaimed API routes by area
- **Auth (Platform listed 1 of 4):** `auth/change-password`, `auth/mobile-login`,
  `auth/mobile-logout`. **`mobile-login` is a second, independent auth path** — it signs
  its own 30-day JWT with `jose` from `NEXTAUTH_SECRET`, bypassing NextAuth entirely, and
  unlike NextAuth it accepts an optional `tenantId` and passes it to `findByEmail` (so
  mobile *can* disambiguate multi-tenant employees; web cannot — see C1). Its own comment
  claims per-token revocation "exactly like web sessions" via `validateSession` — which
  Platform §0 shows is bypassed. **Mobile tokens are therefore 30-day and unrevocable.**
- **Integrations (Platform listed 7 of 16):** `integrations/express/{connect,test}`,
  `integrations/peak/connect`, `integrations/sage/{connect,callback}`,
  `integrations/accounting/{reconciliation,retry,sync-status,tax-mapping}`. Platform's
  "only FlowAccount OAuth is actually wired up" is wrong — Express, Peak and Sage all
  have connect routes.
- **Settings (Platform listed 2 of 7):** `settings/billing`, `settings/export`,
  `settings/notifications`, `settings/profile`, `settings/workspace`. `settings/workspace`
  sets `Tenant.deletedAt` (owner-initiated soft-delete + force logout) — a **second**
  tenant-lifecycle flag distinct from `isActive`, which matters for §5 blocker D.
- **AI (Growth listed 9; five more exist):** `ai/ask`, `ai/assistant`, `ai/chat`,
  `ai/compose-reply`, `ai/crm-followup-draft`. Growth §2 is headed "**Every** AI call site
  found in scope" — it is not exhaustive, and §2 is the section the plan leans on for the
  "AI never writes directly" rule.
- **Unowned surfaces:** `api/mcp` — an **MCP server exposing structured CRM tools to AI
  agents** (`withAuth`-wrapped, `list_customers`/`get_customer`/…). A machine-callable
  surface with no owner in the inventory. Also `api/metrics/snapshot`,
  `api/analytics/sales-kpi`, `api/daily-brief/[date]`, `api/push/subscribe`
  (`WebPushSubscription` model), `api/pusher/auth` (**the auth endpoint for the very
  Pusher channels Customer §5.4 says must be preserved by name**), `api/uat/feedback`,
  `api/dev/{seed,debug-pos}`.

### Gap 6 — Unclaimed models (10)
`Subscription`, `BillingEvent`, `TenantApiKey`, `ImportSnapshot`, `PosReceiptConfig`,
`Task`, `DailySalesReport`, `WebPushSubscription`, `ApprovalWorkflow`, `MigrationLog`.

### Correction to the LIFF correction
Platform §0's controller correction lists five pages across two path shapes. The actual
tree is **four pages under one path**:
`src/app/(liff)/liff/[tenantSlug]/{page,consent,courses,orders}` plus `(liff)/layout.jsx`.
There is **no** `src/app/(liff)/[tenantSlug]/...` directory. The six API routes are
correct as listed.

---

## 5. Is per-tenant cutover achievable?

**Not today.** Workers §4 is right that seven loop-all-tenant workers block a per-tenant
split — but workers are the *smaller* half of the problem, and the report that named it
could not see the other half. Six blockers, in the order they must be cleared:

**A. The LINE surface is not per-tenant at all — and this is the hardest one.**
D8 requires a tenant's LINE OA to belong to exactly one system. Verified against code:
`webhooks/line` resolves per-tenant by `destination` → `lineOaId` (correct).
`webhooks/line-bot` scopes *inbound data* per tenant but replies with **one global**
`LINE_BOT_CHANNEL_ACCESS_TOKEN` (`line-bot/route.js:51`, comment: "Use central for now").
`webhooks/line-monitor` (`route.js:47`) **hardcodes `DEFAULT_TENANT_ID` for every event**,
with global secret and token. There is no per-tenant flip for the latter two: moving
tenant X off V1 either leaves X's line-bot/line-monitor traffic being processed by V1
(violating D8) or breaks those integrations for every tenant still on V1. Platform's
"rebuild — consolidate 3 LINE endpoints into 1" is not a parallel workstream; it is a
**prerequisite to the first cutover**.

**B. `webhook-processor` has no tenant binding.** Verified:
`prisma.integrationConfig.findFirst({ where: { provider: platform, isActive: true } })`
with no `orderBy` and nothing from the payload. Instagram/WhatsApp inbound is already
misattributed with >1 tenant; after an ownership split it will route a V2-owned tenant's
messages into V1 or vice versa depending on row order. Workers §5 is right that this
must be fixed before either system can be trusted with it.

**C. The seven loop-all-tenant workers.** Verified — Workers §4's list is accurate
(`audit-cleanup`, `automation-engine` cron mode, `cert-nightly`, `extract-styles`,
`quote-aging`, `sync-accounting`, `sync-hourly`). Each needs an ownership predicate. This
is the cheapest blocker to fix — **but only if there is a single source of truth for
"who owns this tenant right now."** `FF_TENANT_ON_V2` (plan §8) is meant to be that, and
does not exist yet.

**D. `Tenant.isActive` cannot be the ownership switch.** Platform §3 step 2 proposes
flipping `isActive` in the old system at the moment the webhook URL is repointed, because
`getTenantByLineOaId` filters on it (`tenantRepo.js:101`). That is unsafe: `isActive: true`
is *also* how `audit-cleanup`, `cert-nightly`, `extract-styles` and `quote-aging` build
their tenant loops, and how `sync-accounting` approximates one via
`IntegrationConfig.isActive`. Flipping it to hand a tenant to V2 would also silently stop
V1's audit-retention purge and certificate issuance for that tenant. A **third** flag
already exists for a different purpose (`Tenant.deletedAt`, set by `settings/workspace`).
A dedicated ownership column is required; `isActive` must not be overloaded again.

**E. D8's flip list is incomplete — it names three things, and there are six.**
ADR-003 D8 says "LINE OA, background workers and data writes." On this evidence a cutover
must also atomically flip:
- **the billing PSP webhook** (`api/webhooks/billing` → writes `Tenant.plan`) — Gap 1;
- **issued `TenantApiKey`s** — an external system authenticating into
  `export/events` / `import/snapshots` at V1's hostname — Gap 2;
- **`auth/mobile-login`'s 30-day JWTs**, which keep authenticating against V1 for up to
  30 days after a tenant moves, because `validateSession` is bypassed (Platform §0) so
  logout and revocation are inert — Gap 5.

**F. The schedule inventory does not exist, and cannot be produced from `G:\zuri`.**
Workers §2 is correct and this is the gating unknown: only two schedules are in the repo
(`vercel.json` → `health-check`; `Provisioner.setupTenantCrons` → `daily-brief/process`
per tenant). **12 of 25 workers have no visible schedule anywhere.** Whether each is
"one global schedule with an internal tenant loop" (needs code changes before any tenant
moves) or "N per-tenant schedules" (cut over one QStash schedule at a time, no code
change) changes the cutover plan and the size of W8 (13 pts) and W10 (10 × N).
Growth independently flags the same hole for `automation-engine`'s hourly cron and is
right to; Workers' trigger column reads that cadence as fact (see §6).

**Plain statement of what must change first:**

> Per-tenant cutover is achievable, but only after: (1) V2's LINE receiver replaces
> **all three** V1 webhook endpoints, not just `/api/webhooks/line`; (2) platform webhook
> inbound resolves tenant from the payload rather than from `IntegrationConfig.findFirst`;
> (3) a dedicated tenant-ownership flag exists that is neither `isActive` nor `deletedAt`;
> (4) the seven loop-all-tenant workers honor it; (5) the QStash schedule export is
> obtained; and (6) the PSP webhook, `TenantApiKey` and mobile-JWT flip paths are designed.

Blockers 1 and 2 are changes to **V1**, which the hard rule forbids. They must therefore
be absorbed by V2 owning those receivers from the first cutover — which imposes a
constraint no report states:

> **The first tenant cut over must be one that uses none of `line-bot`, `line-monitor`,
> Instagram or WhatsApp.** Otherwise the very first flip either double-processes or
> breaks a shared global integration for every remaining V1 tenant.

---

## 6. Confidence: evidenced vs asserted

**Strongly evidenced** (file+line, quoted code; every claim I spot-checked held):
- **`parity-workers.md`** — the best-evidenced of the six. `webhook-processor`'s
  `findFirst`, `extract-styles`' header-presence check, the campaign Redis key, the
  loop-all-tenants list, `sync-hourly`'s Redis inflight lock: all verified exactly as
  written.
- **`parity-customer.md`** — PII inventory with schema line numbers, `canMarketTo` quoted
  in full and verified, the 60s erase-transaction timeout, the `withAuth` `roles` no-op.
- **`parity-platform.md` §3 and §5** — the LINE map and the two-layer tenancy analysis are
  precise and verified. (§0 and §4 are not — below.)
- **`parity-operations.md` §1.4 and §3** — the `food-erp` drop and the `Employee` coupling
  analysis are both rigorous.

**Asserted or inferred, but written so a reader takes it as fact:**

1. **Platform §0: `Employee.email @unique` globally, `schema.prisma:56`.** False, wrong
   line, wrong conclusion — and it is the most load-bearing wrong fact in the pack,
   because it directly frames W3 (identity rebuild, 14 pts).
2. **Platform: "the 72 models scanned"** (twice). Actual 94. Two downstream
   "no such model exists" claims (`ApiKey`, `Plan`/feature-flag) are false *because of*
   the undercount — the scan never saw the last ~22 models.
3. **Platform's corrected LIFF row** over-counts pages (5 vs 4) and invents a path shape
   that does not exist. A correction should not itself be unverified.
4. **Commerce §3: "V Points loyalty accrual tied to `Transaction`."** Sourced from
   `pos/CLAUDE.md` / ADR-059 Thai text, not from code. No writer exists (§3).
5. **Commerce §4: "No seed/demo data mechanism found in V1."** `api/dev/seed` exists.
6. **Operations §1.1: deduction triggered by `onClassStarted.js`.** That file is a stub.
7. **Growth §3.1: "Idempotency: Redis `SET NX` lock."** The `SET NX` is on a different
   route than the one it is attributed to.
8. **Growth §2: "Every AI call site found in scope."** Five `ai/*` routes are missing —
   and §2 is the section the plan relies on for the AI-write-safety rule.
9. **Workers: "`DailyBrief` keyed only by `briefDate`."** The schema has the composite
   unique; only the repo is wrong, with a different and more severe consequence.
10. **Workers' "Trigger" and "Frequency (claimed)" columns.** §2 is admirably explicit
    that cadences come from comments, but the table cells read as fact (e.g.
    `automation-engine` — "QStash cron (hourly)"), directly contradicting Growth's finding
    that no schedule-creation call exists for that route anywhere in the repo. Growth's
    caveat is the honest one; a synthesis merging the two tables would silently promote
    an assumption to a fact.
11. **Every report's "Evidence of real use" column, in all six.** Uniformly built from
    test-file existence, sidebar wiring and ADR references. Commerce §4 says so outright.
    **None of the six observed production traffic, row counts, or logs.** Nothing in this
    pack distinguishes "built and shipped" from "built and used" — which is precisely
    what the implementation plan §1.1 calls "the single biggest lever on total cost."
    **No keep/drop verdict anywhere in this pack rests on usage data.**

---

## 7. What the controller must fix before synthesis

1. **Correct `parity-platform.md` §0 fact 2** (`Employee.email` is `@@unique([email, tenantId])`,
   not globally unique) and replace the framing with the real defect: `findByEmail` without
   `tenantId` falls back to an unordered `findFirst`. **Re-open the W3 sizing** — the
   identity problem is a login-resolution bug plus an N-rows-per-human merge, not a
   constraint drop.
2. **Fix the model count (72 → 94)** and retract the two claims it produced: `TenantApiKey`
   exists and is wired; `Subscription`/`BillingEvent`/`PaymentMethod` are a full billing
   domain. Add billing as an unscanned area.
3. **Propagate the LIFF correction.** Platform's Writer Report still reads
   "drop 1 (liff — nothing exists to lift)" and its verdict counts still include that drop.
   Also fix the corrected row itself: 4 pages under `(liff)/liff/[tenantSlug]/`, one path
   shape, 6 API routes.
4. **Commission a seventh scan** covering the whole coverage gap: SaaS billing +
   subscriptions, Tasks, machine-auth (`TenantApiKey` / export / import), `api/mcp`,
   `(dashboard)/overview`, `(dashboard)/settings/mobile/*` (8 pages), the four unclaimed
   `auth/*` routes, the nine unclaimed `integrations/*` routes, and the five unclaimed
   `ai/*` routes. **`/overview` is the one ADR-003 D2 explicitly singles out** and nobody
   looked at it.
5. **Assign a single owner** to each of the six collision blocks in §2 — especially the
   19-model stock+procurement block (Commerce, per C3) and the conversation-analysis triad.
6. **Restate `Employee`'s verdict** as "rebuild the auth path, migrate the records," so
   ADR-003 D4 is not violated by a literal reading of "rebuild."
7. **Settle the `DailyBrief` question against the live database** — repo bug vs. schema
   drift. It decides two verdicts (Growth's daily-brief must-have, Workers' H double-send)
   and it is a one-query answer. Operations §5's migration-lineage note means schema drift
   is a live possibility, not a hypothetical.
8. **Obtain the QStash schedule export.** Nothing about cutover order, W8 sizing, or the
   "N" in W10 can be settled without it. Highest-value single action in the exercise.
9. **Close two open questions already answered here:** Operations Q3 (invite UI is
   `(dashboard)/settings/mobile/team`); Commerce's seed-data claim (`api/dev/seed` exists).
10. **Extend ADR-003 D8's flip list** from three items to six: LINE OA, QStash schedules,
    DB writes, **the PSP billing webhook**, **issued `TenantApiKey`s**, **outstanding
    `auth/mobile-login` JWTs (30-day, currently unrevocable)**.
11. **Record the pilot-tenant constraint** in the cutover runbook: the first tenant moved
    must use none of `line-bot`, `line-monitor`, Instagram or WhatsApp.
12. **Log two V1 security findings** that are independent of migration and that the owner
    should see regardless: `extract-styles` accepts any value in the `upstash-signature`
    header as authentication; and `webhook-processor` misattributes inbound
    Instagram/WhatsApp messages across tenants today, in V1 alone.
