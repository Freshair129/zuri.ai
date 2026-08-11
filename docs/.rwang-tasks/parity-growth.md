# Parity Inventory — GROWTH (P3)

Scope: `marketing`, `automations`, `ai` in `G:\zuri` (read-only), plus adjacent campaigns/broadcasts/ad-accounts.
Source root for all paths below: `G:\zuri` (not copied, not modified).

---

## 1. Sub-area tables

### 1a. Meta Ads reporting & audit (`marketing/ads*`)

| Sub-area | API routes | Dashboard pages | Prisma models owned | Workers touched | Evidence of real use | Verdict | Cutover risk | Why |
|---|---|---|---|---|---|---|---|---|
| Ads dashboard & timeline | `src/app/api/marketing/ads/route.js`, `.../ads/[adId]/toggle/route.js`, `.../ad-timeline/route.js`, `src/app/api/ads/optimize/route.js` (PATCH pause/resume) | `src/app/(dashboard)/marketing/page.jsx` (main), ad widgets on it | `AdAccount`, `Campaign`, `AdSet`, `Ad`, `AdDailyMetric`, `AdLiveStatus`, `AdDailyPlacement`, `AdDailyDemographic`, `AdHourlyMetric` (prisma/schema.prisma:1045-1244) | none directly (data is synced by an external ingest not in this scope's sub-tree — not found under marketing/automations/ai) | 9 dedicated Prisma models with hourly/daily/placement/demographic granularity — this is deep, mature functionality, not a stub | **must-have** | M | Meta Ads is core to a Thai SMB's growth loop; the data model is rich (hourly heatmap, placement/demo breakdowns) and would be expensive to rebuild; but it depends on an external Meta sync pipeline outside this scan's scope that must be re-verified before reuse |
| Ads audit (rule engine + AI narrative) | `src/app/api/marketing/ads-audit/route.js`, `src/lib/ai/adsAuditor.js` (478 lines) | `src/app/(dashboard)/marketing/ads-audit/page.jsx` | none new — reads via `src/lib/repositories/marketingRepo.js` | none (on-demand, Redis-cached 15 min) | Rule-based benchmark engine (CTR/ROAS/CPC/CPM/CPL/frequency) with Thai-SME-specific thresholds documented as derived from "pilot-tenant aggregates" — real tuning effort, not boilerplate | **must-have** | L | Advisory-only, read-only against `AdDailyMetric`; nothing it does can double-send anything; cheap to keep, high perceived value |
| Campaign broadcast engine (LINE/FB blasts) | `src/app/api/marketing/campaigns/*` (CRUD, cancel, logs, send), `src/app/api/workers/campaign-broadcast/route.js` | `src/app/(dashboard)/marketing/campaigns/page.jsx`, `[id]/page.jsx`, `new/page.jsx`, `campaign-tracker/page.jsx` | `CampaignBroadcast`, `CampaignLog` (schema.prisma:1251-1301) | `workers/campaign-broadcast` (QStash, self-re-enqueuing batch sender) | Full send pipeline: Redis idempotency lock, PDPA consent gate (`canMarketTo`, added CR-003 2026-08-09), opt-out keyword scan, 30 msg/min throttle, per-recipient `CampaignLog` — production-grade, not a prototype | **must-have** | **H** | This is the literal "double LINE blast" risk named in ADR-003 §D8 — it pushes real messages to real customers via `api.line.me/v2/bot/message/push` and the Graph API. If V2 reuses this UI/flow, tenant ownership must be exclusive at cutover or customers get double-messaged |
| Daily brief (internal digest, not customer-facing) | `src/app/api/marketing/dashboard/route.js`, `src/app/api/analytics/daily-brief`, `src/app/api/daily-brief`, `src/app/api/workers/daily-brief/process/route.js`, `.../daily-brief/notify/route.js` | `src/app/(dashboard)/marketing/daily-brief/page.jsx` | `DailyBrief` (schema.prisma:1689) | `workers/daily-brief/process`, `workers/daily-brief/notify` (QStash, per-tenant schedule set at provisioning) | `Provisioner.setupTenantCrons` (`src/lib/services/provisioner.js:222-249`) creates a per-tenant QStash schedule at `0 1 * * *` — this is wired into tenant onboarding, i.e. every tenant gets one | **must-have** | M | Sends a LINE push to the *manager/owner*, not customers (`LINE_NOTIFY_USER_ID`/`LINE_MANAGER_USER_ID`) — lower blast-radius risk than campaign broadcast, but still a real outbound message that would duplicate if both systems run it |
| Chat/memory (marketing AI Q&A surface) | `src/app/api/marketing/chat/conversations/route.js`, `src/app/api/marketing/memory/route.js`, `src/app/api/ai/ask-marketing/route.js` | embedded in `src/app/(dashboard)/marketing/page.jsx` via `MarketingChat.jsx` | `TenantMarketingConfig` ("Business Memory", schema.prisma:1211) | none | `TenantMarketingConfig` (targetROAS, avgCOGS, fatigue threshold, notes) is read into every AI prompt — a real "business memory" concept worth preserving | **must-have** | L | Read-only advisory chat; no side effects; the underlying "business memory" config table is small and cheap to carry forward |

### 1b. Automations (`automations`)

| Sub-area | API routes | Dashboard pages | Prisma models owned | Workers touched | Evidence of real use | Verdict | Cutover risk | Why |
|---|---|---|---|---|---|---|---|---|
| Workflow CRUD + templates | `src/app/api/automations/route.js`, `[id]/route.js`, `[id]/toggle/route.js`, `templates/route.js`, `[id]/executions/route.js`, `analytics/route.js` | `src/app/(dashboard)/automations/page.jsx`, `[id]/page.jsx`, `new/page.jsx`, `analytics/page.jsx` | `AutomationWorkflow` (schema.prisma:1397) | none directly | `AUTO-GENERATED from phase3.5_microtasks/FEAT-014` header — codegen'd from a spec, has a real template gallery (`TemplateGallery.jsx`), and a placeholder-allowlist validator (`src/lib/automationTemplating.js`) rejecting unsafe `{{amount}}`/`{{price}}` interpolation | **must-have** | M | Config surface only (no direct send); the trigger/action model (TCA: Trigger-Condition-Action) is a real, tested abstraction (`automationEngine.test.js`, `automationRepo.test.js`) worth reusing |
| Dry-run (preview before publish) | `src/app/api/automations/[id]/dry-run/route.js` | button inside `WorkflowBuilder.jsx` | none new | none (executes nothing — `executeAction(..., { dryRun: true })`) | Comment explicitly cites "CR-009 spec hazard 2: there is no dry-run — the design requires a recipe be provable before it can message a real customer" — this is exactly the V2 "preview before write" principle, already implemented once | **must-have** | L | This is the one piece of V1 growth code that already matches V2's design rule; worth lifting as a pattern reference even independent of the UI |
| Execution engine (runtime) | `src/app/api/automations/[id]/execute/route.js` (manual trigger), `src/app/api/workers/automation-engine/route.js` (cron + event dispatch) | `ExecutionLog.jsx` (read-only log view) | `AutomationExecution`, `AutomationCooldown` (schema.prisma:1430-1467) | `workers/automation-engine` (QStash) | Cooldown table + circuit breaker (auto-disables a workflow if error rate > 30% in a batch) — real production hardening | **must-have with caveats** | **H** | Fires `SEND_LINE_MESSAGE`/`SEND_FB_MESSAGE` actions with **no per-instance human confirmation** once a workflow is live (see §2). A live workflow is a standing instruction to message real customers on a schedule — exactly the double-processing hazard in ADR-003 §D8 if V1 and V2 both keep it active for the same tenant |

### 1c. AI surface (`ai`)

| Sub-area | API routes | Dashboard pages | Prisma models owned | Workers touched | Evidence of real use | Verdict | Cutover risk | Why |
|---|---|---|---|---|---|---|---|---|
| Marketing AI chat / ads narrative | `src/app/api/ai/ask-marketing/route.js`, `src/app/api/ai/campaign-draft/route.js`, `src/app/api/ai/promo-advisor/route.js` | `MarketingChat.jsx` | none | none | Streams only; `buildActionCards` (`src/lib/ai/marketingOptimizer.js:18-65`) is deterministic rule logic on top of DB data, not an AI write | **must-have** | L | Draft/advisory only — safe to keep as-is |
| CRM/data-entry confirm pattern | `src/app/api/ai/confirm/route.js`, `AIPendingEntry`/`AIChatHistory` models (schema.prisma:1474, 1493) | (CRM domain, adjacent) | `AIPendingEntry`, `AIChatHistory` | none | Correctly implements stage → human confirm/cancel → single commit — this is the pattern V2's design rule wants everywhere | **must-have (as reference pattern)** | L | Genuinely the model to imitate; adjacent to growth (CRM), not core marketing, but its shape should be the template for V2's "AI never writes directly" rule |
| Agent Mode (autonomous LINE/FB auto-reply) | `src/app/api/ai/agent-mode/toggle/route.js`, `src/app/api/ai/agent-process/route.js`, `src/lib/ai/agentMode.js` (445 lines) | inbox UI (not scanned in depth — outside marketing/automations/ai dashboard tree) | `Conversation.agentMode/agentTurnCount`, `Message`, `ConversationLog`, `AgentStyle` (schema.prisma:2243, 2264) | driven by LINE webhook → QStash → `agent-process` | Escalation-keyword detection, loop detection, per-employee style profile, confidence gate — substantial, tested (`agentMode.test.js`) feature | **must-have, needs redesign at cutover** | **H** | See §2 — this is V1's one clear violation of "AI never writes directly." Opt-in + confidence gate exist, but there is no per-message human confirmation once a tenant turns it on |
| Sales Closer (order drafting) | `src/app/api/ai/sales-closer/route.js`, `.../sales-closer/approve/route.js`, `src/lib/ai/salesCloser.js` | CRM/inbox (adjacent, not marketing) | `Order` (`requiresApproval` flag) | none | Explicit "M4 Feature A3 — Human Gate": creates the `Order` row immediately (`createOrder(..., { requiresApproval: true })`) then requires a separate `/approve` call before it's usable | **later (CRM-adjacent)** | M | Named in the brief as adjacent-only; flagged because it's a *second, different* confirmation pattern from `ai/confirm` (write-then-approve vs. stage-then-write) — worth reconciling into one pattern in V2, not two |
| Sentiment dashboard / CTA assigner / conversation analyzer / customer profiler | `src/app/api/ai/sentiment-dashboard/route.js`, `src/lib/ai/ctaAssigner.js`, `conversationAnalyzer.js`, `customerProfiler.js`, `conversationTagger.js`, `objectionPlaybook.js`, `styleExtractor.js`, `slipVerifier.js` | CRM dashboards (adjacent) | writes to `ConversationAnalysis` (schema.prisma:1656) via daily-brief batch job | `workers/daily-brief/process` (batch-analyzes conversations) | Runs as part of the daily-brief batch, writes `ConversationAnalysis` rows directly (Gemini JSON output written to DB with no human review step) | **later (CRM-adjacent)** | M | Batch-written analysis/tags, not customer-facing sends — lower risk than Agent Mode/broadcasts, but is itself an example of AI output written to DB without a confirm step (§2) |

**Verdict summary for this file**: must-have 10 · later 3 · drop 0 · rebuild 0
(No sub-area was judged clearly droppable — everything found is either live production infrastructure or a design pattern worth preserving. "Rebuild" was not assigned to anything: even Agent Mode's risky auto-send path is reusable if V2 tightens the confirmation gate rather than reimplementing the whole feature.)

---

## 2. Existing AI surface (the most important section)

**Provider/SDK**: `@google/generative-ai` (npm package), Google Gemini. Models used: `gemini-2.0-flash` (most call sites) and `gemini-2.0-pro-exp-02-05` (`marketingOptimizer.js` chat). Env var name only: `GEMINI_API_KEY` (never read its value).

**Every AI call site found in scope**, and whether output is validated / human-confirmed before it lands on a customer or the DB:

| File | What it does | Writes to DB? | Reaches a real customer? | Human confirms first? |
|---|---|---|---|---|
| `src/lib/ai/gemini.js` (`analyzeCustomerConversation`, `analyzeTenantPatterns`, `generateFollowUpDraft`, `streamFollowUpDraft`) | CRM insight extraction / follow-up drafting | No (returns data to caller) | No (draft text returned to UI) | N/A — draft only |
| `src/lib/ai/adsAuditor.js` (`generateNarrative`) | 3-sentence Thai executive summary appended to a cached audit report | No | No | N/A — advisory text only |
| `src/lib/ai/marketingOptimizer.js` | Streams chat answers + deterministic action cards | No | No | N/A |
| `src/app/api/ai/campaign-draft/route.js` | Streams a broadcast message draft | No | No | Yes — draft only, staff must paste into a campaign and hit Send |
| `src/app/api/ai/confirm/route.js` + `AIPendingEntry` | Generic "stage AI output → confirm/cancel → commit" | **Yes, but only after explicit confirm** | No | **Yes — this is the correct pattern** |
| `src/lib/ai/agentMode.js` (`processAgentReply`) | Generates an LINE/FB auto-reply as "the staff member" | **Yes — unconditionally** (saved to `Message` + `ConversationLog` as soon as generated, before any delivery decision) | **Yes, conditionally** — delivered live via `sendLineText`/`sendFbText` if `Tenant.config.agent.autoReplyDelivery === true` AND confidence ≥ `autoReplyMinConfidence` (default 0.6) | **No per-message confirmation.** Gating is opt-in (tenant-level toggle, default off) + a confidence threshold, not a human reviewing each reply before it ships. Default state (opt-in off) is safe; once a tenant turns it on, the AI writes directly and sends directly. |
| `src/app/api/ai/sales-closer/route.js` (`closeSale`) | Drafts sales replies; on `CREATE_ORDER` intent, creates an `Order` row directly | **Yes — writes the Order row immediately**, `requiresApproval: true` | No (order isn't a message) | **After the fact** — `/api/ai/sales-closer/approve` is a separate step that must run before the order is otherwise usable, but the row already exists in the DB when AI decided to create it |
| `workers/daily-brief/process` → `ConversationAnalysis` writes | Batch AI analysis of conversations (state, tags, revenue attribution) | **Yes — written directly**, no confirm step | No | No — but output is analytics metadata, not a customer-facing action |

**Verdict**: V1 does **not** consistently follow "AI never writes directly, every AI-derived change is previewed and confirmed."
- **Compliant example** (`ai/confirm` + `AIPendingEntry`): stage → human decides confirm/cancel → single commit. This is the pattern to standardize on.
- **Two different non-compliant shapes exist**, not one:
  1. **Write-then-flag** (`sales-closer`): the AI write happens first, approval gates usability afterward.
  2. **Write-and-conditionally-send** (`agentMode`): the AI write is unconditional, and live delivery to the customer is gated by an opt-in toggle + confidence score rather than a human review step.
- **Silent write, no gate at all** (`ConversationAnalysis` from daily-brief): lowest risk (internal analytics) but still counter to the rule as stated.

For V2, the design implication is concrete: only one of the four shapes found in V1 (`AIPendingEntry`/`ai/confirm`) matches the target rule. If V2 reuses Agent Mode or Sales Closer's UI, the write/send path underneath needs to be re-plumbed through the same stage-then-confirm mechanism, not lifted as-is.

---

## 3. Outbound side effects (highest cutover risk)

Every route/worker in scope that can put a message in front of a real customer or send an external network call carrying tenant data:

1. **Campaign broadcast** — `src/app/api/workers/campaign-broadcast/route.js`. Sends to `api.line.me/v2/bot/message/push` and `graph.facebook.com/.../messages` in batches of 50, throttled to ~30/min, gated by `canMarketTo()` (PDPA consent) and an opt-out keyword scan. Triggered by `src/app/api/marketing/campaigns/[id]/send/route.js` (human clicks Send). Idempotency: Redis `SET NX` lock on `campaign:{id}:sending`.
2. **Automation workflow actions** — `src/lib/services/actionExecutor.js` (referenced from `automationEngine.js` and the dry-run route; not independently read in this pass, flagged for a follow-up read) executes `SEND_LINE_MESSAGE`/`SEND_FB_MESSAGE` action types with no per-send human step once a workflow is `isActive: true`. Cooldown (`AutomationCooldown`, default 24h) and a hourly rate limit (500/tenant) are the only brakes.
3. **Agent Mode auto-reply** — `src/lib/ai/agentMode.js` → `sendLineText`/`sendFbText`, opt-in gated (see §2).
4. **Daily brief notify** — `src/app/api/workers/daily-brief/notify/route.js`. Pushes to the **tenant's manager/owner** LINE ID (`LINE_NOTIFY_USER_ID`/`LINE_MANAGER_USER_ID`), not customers — lower risk, but still a real external send that would double-fire if both systems process the same tenant.
5. **Escalation notify** — `agentMode.js` → `notifyAgentViaLine` (LINE push to the assigned employee when Agent Mode escalates). Internal, not customer-facing.
6. **Quote-aging events** (adjacent, found via `dispatchEventWorkflow` search) — `src/app/api/workers/quote-aging/route.js` dispatches `EVENT_QUOTE_STALE`/`EVENT_QUOTE_AGED` into the automation engine, which can in turn trigger a `SEND_LINE_MESSAGE` action (chain: quote-aging → automation-engine → actionExecutor → LINE). Flagged because it's an indirect path into the same customer-messaging risk as #2, from outside the `marketing`/`automations` tree.

**All of the above are exactly the ADR-003 §D8 hazard**: if a tenant's automations/campaigns stay active in V1 while V2 also owns that tenant, customers get double-messaged and (for paid ad actions) potentially double-charged. Tenant ownership must be a hard single-writer switch at cutover, not a soft migration window.

---

## 4. Scheduling / triggers

| Side effect | Fires via | Schedule lives in |
|---|---|---|
| Campaign broadcast | Human clicks Send → self-re-enqueuing QStash worker until batch queue empty | No cron; ad hoc, triggered per campaign |
| Automation — event-triggered (`AI_INTENT_DETECTED`, `EVENT_QUOTE_STALE/AGED`) | Fired inline from `daily-brief/process` (intent ≥ 0.70) and `workers/quote-aging` via `dispatchEventWorkflow` → QStash | No stored schedule — event-driven |
| Automation — time-based (`TIME_INACTIVE`, `TIME_SCHEDULED`) | Meant to run via an **hourly** `handleCronScan()` in `workers/automation-engine/route.js` | **No QStash schedule creation call for this route was found anywhere in the scanned code.** `Provisioner.setupTenantCrons` (`src/lib/services/provisioner.js:222`) only schedules `daily-brief/process` (`0 1 * * *`); `vercel.json` only crons `health-check`. This is either configured out-of-band in the QStash console (undocumented in code) or not actually running — see Lift Blockers. |
| `TIME_SCHEDULED` workflows specifically | Even if the hourly scan runs, `isScheduledWorkflowDue`/`findScheduledCandidates` are asserted missing from `automationEngine.js` — the route throws loudly by design (self-documented as a known gap, see `src/app/api/workers/automation-engine/route.js:124-137`) | N/A — feature is declared broken in-code |
| `EVENT_STAGE_CHANGE`, `EVENT_TAG_ADDED`, `EVENT_ORDER_COMPLETED`, `EVENT_MESSAGE_RECEIVED` | Declared as valid `triggerType`s in `src/app/api/automations/route.js:15` and offered in `templates/route.js` (e.g. order-completed follow-up template) | **No `dispatchEventWorkflow` call site for any of these four trigger types was found in the scanned tree.** A tenant can build a workflow on these triggers via the UI/template gallery and it will never fire. |
| Daily brief | Per-tenant QStash schedule created at tenant provisioning (`0 1 * * *`) → `daily-brief/process` → `daily-brief/notify` | `src/lib/services/provisioner.js:222-249` |
| Agent Mode replies | LINE webhook → (webhook handler not in this scan's tree) → QStash → `ai/agent-process` | Event-driven, no schedule |

---

## 5. Lift blockers and open questions

**Lift blockers**
- **`ads/optimize` and Meta sync dependency**: the ads dashboard's value depends on whatever ingests `AdDailyMetric`/`AdHourlyMetric`/etc. from the Meta Marketing API. That ingest job was not found under `marketing`/`automations`/`ai` — it's outside this scan's three folders. Do not assume it lifts for free; locate and audit it before committing to the "must-have" verdict on ads reporting.
- **Hourly automation cron is unverified**: no code-level QStash schedule creation for `workers/automation-engine`'s cron path was found (see §4). Confirm in the live QStash console dashboard (not `.env`, not this repo) whether it actually runs before assuming `TIME_INACTIVE` workflows are live in production today.
- **`TIME_SCHEDULED` trigger type is a known no-op** — self-documented in-code as unimplemented (`isScheduledWorkflowDue`/`findScheduledCandidates` missing). Any tenant workflow using it silently never ran until the recent change made it fail loudly instead. Carries no working behavior to migrate.
- **Four of nine declared automation trigger types appear to have no dispatch call site** (`EVENT_STAGE_CHANGE`, `EVENT_TAG_ADDED`, `EVENT_ORDER_COMPLETED`, `EVENT_MESSAGE_RECEIVED`) despite being offered in the template gallery. If any tenant has built a workflow expecting one of these to fire, it is currently inert — worth confirming with the owner before promising parity on "automation triggers."
- **Two incompatible AI-write patterns** (`AIPendingEntry` stage-then-confirm vs. Sales Closer's write-then-approve) would need reconciling into one before V2 can claim a single, consistent "AI never writes directly" contract.
- **`actionExecutor.js`** (imported by both the engine and the dry-run route) was not read in this pass — it is the single choke point for every automation side effect and should be read in full before any reuse decision on automations.

**Open questions for the owner** (only ones that change a verdict)
1. Is the hourly `workers/automation-engine` cron actually scheduled in the live QStash console today? If not, `TIME_INACTIVE` automations are dormant in production and the verdict on "Execution engine (runtime)" should drop from must-have to later.
2. How many tenants currently have `Tenant.config.agent.autoReplyDelivery === true` (Agent Mode live auto-send)? If the answer is zero or near-zero, V2 can treat Agent Mode as a UI concept to redesign around the confirm pattern rather than a live migration risk.
3. Are any tenants relying on `EVENT_STAGE_CHANGE`/`EVENT_TAG_ADDED`/`EVENT_ORDER_COMPLETED`/`EVENT_MESSAGE_RECEIVED` automation triggers today? If yes, that's a functional gap in V1 itself, not just a V2 planning question, and it changes what "parity" even means for those templates.
4. Who owns the Meta Ads sync ingest job that populates `AdDailyMetric`/`AdHourlyMetric`? It's load-bearing for the "must-have" ads-reporting verdict but sits outside marketing/automations/ai.

---

## Writer Report — P3 Growth
**Status**: DONE_WITH_CONCERNS
**Output file**: docs/.rwang-tasks/parity-growth.md
**Sub-areas covered**: Meta ads reporting/audit, campaign broadcast engine, daily brief, marketing AI chat, automation workflow CRUD/templates, automation dry-run, automation execution engine, Agent Mode auto-reply, Sales Closer (CRM-adjacent), AI confirm/pending-entry pattern, sentiment/conversation analysis batch AI
**Verdict counts**: must-have 10 · later 3 · drop 0 · rebuild 0
**AI already in V1**: Gemini 2.0 (`@google/generative-ai`, `GEMINI_API_KEY`) powers chat/drafts/insights (safe, draft-only) plus two write paths that bypass a true preview-and-confirm gate — Agent Mode auto-replies (opt-in + confidence-gated, but no per-message human confirm) and Sales Closer (writes the Order row before approval, not after)
**Outbound side effects**: campaign broadcast (LINE push + FB Messenger, real customers), automation workflow actions (LINE/FB, real customers, no per-send confirm), Agent Mode auto-reply (LINE/FB, real customers, opt-in gated), daily-brief notify (LINE push to manager, not customer), escalation notify (LINE push to assigned staff), quote-aging → automation-engine chain (indirect path to customer LINE/FB sends)
**Concerns**: (1) no confirmed schedule wiring found for the hourly automation cron — verify in QStash console before trusting `TIME_INACTIVE` parity; (2) `TIME_SCHEDULED` and four of nine declared trigger types appear non-functional in V1 itself; (3) two incompatible AI-write-confirmation shapes need reconciling before V2 can claim one consistent rule; (4) Meta Ads sync ingest (feeds the ads-reporting "must-have" verdict) lives outside this scan's three folders and needs its own audit.
