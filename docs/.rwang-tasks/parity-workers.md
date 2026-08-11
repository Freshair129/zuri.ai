# Parity Inventory — Workers & Background Execution (P6)

Scope: `G:\zuri\src\app\api\workers\**` (25 route files), their scheduling/enqueue call
sites, and `vercel.json`. Read-only survey — no changes made to `G:\zuri`.

All 25 workers use one mechanism: **Upstash QStash** (`@upstash/qstash` in
`package.json`; client/receiver wrapper at `src/lib/qstash.js`). There is no
BullMQ/Agenda/node-cron/Inngest in this repo. Upstash Redis (`@upstash/redis`) is
used for a few in-worker locks/caches; Pusher is used for internal realtime
notifications (staff dashboards), not customer messaging.

Every worker verifies `verifyQStashSignature()` (checks the `upstash-signature`
header against `QSTASH_CURRENT_SIGNING_KEY`/`QSTASH_NEXT_SIGNING_KEY`, both
readable under a plain or `ZURI_`-prefixed name — see `src/lib/qstash.js:23-33`)
**except `extract-styles`**, noted below.

---

## 1. Worker inventory

| Worker | Route | What it does | Trigger | Frequency (claimed) | Side effect class | Tenant scoping | Idempotent? | Verdict | Cutover risk |
|---|---|---|---|---|---|---|---|---|---|
| accounting-reconciliation | `workers/accounting-reconciliation/route.js` | Compares 7 days of PAID orders against synced `IntegrationDocumentRef`s, flags unsynced as `failed`, writes a sync log | QStash, body requires `tenantId` | "weekly" (comment only) | data-mutating | one tenant/invocation | Yes — `upsertIntegrationDocumentRef` is a status upsert; re-running just re-flags the same rows | must-have | M |
| accounting-sync | `workers/accounting-sync/route.js` | Batch daily accounting sync: FlowAccount/Peak/Sage → marks orders `synced`; Express → generates X-import file and **emails the accountant** | QStash (cron, unclear which — see §2) + on-demand via `integrations/accounting/retry` (`mode:'retry'`) | "default cron 23:00 ICT" (comment) | customer-visible (Express branch emails accountant) + data-mutating | one tenant/invocation | Partial — FlowAccount/Peak/Sage branch has **no guard at all** (plain loop, no dup check before `upsertIntegrationDocumentRef status:'synced'` — harmless since idempotent by key, but Express branch **always sends the email**, no dedupe) | rebuild | H |
| audit-cleanup | `workers/audit-cleanup/route.js` | Purges `audit_logs` older than per-tenant retention + `export_events` older than fixed 30d (CR-008) | QStash cron, no body — **loops every active tenant itself** | "daily 02:00 ICT" (comment) | data-mutating (hard delete) | **loops ALL active tenants** in one call (`prisma.tenant.findMany({isActive:true})`) | Yes — deleting rows before a cutoff twice is a no-op | must-have | L |
| auto-tag | `workers/auto-tag/route.js` | AI-tags a conversation (PDAD stage/sentiment/intent), upserts `ConversationAnalysis`, caches to Redis, fires Pusher alerts (hot-lead / negative-sentiment) to staff dashboard | QStash, enqueued by `src/lib/inbound/enqueueAutoTag.js` after each inbound message | event-driven (per message) | data-mutating (+ internal-only notification, not customer-facing) | one conversation/invocation | Yes — `upsert` keyed on `conversationId_analyzedDate` | must-have | L |
| automation-engine | `workers/automation-engine/route.js` | Two modes in one route: (1) hourly cron scan — evaluates every TIME_INACTIVE/TIME_SCHEDULED workflow **across every active tenant** and sends LINE/FB automation messages to customers; (2) event dispatch — runs EVENT_* workflows for one customer | QStash cron (hourly, per `gks/phase2_atomic/PROTO--automation-cron.md`) for mode 1; QStash event publish (from `quote-aging`, `daily-brief/process`, `automationEngine.js:168`) for mode 2 | hourly (cron mode) + real-time (event mode) | **customer-visible** (sends LINE/FB messages) | **loops ALL active tenants** in cron mode; event mode is one tenant/customer | Soft only — `runWorkflowForCustomer` sets a per-customer cooldown (default 24h) *after* it acts; code comment at `route.js:112-117` explicitly says re-running the same hour is "safe" **because of the cooldown**, not because of a lock. Two concurrent scans inside the same cooldown window can both fire before either write lands. | must-have | **H** |
| campaign-broadcast | `workers/campaign-broadcast/route.js` | Sends one batch (50) of a marketing campaign's pending LINE/FB messages, checks PDPA consent (`canMarketTo`), then re-enqueues itself for the next batch | QStash, enqueued by `marketing/campaigns/[id]/send` and by itself (self re-enqueue) | on-demand (staff clicks "send") | **customer-visible** (bulk marketing send) | one campaign/tenant per invocation | **No** — `getPendingLogs` (`src/lib/repositories/campaignBroadcastRepo.js:93`) is a plain `SELECT ... WHERE status='PENDING'`, no atomic claim (`FOR UPDATE SKIP LOCKED`), no status transition before send. `updateLogStatus` only runs *after* the send. The Redis key `campaign:{id}:sending` only gates "was this cancelled", it is not a mutual-exclusion lock on the worker itself. | must-have | **H** |
| cert-nightly | `workers/cert-nightly/route.js` | Scans IN_PROGRESS enrollments, issues/upgrades course certificates at hour milestones (30/111/201h) | QStash cron, no in-repo caller found | "0 16 * * * = 23:00 ICT" (comment) | data-mutating (issues certificate doc) | optional `tenantId` in body; **defaults to ALL tenants** when omitted | Yes — `upsert` on `enrollmentId`, level compared before overwrite | later (niche to culinary-school vertical) | L |
| check-completion | `workers/check-completion/route.js` | Hourly: finds enrollments that crossed the completion threshold, marks COMPLETED, issues certificate (overlaps cert-nightly) | QStash, fire-and-forget enqueue from `attendance/check-in/route.js` | event-driven, effectively hourly-ish via attendance check-ins | data-mutating | requires `tenantId`, one tenant/invocation | Yes — comment cites `certificateRepo.createForEnrollment` as guarded ("G7") | later | L |
| crm-enrich | `workers/crm-enrich/route.js` | AI-analyzes a customer's conversation history, upserts `CustomerInsight`, fires internal Pusher alerts (hot-lead/at-risk) | QStash, enqueued from `customers/[id]/enrich` | on-demand | data-mutating (+ internal notification) | one customer/invocation | Yes — `upsertInsight` keyed by customer | later | L |
| crm-pattern | `workers/crm-pattern/route.js` | Aggregates up to 200 recent `CustomerInsight`s per tenant, runs Gemini, writes `TenantCRMPattern` | QStash, no in-repo caller found | "daily 02:00 ICT" (comment) | data-mutating (summary cache) | one tenant/invocation via body | Yes — single `updateTenantPatterns` write, not incremental | later | L |
| customer-import | `workers/customer-import/route.js` | Bulk customer import (CSV/Excel upload → rows), per-row error isolation, dedup by unique phone | QStash, enqueued from `customers/import` | on-demand | data-mutating | one tenant/invocation, `actorId` carried | Partial — duplicate **phone** is caught and counted as `skipped`; rows without a phone have no other unique key, so a retry after partial failure can create duplicate customer rows | must-have | M |
| daily-brief/notify | `workers/daily-brief/notify/route.js` | Formats the day's brief (Thai text + KPI block) and **pushes a LINE message** to the manager/notify user | QStash, enqueued by `daily-brief/process` at the end of its run | once/day (chained after process) | **customer-visible** (LINE push; recipient is staff/manager, not an end customer, but still an external send) | one tenant/date/invocation | **No** — checks `brief.status` but never checks whether `brief.sentAt` is already set before sending; `sentAt` is stamped *after* the push, not used as a pre-check guard | must-have | **H** |
| daily-brief/process | `workers/daily-brief/process/route.js` | Analyzes the day's conversations (AI), builds counts/CTAs/ad breakdown, upserts `DailyBrief`, auto-assigns CTA tasks, fires `AI_INTENT_DETECTED` automation events, enqueues `daily-brief/notify` | QStash, per-tenant schedule created by `Provisioner.setupTenantCrons` (`src/lib/services/provisioner.js:222-249`) at tenant onboarding, cron `"0 1 * * *"` UTC | daily, per tenant (schedule created once at onboarding — see §2 discrepancy) | data-mutating (+ triggers customer-visible automation downstream) | one tenant/invocation | **No, and worse: cross-tenant collision.** `dailyBriefRepo.upsert(briefDate, data)` (`src/lib/repositories/dailyBriefRepo.js:34-41`) keys `DailyBrief` **only on `briefDate`, with no `tenantId` in the unique key or the write itself.** Two tenants processing the same calendar date will overwrite each other's brief regardless of any migration concern. | must-have | **H** |
| extract-styles | `workers/extract-styles/route.js` | Extracts each active employee's writing-style profile (tone) from their message history, per tenant | Manual `upstash-signature` header **presence** check, or authenticated MANAGER+ session; no in-repo QStash enqueue caller found | "weekly Sunday 00:00 ICT" (comment) | data-mutating | optional `tenantId`; **defaults to ALL active tenants + all their active employees** when omitted | Not evaluated (no upsert guard visible; not the main concern) | drop-or-fix-first | M |
| health-check | `workers/health-check/route.js` | DB + Redis ping, sends an ops alert (LINE, via `notifyOps`) on failure or during the 7-day post-launch window | **`vercel.json` cron**: `"path": "/api/workers/health-check", "schedule": "0 1 * * *"` | daily 08:00 ICT, confirmed in code | read-only (+ ops-internal alert) | global, no tenant concept | Yes (nothing mutated except a Redis ping key) | must-have (as a V2-native equivalent) | L |
| invoice-pdf | `workers/invoice-pdf/route.js` | Renders/stores a PDF URL for an invoice, calling an external render service if `INVOICE_PDF_RENDER_URL` is set | QStash, enqueued from `invoices/generate-pdf` | on-demand | data-mutating (+ customer-facing document) | one invoice/tenant per invocation | Yes — short-circuits if `invoice.pdfUrl` already set | must-have | L |
| market-price | `workers/market-price/route.js` | Records daily ingredient market prices (external API or hardcoded Thai baseline list), flags >10% swings | QStash cron, no in-repo caller found | "0 23 * * * UTC = 06:00 ICT" (comment) | data-mutating (internal reference data) | requires `tenantId`, one tenant/invocation | Yes — `upsert` on `tenantId_ingredientName_recordedDate` | later (culinary-school niche) | L |
| prep-sheet | `workers/prep-sheet/route.js` | Aggregates tomorrow's course sessions → recipe ingredients → kitchen prep sheet, notifies kitchen dashboard via Pusher | QStash cron, no in-repo caller found | "0 11 * * * UTC = 18:00 ICT" (comment) | data-mutating (+ internal notification) | requires `tenantId`, one tenant/invocation | Yes — `upsert` on `tenantId_sheetDate` | later (culinary-school niche) | L |
| quote-aging | `workers/quote-aging/route.js` | Ages SENT quotes >90d unanswered to `lost_no_response`; separately flags SENT quotes as "stale" per each tenant's own workflow threshold; dispatches `EVENT_QUOTE_AGED`/`EVENT_QUOTE_STALE` automation events (which can message the customer) | QStash cron, no in-repo caller found; optional `tenantId` | "daily" (comment; exact time not in this repo — "will 401 in production until env-name mismatch resolved" per the route's own comment, now fixed by the dual-name env read in `qstash.js`) | data-mutating (+ triggers customer-visible automation downstream) | optional `tenantId`; **defaults to ALL tenants** when omitted | Yes, and unusually well-documented: aging excludes rows with `agedAt` already set; stale-dispatch stamps `staleNotifiedAt` immediately after a successful dispatch (not before), so a publish failure leaves it eligible again rather than silently dropped (see comments at `route.js:26-69`) | must-have | M |
| send-message | `workers/send-message/route.js` | Generic outbound-message sender (LINE or FB), used as a shared primitive by many other routes | QStash, enqueued from `ai/agent-process`, `conversations/[id]/reply`, `attendance/check-in` (indirectly), `campaign-broadcast`'s siblings, etc. | on-demand, high volume | **customer-visible** (direct message send) | one send/invocation, `tenantId` in body | No guard in the worker itself — relies entirely on the *caller* publishing exactly once. QStash retries only occur after a failed send attempt (the whole handler is wrapped in try/throw), so a successful send is not naturally re-sent, but a duplicate *publish* by two systems would double-send with nothing here to stop it. | must-have | M |
| sync-accounting | `workers/sync-accounting/route.js` | Daily 23:00 ICT: loads **every** active `IntegrationConfig`, runs FlowAccount sync or Express export per config | QStash cron, no in-repo caller found | "16:00 UTC = 23:00 ICT daily" (comment, matches `sync-hourly`'s neighbor pattern) | customer-visible (Express → emails accountant) + data-mutating | **loops every tenant with an active integration config**, in one call | Same underlying functions as `accounting-sync`/`sync-express` (`AccountingService.syncDailyOrdersToFlowAccount` is guarded; `runExpressExport`/`sendToAccountant` is not) | rebuild — **this is a third worker doing the same job as `accounting-sync` and `sync-express`** | H |
| sync-express | `workers/sync-express/route.js` | Generates Express X-import Excel and **emails the accountant**, for `batch`/`manual`/`realtime` modes | QStash, no in-repo enqueue caller found (comment implies cron 23:00 ICT + a "Sync Now" button) | daily (comment) + on-demand | **customer-visible** (emails accountant) | requires `tenantId`, one tenant/invocation | **No guard at all** — every call to `generateXImportFile` + `sendToAccountant` sends the email unconditionally, no dedupe/log check before sending | rebuild — see sync-accounting note | H |
| sync-hourly | `workers/sync-hourly/route.js` | Pulls Meta (Facebook) Ads campaigns/adsets/ads/insights/demographics/placements for every configured ad account, upserts via raw SQL, clears marketing cache | QStash cron | hourly (per CLAUDE.md worker doc) | read-only from the customer's perspective (syncs ad platform data into internal cache tables); data-mutating internally | **loops every row in `ad_accounts`** (all tenants) in one call | Yes — real per-tenant Redis inflight lock: `redis.set(`sync:_inflight:{tenantId}`, '1', {nx:true, ex:600})` (`route.js:206`), released in a `finally`. This is the one worker with a genuine concurrency guard. | must-have | L |
| sync-messages | `workers/sync-messages/route.js` | **Stub — TODO-only.** Verifies signature, parses body, returns success; no FB/LINE sync logic is implemented | QStash, no in-repo caller found | unknown | none (no-op) | n/a | n/a (no-op) | drop (or implement if still needed) | L |
| webhook-processor | `workers/webhook-processor/route.js` | Normalizes Instagram/WhatsApp webhook payloads, upserts a conversation + appends the inbound message, fires an internal Pusher "new-message" event | QStash, enqueued by `webhooks/[platform]/route.js` | real-time, per inbound webhook | data-mutating (+ internal notification) | **Resolved by `prisma.integrationConfig.findFirst({ provider: platform, isActive: true })` — no tenant identifier from the payload is used at all.** If two tenants both have an active integration for the same platform, whichever config row `findFirst` returns first (no `orderBy`) absorbs the message. | must-have, but **not safe to lift as-is** | **H** (cross-tenant misattribution, not just double-processing) |

25 workers total, matching the stated count.

---

## 2. What schedules them

Only two scheduling mechanisms exist **in this repository**:

1. **`vercel.json`** (repo root) — the only committed cron:
   ```json
   {
     "regions": ["sin1"],
     "crons": [
       { "path": "/api/workers/health-check", "schedule": "0 1 * * *" }
     ]
   }
   ```
   One global job, not tenant-scoped.

2. **`src/lib/services/provisioner.js:222-249`** (`Provisioner.setupTenantCrons`) —
   called once from `src/app/(auth)/onboarding/actions.js:36` when a tenant is
   provisioned. It registers exactly **one** QStash schedule per tenant:
   ```js
   await qstash.schedules.create({
     destination: `${baseUrl}/api/workers/daily-brief/process`,
     cron: '0 1 * * *',
     body: JSON.stringify({ tenantId }),
     headers: { 'Content-Type': 'application/json' },
   })
   ```
   Note this cron string (`01:00 UTC = 08:00 ICT`) **does not match** the
   `daily-brief/process/route.js` header comment ("`5 17 * * * UTC = 00:05
   ICT`") or the CLAUDE.md worker table ("dsb-generate — 00:05 ICT"). Which one
   is what's actually live cannot be determined from code — see open questions.

**Every other worker's real trigger is external to this repo.** The cadences in
the table above ("weekly", "23:00 ICT", "hourly", etc.) come only from code
comments and `src/app/api/workers/CLAUDE.md` / `gks/phase2_atomic/PROTO--automation-cron.md`
— i.e. developer documentation of intent, not verifiable schedule
configuration. No `schedules.create()` call, cron file, or queue config for
`sync-hourly`, `audit-cleanup`, `automation-engine` (cron mode), `cert-nightly`,
`crm-pattern`, `extract-styles`, `accounting-reconciliation`, `sync-accounting`,
`sync-express`, `quote-aging`, `market-price`, or `prep-sheet` exists anywhere
in `G:\zuri`. These must be configured directly in the QStash console/dashboard,
which is outside the scope of a code read. **Cannot tell from code** whether
each is one global schedule (worker loops tenants itself, as several already
do defensively) or a per-tenant schedule (matching the `daily-brief/process`
pattern) — this materially changes the cutover plan and needs the QStash
dashboard export from whoever owns that account.

The remaining workers (`auto-tag`, `crm-enrich`, `customer-import`, `invoice-pdf`,
`send-message`, `campaign-broadcast`, `check-completion`, `webhook-processor`,
`daily-brief/notify`) are **not cron at all** — they are enqueued on demand by
other API routes or by each other (see call sites in the table above), so their
"scheduling" is really "who last called `publishJSON`", and the parity question
for them is about the caller path, not a cron slot.

---

## 3. Double-processing danger list (ranked)

Ranked by how visible and irreversible the damage is if both V1 and V2 process
the same tenant's job concurrently during a partial cutover.

1. **`webhook-processor`** — not really a double-processing risk, a **worse**
   one: `findFirst({ provider: platform, isActive: true })` has no tenant
   binding at all (`route.js:30-33`). Running this in two systems isn't the
   danger — a single system already risks attributing tenant B's Instagram/
   WhatsApp message to tenant A whenever more than one tenant has that
   platform active. Must be fixed (tenant resolved from the webhook payload,
   not "whichever config row comes first") before this worker can be trusted
   in either system, let alone both.
2. **`campaign-broadcast`** — no atomic claim on `PENDING` campaign logs
   (`campaignBroadcastRepo.getPendingLogs`, `route.js:45-83`). Two concurrent
   runs for the same `campaignId` (one per system) will both pull overlapping
   batches and both push LINE/FB messages to the same customers before either
   marks them `SENT`. Directly matches the "double LINE blast" scenario named
   in the cutover rule.
3. **`automation-engine`** (cron mode) — customer-visible sends, guarded only
   by a 24h **cooldown written after acting**, not a pre-claim lock. Two
   systems both scanning the same tenant hourly can both fire inside the same
   cooldown window. Loops all tenants, so this fires for every tenant still
   dual-owned during a staged cutover, not just edge cases.
4. **`daily-brief/notify`** — sends a LINE push with no check of
   `brief.sentAt` before sending. Two systems (or one system's QStash retry
   racing a legitimate second trigger) both calling this for the same
   tenant/date both push the brief.
5. **`sync-accounting` / `accounting-sync` / `sync-express`** — three separate
   workers reach the same `generateXImportFile` + `sendToAccountant` path with
   no dedupe before sending. This is a real risk even **within V1 alone** if
   more than one of the three is actually scheduled; add a second system
   running any of them and the accountant gets multiple emails with
   overlapping data for the same day. Money-adjacent (accounting export), so
   treat as high severity even though "accountant" isn't the end consumer.
6. **`quote-aging`** — dispatches customer-visible automation events, but is
   the best-guarded of the customer-facing workers (`agedAt`/`staleNotifiedAt`
   markers stamped as part of the same pass, comments cite the specific
   ordering that makes double-dispatch unlikely). Still loops all tenants;
   ranked lower only because the idempotency story is real and documented,
   not absent.
7. **`send-message`** — no guard in the worker, but it only re-sends on a
   failed attempt (throw-to-retry only wraps the actual send calls). The
   double-processing exposure here is really "did two systems both `publishJSON`
   the same outbound message", which is a caller-discipline problem more than
   a worker-idempotency problem — still customer-visible, still worth a line
   item.
8. **`daily-brief/process`** — not a two-system race so much as a **same-day,
   any-two-tenants** collision: `DailyBrief` is keyed only by date, so the
   record isn't even tenant-isolated inside a single system, before ownership
   split is considered.

Everything else in the inventory is either read-only, protected by a real
per-tenant lock (`sync-hourly`'s Redis inflight key), or idempotent by an
upsert key that makes a second write a no-op (`invoice-pdf`, `market-price`,
`prep-sheet`, `cert-nightly`, `crm-enrich`, `auto-tag`).

---

## 4. Tenant scoping

- **Per-invocation, one tenant (safe pattern for staged cutover):**
  `accounting-reconciliation`, `accounting-sync`, `crm-enrich` (per customer),
  `crm-pattern`, `customer-import`, `daily-brief/notify`, `daily-brief/process`,
  `invoice-pdf`, `market-price`, `prep-sheet`, `send-message`, `sync-express`,
  `check-completion`, `webhook-processor` (per event, but see the misattribution
  bug above), `campaign-broadcast` (per campaign/tenant), `auto-tag` (per
  conversation).
- **Loops over ALL active tenants inside a single invocation (partial-migration
  hazard — these cannot be "owned" per tenant without code changes, because the
  worker itself decides which tenants to touch, not the caller):**
  - `audit-cleanup` (`prisma.tenant.findMany({ isActive: true })`)
  - `automation-engine` (cron/scan mode — `handleCronScan()`)
  - `cert-nightly` (when `tenantId` omitted — the documented default)
  - `extract-styles` (when `tenantId` omitted — the documented default)
  - `quote-aging` (when `tenantId` omitted)
  - `sync-accounting` (all active `IntegrationConfig` rows, no tenant filter param at all)
  - `sync-hourly` (all rows in `ad_accounts`, no tenant filter param at all)
- **No tenant concept:** `health-check` (system-wide), `sync-messages` (stub, moot).

The seven "loops all tenants" workers are the actual partial-migration hazard
class the cutover rule warns about: their QStash schedule fires once and the
worker itself decides the tenant set from the DB's `isActive` flag, not from
"which tenants this schedule owns." Splitting ownership mid-migration means
either (a) modifying every one of these seven to accept and honor a tenant
allow-list / ownership flag before any tenant moves, or (b) running V1's
version of these workers only for tenants still on V1 and building V2
equivalents that only touch tenants already cut over — with a single point of
truth for "who owns this tenant right now" that both queries against.

---

## 5. Lift blockers

- **Three duplicate accounting-export workers** (`accounting-sync`,
  `sync-accounting`, `sync-express`) reach the same underlying
  `generateXImportFile`/`sendToAccountant` code with no shared dedupe. Cannot
  safely lift any one of them into V2 without first establishing which (if
  any) is actually the live one in production QStash, and retiring the other
  two — otherwise V2 either inherits the same triplication or the cutover
  creates a fourth path.
- **`daily-brief` storage is not tenant-scoped** (`DailyBrief.briefDate` is the
  only key). This must be fixed at the schema/repo level — independent of
  which system runs the worker — before more than one tenant can safely use
  this feature in either system.
- **`webhook-processor` resolves tenant by "first active config for this
  platform,"** not from anything in the payload. Needs a real per-tenant
  webhook identifier before this can be trusted with more than one tenant on
  the same platform, in V1 or V2.
- **`campaign-broadcast` has no atomic claim on pending sends.** Needs a
  claim-then-send pattern (e.g. `UPDATE ... SET status='SENDING' WHERE
  status='PENDING' ... RETURNING`) before it's safe to run in a world where a
  retry or a second trigger could overlap it with itself, let alone with a
  second system.
- **`extract-styles` does not cryptographically verify the QStash signature** —
  it only checks that an `upstash-signature` header is *present*
  (`route.js:23-31`), then falls through to a MANAGER+ session check only when
  the header is absent. Any caller can set that header to any value and skip
  auth entirely. Separate from the migration question, but blocks trusting
  this route as-is in either system.
- **`sync-messages` is an unimplemented stub.** Confirm whether it is dead code
  to drop or a real gap to build before counting it toward parity.

## Open questions for the owner

- Which of `accounting-sync` / `sync-accounting` / `sync-express` is the one
  actually wired up in the QStash console today? This changes three verdicts
  from "rebuild, pick one" to "confirm and drop the other two."
- What are the actual live QStash schedules (cron strings + destination +
  whether `body` carries a `tenantId`) for the twelve workers with no in-repo
  caller (`sync-hourly`, `audit-cleanup`, `automation-engine`, `cert-nightly`,
  `crm-pattern`, `extract-styles`, `accounting-reconciliation`,
  `sync-accounting`, `sync-express`, `quote-aging`, `market-price`,
  `prep-sheet`)? This determines whether each is "one schedule, tenant loop
  inside" (needs a tenant-ownership filter added before cutover) or "N
  schedules, one per tenant" (can be cut over one QStash schedule at a time,
  tenant by tenant, no code change needed).
- Is `Provisioner.setupTenantCrons`'s `0 1 * * *` (08:00 ICT) or the
  `daily-brief/process` route comment's `00:05 ICT` the one actually running
  in production? They disagree.
- Are `cert-nightly` and `check-completion` both still active? They overlap
  (both can issue a `Certificate` for the same enrollment via different code
  paths) — not damaging today because both are idempotent on `enrollmentId`,
  but worth confirming only one is the intended owner of "issue certificate"
  logic in V2.

```
## Writer Report — P6 Workers
**Status**: DONE_WITH_CONCERNS
**Output file**: docs/.rwang-tasks/parity-workers.md
**Workers found**: 25
**Customer-visible side effects**: 8 (automation-engine, campaign-broadcast, daily-brief/notify, send-message, accounting-sync, sync-accounting, sync-express, quote-aging [via dispatched automation])
**Loop-over-all-tenants workers**: [audit-cleanup, automation-engine (cron mode), cert-nightly (tenantId omitted), extract-styles (tenantId omitted), quote-aging (tenantId omitted), sync-accounting, sync-hourly]
**Concerns**: (1) Three separate workers (accounting-sync, sync-accounting, sync-express) independently email the accountant with no shared dedupe — real risk even inside V1 alone. (2) campaign-broadcast has no atomic claim on pending sends — concurrent invocations double-send marketing messages. (3) webhook-processor resolves tenant by "first active integration config for this platform," not from the payload — a correctness bug independent of migration. (4) DailyBrief is keyed only by date, not by tenant, in dailyBriefRepo.js — a schema-level bug. (5) Most worker schedules (12 of 25) have no visible configuration anywhere in this repo — they must live in the QStash console; the actual cron strings and whether each is per-tenant or global could not be verified from code and are listed as open questions.
```
