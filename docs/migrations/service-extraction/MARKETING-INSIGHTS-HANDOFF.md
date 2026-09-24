---
id: ZAI:MARKETING-INSIGHTS-HANDOFF
version: "0.1.0"
status: candidate
last_update: "2026-09-24T13:30:00+07:00,Claude"
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
code level. **Not done:** routes and UI, persistence and migrations, any Meta
provider read, n8n, alerts, live data. None of these can be claimed yet. S6 is a
reporting module inside Marketing. It is not a Marketing extraction and not an
Insights microservice.

## Provenance

- Repository: `Freshair129/zuri.ai`
- Worktree: `.claude/worktrees/marketing-insights-s6`. Branch: `feat/marketing-insights-s6`
- Base SHA: `77204097a16afb0b9b26392636a411456c5a9442` (`origin/main`, 2026-09-24)
- Code/test SHA: the commit that adds this revision (`git log -1 feat/marketing-insights-s6`)
- PR: none yet (a draft PR is next, not for merge)
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
| domain | `apps/server/src/modules/marketing/insights/domain/` | `metric-catalog` (10 daily metrics, aggregation class, contract fields, Meta deprecation status, Conversions placeholder); `report-window` (Asia/Bangkok, inclusive, 28+28, partial day, ≤93 days); `metric-series` (revisions, distributions, coverage, unique rules, net follows, safe sums, period change); `content-report` (type filter, publish cohort, ranking, by-format, URL allow-list); `csv` (RFC 4180, BOM, CRLF, formula guard); `brand-scope` (slug → binding ∩ authority, one 404 shape) |
| ports | `…/insights/ports/insights-ports.js` | Zod DTOs for bindings, observations, aggregates, snapshots and content items; typed `InsightsError`; scope-mismatch refusal; the Meta read, sync, sync-status and notification ports as honest UNAVAILABLE adapters |
| application | `…/insights/application/` | `insights-query-service` (summary, metric series, CSV export with snapshot pin, content), which reads only through `InsightsRepository`; `insight-scope-authority` (`seesBusiness` + `growth` gate, no new role) |
| fixtures | `apps/server/tests/fixtures/marketing-insights/` | synthetic (`fx-`) bindings for all three brands, an in-memory repository and binding port |
| tests | `apps/server/tests/unit/marketing/insights/` (9 files) | see Verification |
| docs | this folder | [reconciliation + TARGET_APP_BINDING](INSIGHTS-CONTRACT-RECONCILIATION.md), [metric compatibility](INSIGHTS-METRIC-COMPATIBILITY.md) |

**S6 owned paths:** `apps/server/src/modules/marketing/insights/**`,
`apps/server/tests/unit/marketing/insights/**`, `apps/server/tests/fixtures/marketing-insights/**`,
`docs/migrations/service-extraction/{MARKETING-INSIGHTS-HANDOFF,INSIGHTS-*}.md`,
`docs/migrations/service-extraction/insights-source/**`. S6 claims nothing else in `marketing/**`,
`platform/integrations/**`, `schema.prisma`, `supabase/migrations/**`, charters, registries or roadmap.

## Verification

| Level | Result | Code SHA | Command | Numbers |
|---|---|---|---|---|
| Unit (no Next/DB/Meta/n8n runtime) | **PASS** | this commit | `npx vitest run tests/unit/marketing/insights` (in `apps/server`) | 9 files, 66 tests, 66 passed, 0 skipped, exit 0, 33.6 s wall (92 ms in tests) |
| Governance | **PASS** | this commit | `npm run govern` (repo root) | exit 0; no CRITICAL. The `untracked-docs` warning cleared once the files were committed (re-run recorded in the commit message) |
| Full server suite / build / e2e | NOT_RUN | — | `npm run verify` | not run at this checkpoint |
| Component (Postgres/Supabase, RLS, concurrency) | NOT_RUN | — | — | no disposable Postgres test harness is set up; SQLite would prove nothing here |
| Browser / performance | NOT_RUN | — | — | no route or UI yet |
| Provider / n8n / LINE / live | NOT_RUN | — | — | blocked (see below) |

Behaviour these tests pin down (master prompt §13A): views ≠ viewers; unique metrics never
summed across days or across organic+paid; missing ≠ 0, and a provider refusal ≠ unsynced;
revisions replace rather than add; partial day excluded from totals; incomplete prior coverage,
a zero prior or mismatched units produce a reason instead of NaN/∞/100%; precision refusal
past 2^53; Bangkok day boundaries; 56-day read span; stable ranking with limit bound; unique
Published count; type filter narrowing summary/top/byFormat together; CSV equal to chart points,
with Thai, quoting, formula injection and BOM handled; brand isolation across all three slugs; a foreign
repository row fails the whole read; expired snapshot returns 409; strict query validation (an unknown `page_id`
parameter is refused); and a static check that the module contains no Graph/`fetch`/env/Next/DB/n8n import.

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
code_head_sha: "<commit adding handoff v0.1.0>"
tested_code_sha: "<same commit>"
pr_number: null
tranche: I1
execution_status: CHECKPOINT_I1_CODE_COMPLETE
source_contract_sha256: 693f92f04315e68044043d5d8c9cc4be90ca2845fb38e6b498f4fe9a79e14b63
TARGET_APP_VERIFIED: PARTIAL        # Zuri Marketing chosen; Ads Dashboard + Meta client + n8n NOT FOUND
CONTRACT_RECONCILED: PARTIAL        # 18 rows recorded; every delta PROPOSED, none reviewed
METRIC_MAPPING_VERIFIED: FAIL       # 5 contract fields deprecated by Meta; others UNVERIFIED; no pinned version
CODE_IMPLEMENTED: PARTIAL           # I1 core/ports/query service only; no routes/UI/persistence/sync
UNIT_COMPONENT_VERIFIED: PARTIAL    # unit PASS (66/66); component NOT_RUN
SCOPE_RLS_VERIFIED: NOT_RUN         # app-layer scope unit-tested; RLS needs Postgres + roles
UI_VERIFIED: NOT_RUN
N8N_TEST_RUN_VERIFIED: NOT_RUN
META_LIVE_READ_VERIFIED: NOT_RUN
REAL_DATA_ALL_BRANDS_VERIFIED: NOT_RUN
LINE_ALERT_VERIFIED: NOT_RUN        # LINE Notify ended 2025-03-31; no replacement chosen
PERFORMANCE_VERIFIED: NOT_RUN
CI_VERIFIED: NOT_RUN                # no PR yet
REVIEW_STATUS: NOT_REQUESTED
MERGE_STATUS: NOT_MERGED
PRODUCTION_ACTIVATION: NOT_RUN
board_update: BOARD_UPDATE_PENDING  # REFACTOR-STATUS.md lives only on unmerged #544; S6 does not write it
mc0_registration: NOT_VERIFIED      # no MC0 broker/tools discovered in this session
```

## Blockers (what is blocked, in which phase, who unblocks it, what can proceed meanwhile)

| # | Blocked | Phase | Owner to unblock | Condition to unblock | Safe work now |
|---|---|---|---|---|---|
| B1 | Routes `/api/insights/*` and page `/growth/insights` | I2/I3 | Registry owner / integrator | Candidate FR ids allocated for the Insights read routes and the refresh routes (preflight rejects a route without a declared FR, and S6 may not allocate numbers). Marketing charter gains `src/app/api/insights/**` (R-11). | UI components with render tests against the query-service DTOs |
| B2 | Persistence: binding, observation, content and snapshot tables | I2 | Migration owner (integrator) + Marketing owner | Review of the schema proposal (R-04/05/06/09/14): UUID keys, namespaced provider ids, nullable values with quality, revision per grain, snapshot. Then `schema.prisma` + a Supabase migration in one change. | Write the proposal as SQL/Prisma text in this folder; repository adapter contract tests against the fixture |
| B3 | Any Meta read (`MetaInsightsReadPort`) | I2 provider, I5 | Integration owner (no session owner identified) | A Meta adapter inside `src/platform/integrations/providers/meta/`, owned by Integration: pinned API version, replacement fields for the deprecated metrics, permissions, 200/hour cap shared across workers, sanitized fixture. **S6 will not build a second client.** | Metric matrix upkeep; sync-writer projection written against the port with fixtures |
| B4 | n8n schedule / manual refresh / retry | I4 | Integration/n8n owner | An n8n instance exists (none on this machine) and an orchestration owner is assigned; the refresh-route deltas (R-12) are accepted | Pure retry/coalesce policy functions with tests |
| B5 | Failure alert | I4 | LINE OA Studio + Integration owners | A replacement for LINE Notify is decided (R-16). No LINE account is opened and nothing is sent by S6. | Keep `ReportNotificationPort` unavailable; alert body sanitizer |
| B6 | Brand bindings for INFRESH / Glowcea / 056 Laos | I5 | Business owner (user) | Which Tenant/Business each brand belongs to, and which Pages and ad accounts are authorized. None of this exists in the repo today. | Synthetic `fx-` bindings only |
| B7 | Live acceptance (real data for all brands, schedule, LINE) | I5/I6 | User + Integration owner | Explicit test connection, assets, window and budget approval | — |

## Remaining acceptance (contract §9, each separate from mocks)

1. Overview/Results/Content render for all three brands with real synced data: NOT_RUN (B1–B3, B6)
2. Date range picker updates all views: NOT_RUN (UI not built; window semantics unit-tested)
3. CSV matches the chart: PARTIAL (unit-proven against the same points; no route or browser proof)
4. Content type filter narrows topContent and byFormat: PARTIAL (unit-proven)
5. Sync runs on schedule and on manual trigger; failures alert through LINE: NOT_RUN (B3–B5)
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
tranche: I1 code complete (I0 + I1)
hard_start_dependencies: none
soft_dependencies: [Integration Meta adapter (B3), migration review (B2), FR allocation (B1), notification replacement (B5)]
blocks_other_lanes: none
shared_files_touched: none (docs added only under docs/migrations/service-extraction/ with S6-prefixed names)
```

This delta has **not** been delivered to S1 or MC0. No broker or MC0 tool was
found in this session. It sits in this file for the user or integrator to
forward.

## Next exact action

1. Open a draft PR `[S6 draft, not for merge] Marketing Insights I0+I1`, read CI, and record the result here.
2. While B1 and B2 are pending, build the UI components (`InsightsLayout`, `MetricCard`,
   `Sparkline`, `MetricChart`, `ContentTypeFilter`, `OrganicPaidChart`, `TopContentList`,
   `FormatBreakdown`) as hand-drawn SVG, following repo convention, with render tests over the
   service DTOs covering every state (loading, empty, not-synced, unsupported, denied, partial, stale).
3. Write the persistence proposal (B2) as a reviewable document and send it to the migration owner.
