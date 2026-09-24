---
id: ZAI:MARKETING-INSIGHTS-HANDOFF
version: "0.3.0"
status: candidate
last_update: "2026-09-24T15:20:00+07:00,Claude"
attributes:
  domain: marketing
  scope: marketing-insights-feature-checkpoint
relations:
  - type: relates_to
    target: ZAI:DOMAIN-INTEGRATION
---

# Marketing Insights handoff (Session 6: feature delivery, NOT service extraction)

**Checkpoint state:** I0 (target discovery and reconciliation) and I1 (pure metric
core, ports, scoped query service, synthetic fixtures, unit tests) are done at
code level. The I3 UI components (contract §7) are also built and render-tested
against the service DTOs, but **they are not mounted on any page**, because the
routes are gated (B1). This session additionally delivers, per user decisions
relayed via Mission Control (approval `apr_7b17e9cff91f`): **B5** — a
`ReportNotificationPort` adapter over the LINE Messaging API push endpoint
through Zuri's existing LINE OA, built against an injected transport, with a
pure alert-text sanitizer and a deterministic retry key; and **B4** — a
`SyncOrchestratorPort` interface plus four pure, unit-tested sync policies
(manual-refresh coalescing/conflict, retry classification, the shared
200-calls/hour budget, and the 02:00 Asia/Bangkok tick), engine-agnostic by
construction so no workflow engine's name appears anywhere under `insights/`.
**Not done:** routes and page, browser proof, persistence and migrations, any
Meta provider read, the workflow-engine-backed sync adapter, a real LINE
transport binding, live alerts, live data. None of these can be claimed yet.
S6 is a reporting module inside Marketing. It is not a Marketing extraction and
not an Insights microservice.

## Provenance

- Repository: `Freshair129/zuri.ai`
- Worktree: `.claude/worktrees/marketing-insights-s6`. Branch: `feat/marketing-insights-s6`
- Base SHA: `77204097a16afb0b9b26392636a411456c5a9442` (`origin/main`, 2026-09-24)
- Commits: I0+I1 `d3ce2bfa`; UI + persistence proposal `e01532c8` (= **tested code SHA** for that checkpoint); PR #554 recorded at `6914b226`, `da5910f1`. This session's B4 (sync orchestration core) + B5 (LINE push notifier) land in the single commit that also carries this doc update — see `git log -1` on this branch for its SHA; it changes only S6-owned paths.
- PR: [#554](https://github.com/Freshair129/zuri.ai/pull/554), draft, not for merge
- Source contract: [insights-source/contract.md](insights-source/contract.md). Its SHA-256 is
  `693f92f0…4b63`, which matches the master prompt (verified). The master prompt is stored
  verbatim alongside it (SHA-256 `baa3b330…e5b2`).
- Existing work checked first: there was no S6 or Insights branch, PR, worktree or
  handoff. No alias collision was found for "S6". The pack's other lanes are S1
  (`codex/conversation-runtime-service`, #542), S4 (`feat/market-intelligence-service`, #544)
  and S5 (`feat/scm-service-extraction`, #546). They were read, not modified.
- Not read or touched: production `.env`, the edge repo's `.env`, production DB, n8n
  credentials, Supabase keys, any Meta account. No deploy, migration, cron,
  provider call or LINE message.

## What exists now

| Layer | Path | Content |
|---|---|---|
| domain | `apps/server/src/modules/marketing/insights/domain/` | `metric-catalog` (10 daily metrics, aggregation class, contract fields, Meta deprecation status, Conversions placeholder); `report-window` (Asia/Bangkok, inclusive, 28+28, partial day, ≤93 days); `metric-series` (revisions, distributions, coverage, unique rules, net follows, safe sums, period change); `content-report` (type filter, publish cohort, ranking, by-format, URL allow-list); `csv` (RFC 4180, BOM, CRLF, formula guard); `brand-scope` (slug → binding ∩ authority, one 404 shape); **new (B4):** `sync-refresh-request` (manual-refresh Zod DTO, coalescing, idempotency-key conflict), `sync-retry-policy` (retry-once/permanent-class/Retry-After-DEFERRED decision, final-failure→notification), `sync-rate-budget` (200 calls/hour shared budget planner), `sync-schedule` (next 02:00 Asia/Bangkok tick, TZ-independent); **new (B5):** `report-notification` (closed-allow-list alert text builder, deterministic UUIDv5 retry key computed per recipient) |
| ports | `…/insights/ports/insights-ports.js`, **new (B4)** `…/insights/ports/sync-orchestrator-port.js` | Zod DTOs for bindings, observations, aggregates, snapshots and content items; typed `InsightsError`; scope-mismatch refusal; the Meta read and notification ports as honest UNAVAILABLE adapters. `sync-orchestrator-port.js` adds `SyncOrchestratorPort` (`nextScheduledTick` / `submitManualRefresh` / `readSyncStatus`), its `zSyncRunStatus` DTO (syncRunId, engineExecutionId, providerReportJobId kept distinct) and `unavailableSyncOrchestratorPort()`, superseding the separate SyncRequestPort/SyncStatusReadPort placeholders. |
| infrastructure | **new (B5)** `…/insights/infrastructure/line-push-report-notifier.js` | `createLinePushReportNotifier({ credentialRef, recipients, quotaNote, transport })` — a real `ReportNotificationPort` adapter over an **injected** transport (`transport.push({ credentialRef, to, messages, retryKey })`, the same shape as the platform's `createServerLinePushTransport().send(...)`); returns the honest unavailable port when `credentialRef` or `recipients` is missing |
| ui | `…/insights/ui/` | `InsightsLayout` (brand/asset selector, 7/28/90 presets + date inputs, tabs, freshness note; URL state through `onSelectionChange`; stale-response guard; loader injected), `InsightsOverview` + `MetricCard` + `Sparkline`, `InsightsResults` + `MetricChart` (organic/paid/total, dash patterns, table fallback, CSV link pinned to the snapshot), `InsightsContent` + `ContentTypeFilter` + `OrganicPaidChart` + `TopContentList` + `FormatBreakdown`; Thai copy for every reason code; hand-drawn SVG, no chart library, no Boost/Edit/Publish controls |
| application | `…/insights/application/` | `insights-query-service` (summary, metric series, CSV export with snapshot pin, content), which reads only through `InsightsRepository`; `insight-scope-authority` (`seesBusiness` + `growth` gate, no new role) |
| fixtures | `apps/server/tests/fixtures/marketing-insights/` | synthetic (`fx-`) bindings for all three brands, an in-memory repository and binding port; **new (B4)** `fixture-sync-orchestrator.js`, an in-memory FAKE `SyncOrchestratorPort` used only in tests |
| tests | `apps/server/tests/unit/marketing/insights/` (17 files) | see Verification |
| docs | this folder | [reconciliation + TARGET_APP_BINDING](INSIGHTS-CONTRACT-RECONCILIATION.md), [metric compatibility](INSIGHTS-METRIC-COMPATIBILITY.md) |

**S6 owned paths:** `apps/server/src/modules/marketing/insights/**`,
`apps/server/tests/unit/marketing/insights/**`, `apps/server/tests/fixtures/marketing-insights/**`,
`docs/migrations/service-extraction/{MARKETING-INSIGHTS-HANDOFF,INSIGHTS-*}.md`,
`docs/migrations/service-extraction/insights-source/**`. S6 claims nothing else in `marketing/**`,
`platform/integrations/**`, `schema.prisma`, `supabase/migrations/**`, charters, registries or roadmap.

## Verification

| Level | Result | Code SHA | Command | Numbers |
|---|---|---|---|---|
| Unit + render (no Next/DB/Meta/live-transport runtime) | **PASS** | this commit | `npx vitest run tests/unit/marketing/insights tests/unit/api-path-reachability.test.js` (in `apps/server`) | 18 files, 143 tests, 143 passed, 0 skipped, exit 0 (marketing insights alone: 17 files, 129 tests, all new B4/B5 files included) |
| Governance | **PASS** | this commit | `npm run govern` (repo root) | exit 0; critical 0, warning 21, info 34, all pre-existing and unrelated to S6 (one CRITICAL table-cell-count defect from an unescaped `\|` in this doc's own R-16 row was introduced and fixed within this session before commit) |
| Full server unit+integration | **PASS** | this commit | `npm test` (in `apps/server`, wrapped by `assert-tests-ran`) | 822 files: 816 passed, 6 skipped (both unchanged from the prior checkpoint's skip count); 6,879 tests: 6,847 passed, 32 skipped; exit 0; 579 s. The 7 new test files and 51 new tests are exactly this session's B4/B5 additions; nothing regressed |
| Hosted CI (PR #554) | **PASS** | `3990491a` (B4/B5 + per-recipient retry-key fix) | GitHub Actions | `govern` pass (2m15s), `build` pass (2m39s), `tests` pass (19m52s), `verify` pass, `edge-verify` pass, `changes` pass ×2; `e2e` and `desktop` **skipped by the workflow's path filter**, so e2e was not run. Earlier run at `6914b226` (code = `e01532c8`) also passed. |
| Component (Postgres/Supabase, RLS, concurrency) | NOT_RUN | — | — | no disposable Postgres test harness is set up; SQLite would prove nothing here |
| Browser / performance | NOT_RUN | — | — | components are render-tested only; no page mounts them until B1 |
| Provider / workflow-engine / LINE / live | NOT_RUN | — | — | blocked (see below); `LINE_ALERT_VERIFIED` stays NOT_RUN — the B5 notifier is proven only against a stub transport in unit tests, never a real LINE send |

Behaviour these tests pin down (master prompt §13A): views ≠ viewers; unique metrics never
summed across days or across organic+paid; missing ≠ 0, and a provider refusal ≠ unsynced;
revisions replace rather than add; partial day excluded from totals; incomplete prior coverage,
a zero prior or mismatched units produce a reason instead of NaN/∞/100%; precision refusal
past 2^53; Bangkok day boundaries; 56-day read span; stable ranking with limit bound; unique
Published count; type filter narrowing summary/top/byFormat together; CSV equal to chart points,
with Thai, quoting, formula injection and BOM handled; brand isolation across all three slugs; a foreign
repository row fails the whole read; expired snapshot returns 409; strict query validation (an unknown `page_id`
parameter is refused); and a static check that the module contains no Graph/`fetch`/env/Next/DB/workflow-engine
import — literally including the substring `n8n`, which is why every B4 reason code and identifier is named
generically (`WORKFLOW_ENGINE_OWNER_UNASSIGNED`, `engineExecutionId`) rather than after the specific engine.
New for this session: manual-refresh accept/coalesce/conflict by asset+dataset+window and idempotency key;
retry-once-after-five-minutes with permanent auth/schema/permission classes never retrying; a provider
Retry-After longer than five minutes honoured exactly as DEFERRED, never shortened; a final-failure decision
that yields exactly one notification payload; the 200-calls/hour budget correctly excluding calls outside the
trailing hour and deferring a burst to one hour out; the next-02:00-Bangkok tick proven identical under two
different `process.env.TZ` values; a closed reason-code allow-list rejecting raw provider error text from ever
reaching an alert; a deterministic UUIDv5 retry key from `{syncRunId, failureKey, recipientKind, recipientId}`,
computed separately per recipient so a multi-recipient alert never reuses one LINE retry key across pushes (a real
bug — one shared key across recipients — was caught in review and fixed, with a test proving two recipients get
two different keys and the same recipient/failure pair repeats the same one); and the LINE notifier returning the
honest unavailable port on a missing credential reference or an empty/invalid recipient list, never guessing
either one.

## Status (master prompt §15)

```yaml
session: S6
workstream: marketing-insights
work_type: FEATURE_MODULE_IMPLEMENTATION
provider: claude-code
repository: Freshair129/zuri.ai
app_root: apps/server
worktree: .claude/worktrees/marketing-insights-s6
branch: feat/marketing-insights-s6
base_sha: 77204097a16afb0b9b26392636a411456c5a9442
code_head_sha: e01532c8            # I1 checkpoint; B4+B5 (this session) land in a later commit on this branch — see git log -1
tested_code_sha: e01532c8
pr_number: 554
tranche: I1 + B4/B5 partial
execution_status: CHECKPOINT_I1_CODE_COMPLETE_PLUS_B4_B5_SYNC_AND_NOTIFICATION_CORE
source_contract_sha256: 693f92f04315e68044043d5d8c9cc4be90ca2845fb38e6b498f4fe9a79e14b63
TARGET_APP_VERIFIED: PARTIAL        # Zuri Marketing chosen; Ads Dashboard + Meta client + a workflow engine NOT FOUND
CONTRACT_RECONCILED: PARTIAL        # 18 rows recorded; R-16 DECIDED, R-12 narrowed to the engine adapter only, rest PROPOSED
METRIC_MAPPING_VERIFIED: FAIL       # 5 contract fields deprecated by Meta; others UNVERIFIED; no pinned version
CODE_IMPLEMENTED: PARTIAL           # I1 core/ports/query service + unmounted UI, plus B4 SyncOrchestratorPort+policies and B5 LINE push adapter; no routes/page/persistence/live sync
UNIT_COMPONENT_VERIFIED: PARTIAL    # unit+render PASS (143/143 incl. api-path-reachability); full suite PASS (6847/6879, 32 skipped, 822 files); Postgres component NOT_RUN
SCOPE_RLS_VERIFIED: NOT_RUN         # app-layer scope unit-tested; RLS needs Postgres + roles
UI_VERIFIED: PARTIAL                # server-render tests only; no browser proof
N8N_TEST_RUN_VERIFIED: NOT_RUN      # pure policies + fake adapter PASS; no engine-backed adapter exists
META_LIVE_READ_VERIFIED: NOT_RUN
REAL_DATA_ALL_BRANDS_VERIFIED: NOT_RUN
LINE_ALERT_VERIFIED: NOT_RUN        # stub only — adapter unit-tested against an injected fake transport; no real LINE send, no real transport/credentialRef binding
PERFORMANCE_VERIFIED: NOT_RUN
CI_VERIFIED: PASS                   # PR #554 at 3990491a: govern/build/tests/verify/edge-verify pass; e2e skipped by path filter
REVIEW_STATUS: NOT_REQUESTED       # S1 REVIEW_RESULT=PASS on the latest PR head is required before any merge (see Merge rule)
MERGE_STATUS: NOT_MERGED
PRODUCTION_ACTIVATION: NOT_RUN
board_update: BOARD_UPDATE_PENDING  # REFACTOR-STATUS.md lives only on unmerged #544; S6 does not write it
mc0_registration: ACTIVE            # Mission Control binding bnd_e0961dc12fe4a20d, epoch 1, SESSION_CONFIRMED; checkpoints sent with mc checkpoint
```

## Merge rule (all lanes; user instruction via MC0, approval `apr_11cab31b3590`)

- No PR merges into `main`, **including draft PR #554**, until S1 (the integrator) sends
  `REVIEW_RESULT = PASS` for **that PR's latest head SHA**.
- Any commit pushed after a review invalidates it, and a new review must be requested for the new head.
- A PASS review does not by itself allow a merge. Merging is the user's decision and needs a direct
  instruction from the user in this session's chat. S6 never merges or enables auto-merge on its own.

## Blockers (what is blocked, in which phase, who unblocks it, what can proceed meanwhile)

| # | Blocked | Phase | Owner to unblock | Condition to unblock | Safe work now |
|---|---|---|---|---|---|
| B1 | Routes `/api/insights/*` and page `/growth/insights` | I2/I3 | Registry owner / integrator | Candidate FR ids allocated for the Insights read routes and the refresh routes (preflight rejects a route without a declared FR, and S6 may not allocate numbers). Marketing charter gains `src/app/api/insights/**` (R-11). | UI components with render tests against the query-service DTOs |
| B2 | Persistence: binding, observation, content and snapshot tables | I2 | Migration owner (integrator) + Marketing owner | Review of the schema proposal (R-04/05/06/09/14): UUID keys, namespaced provider ids, nullable values with quality, revision per grain, snapshot. Then `schema.prisma` + a Supabase migration in one change. | Write the proposal as SQL/Prisma text in this folder; repository adapter contract tests against the fixture |
| B3 | Any Meta read (`MetaInsightsReadPort`) | I2 provider, I5 | Integration owner (no session owner identified) | A Meta adapter inside `src/platform/integrations/providers/meta/`, owned by Integration: pinned API version, replacement fields for the deprecated metrics, permissions, 200/hour cap shared across workers, sanitized fixture. **S6 will not build a second client.** | Metric matrix upkeep; sync-writer projection written against the port with fixtures |
| B4 | Workflow-engine-backed schedule / manual refresh / retry adapter (narrowed this session — everything that needs no engine is now built: `SyncOrchestratorPort`, refresh coalescing/conflict, retry-once policy, the shared rate budget, the 02:00 Bangkok tick, all unit-tested against an in-memory fake) | I4 | Integration/workflow-engine owner | A workflow engine instance exists (none on this machine; the coordination context intends n8n) and an orchestration owner is assigned; the refresh-route deltas (R-12) are accepted | Done this session: the pure policies and the port interface, with tests. Remaining safe work: wire the routes once B1 lands, and write the engine adapter against `SyncOrchestratorPort` once an owner and instance exist |
| B5 | Real LINE send (DECIDED this session via MC0 `apr_7b17e9cff91f`: LINE Messaging API push through the existing Zuri OA — see R-16). What remains blocked is narrower: the real `transport` binding + `credentialRef`, and the approved `recipients` list | I4 | LINE OA Studio + Integration owners (transport/credentialRef); user (recipients) | The transport binding, a credentialRef and an approved recipients list are supplied. No LINE account is opened and nothing is sent by S6. | Done this session: `createLinePushReportNotifier` (adapter), `report-notification.js` (alert text + retry key), unit-tested against a stub transport. Keep the port unavailable (`CREDENTIAL_REF_NOT_CONFIGURED` / `RECIPIENT_NOT_CONFIGURED`) until both inputs exist |
| B6 | Brand bindings for INFRESH / Glowcea / 056 Laos | I5 | Business owner (user) | Which Tenant/Business each brand belongs to, and which Pages and ad accounts are authorized. None of this exists in the repo today. | Synthetic `fx-` bindings only |
| B7 | Live acceptance (real data for all brands, schedule, LINE) | I5/I6 | User + Integration owner | Explicit test connection, assets, window and budget approval | — |

## Remaining acceptance (contract §9, each separate from mocks)

1. Overview/Results/Content render for all three brands with real synced data: NOT_RUN (B1–B3, B6)
2. Date range picker updates all views: PARTIAL (component + window semantics + stale-response guard tested; no browser proof)
3. CSV matches the chart: PARTIAL (unit-proven against the same points; no route or browser proof)
4. Content type filter narrows topContent and byFormat: PARTIAL (unit-proven)
5. Sync runs on schedule and on manual trigger; failures alert through LINE: NOT_RUN live, but the policy layer is now unit-proven: manual-refresh coalescing/conflict, retry-once-then-alert, the rate budget and the 02:00 Bangkok tick (B4 pure core done; still blocked on B3 the Meta read, the engine adapter, and B5's real transport/credentialRef/recipients)
6. No direct Graph calls from dashboard requests: PARTIAL (static import check + no client in the module; network/log audit needs routes)
7. Cross-brand isolation test over all three brand IDs: PARTIAL (service-level, synthetic; RLS NOT_RUN)
8. Ad account insights (contract purpose): OPEN SCOPE, not started (R-08)

## Operating runbook

Not applicable at this checkpoint: nothing runs outside tests. The runbook (test
setup, initial backfill, scheduled/manual refresh, gaps, retries, notifications,
revocation, rollback, activation gate) is written at I4, once there is something to operate.
The activation gate stays closed: no production schedule, no migration, no deploy.

## Board delta (for the integrator, S1 by default)

Add a linked **feature** lane. Do not change the Marketing extraction row:

```yaml
lane: S6 — Marketing Insights (feature delivery, NOT service extraction)
handoff: docs/migrations/service-extraction/MARKETING-INSIGHTS-HANDOFF.md
branch: feat/marketing-insights-s6
base: 77204097
tranche: I1 code complete (I0 + I1), plus B4 sync-orchestration core and B5 LINE push notifier (this session)
hard_start_dependencies: none
soft_dependencies: [Integration Meta adapter (B3), migration review (B2), FR allocation (B1), workflow-engine adapter (B4, narrowed), LINE transport/credentialRef binding (B5, narrowed)]
blocks_other_lanes: none
shared_files_touched: none (docs added only under docs/migrations/service-extraction/ with S6-prefixed names)
```

This delta has **not** been delivered to S1 or MC0. No broker or MC0 tool was
found in this session. It sits in this file for the user or integrator to
forward.

## Next exact action

1. Done: draft PR #554 is open and CI is green (see Verification).
2. Done as a document: [INSIGHTS-PERSISTENCE-PROPOSAL.md](INSIGHTS-PERSISTENCE-PROPOSAL.md). It still has to
   be forwarded to the migration owner for review (B2); S6 has not sent it anywhere.
3. Once FR ids exist (B1): add the four GET routes plus `/growth/insights/page.jsx` (the page
   injects `load` and the router), then do browser proof and a network audit showing no Graph
   call on any GET, render or export.
4. New this session: `SyncOrchestratorPort` + pure sync policies (B4) and `createLinePushReportNotifier`
   (B5) are code-complete and unit-tested. Next: forward the recipients list and get the transport/credentialRef
   binding from LINE OA Studio/Integration (unblocks B5 for real); get a workflow-engine owner and instance
   assigned, then write the engine adapter against `SyncOrchestratorPort` (unblocks B4 for real). Neither
   needs any further S6 code once those inputs exist — only a concrete adapter behind the same ports.
