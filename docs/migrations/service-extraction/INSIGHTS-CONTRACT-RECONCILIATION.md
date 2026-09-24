---
id: ZAI:MARKETING-INSIGHTS-CONTRACT-RECONCILIATION
version: "0.2.0"
status: candidate
last_update: "2026-09-24T15:20:00+07:00,Claude"
attributes:
  domain: marketing
  scope: marketing-insights-contract-reconciliation
relations:
  - type: relates_to
    target: ZAI:DOMAIN-INTEGRATION
---

# Marketing Insights: reconciling the contract with this repository (S6)

This document compares the **Insights Dashboard Module** contract with what actually
exists in `Freshair129/zuri.ai`. It keeps three kinds of statement apart:

1. **BASELINE:** what the contract says. The contract is stored byte-for-byte in
   [insights-source/contract.md](insights-source/contract.md). Its SHA-256 is
   `693f92f04315e68044043d5d8c9cc4be90ca2845fb38e6b498f4fe9a79e14b63`, which matches the
   hash in the master prompt; this was checked on 2026-09-24. This document never
   edits the contract.
2. **IMPLEMENTATION DECISIONS (D-xx):** choices S6 made while building inside
   this repo. Each decision is marked `PROPOSED` until a reviewer accepts it.
3. **PROPOSED CONTRACT DELTAS / FINDINGS (R-xx):** gaps and compatibility findings.
   Each one shows what the contract says, what was found, what is proposed, and
   who has to decide.

Nothing in this document is an accepted ADR or FR. S6 has **not** allocated any
registry number (master prompt §1).

## TARGET_APP_BINDING (checked 2026-09-24)

| Field | Observed value | Evidence |
|---|---|---|
| repository | `Freshair129/zuri.ai` (public) | `git remote -v` in the S6 worktree |
| base SHA | `77204097a16afb0b9b26392636a411456c5a9442` (`origin/main`, merge of PR #552) | `git rev-parse origin/main` |
| app root | `apps/server` (Next.js 14.2.35, React 18.3.1, **JavaScript + Zod**, Prisma 5.22 with SQLite for dev/test and generated Postgres/Supabase for prod) | `apps/server/package.json`; SDD-008; CLAUDE.md |
| destination module | Marketing (`DOM-MARKETING`, route/permission key `growth`), new folder `apps/server/src/modules/marketing/insights/**` | [Marketing charter](../../domains/marketing/CHARTER.md) |
| existing "Ads Dashboard" | **NOT FOUND.** Marketing has a `/growth/paid-media` read model (FR-185) that reports every provider metric as `UNAVAILABLE` / `PAID_MEDIA_METRICS_SOURCE_UNAVAILABLE`. [CR-017](../../change-requests/CR-017-MARKETING-ADS-ANALYTICS.md) (Ads Analytics) is `superseded` and documentation only. | `marketing-insights-service.js`; CR-017 frontmatter |
| existing Meta client (`Meta_Ads_MCP` / Graph API layer) | **`EXISTING_META_CLIENT_NOT_FOUND`.** `src/platform/integrations/providers/` contains only `line/` and `model/`. There is no Graph API call anywhere in `apps/**` or `docs/**`. None of the other workspace repositories on this machine contain one either, and no MCP server is configured under that name. | grep over `graph.facebook.com`, `facebook-nodejs-business-sdk`, `Meta_Ads_MCP`, `page_impressions`, `META_ACCESS_TOKEN`; cross-repo read-only sweep |
| n8n workflows | **NOT FOUND.** There are no `n8n-nodes-base` exports in any repository on this machine and no `~/.n8n` directory. | same sweep |
| Supabase | Production Postgres is migrated from `apps/server/supabase/migrations/`, and the preflight `schema-migration-drift` check applies. Local dev/test uses SQLite. | CLAUDE.md "A new model or column ships its Supabase migration" |
| schema owner | Marketing owns Marketing models through its charter `owns_models`. `schema.prisma` and `supabase/migrations/` are shared files that must go through the integrator. | master prompt §11; charters |
| brand → Business mapping | **NOT FOUND.** `INFRESH`, `Glowcea` and `056 Laos` do not appear anywhere in the repository or on this machine. No Business, binding or connection exists for them. | grep, case-insensitive |
| Integration substrate | `IntegrationConnection`, `IntegrationCredential` (opaque refs), `IngestionRun`, `RawExternalRecord`, `SyncCursor`, `ExternalEntityRef` (Integration charter) | [Integration charter](../../domains/integration/CHARTER.md) |
| chart library | None. Existing charts are hand-drawn SVG (`ProgramRoadmapBoard.jsx`, `LineCrmDashboard.jsx`), so no chart library may be added (contract §7) | `package.json` has no chart dependency |
| unresolved gaps | Meta client, n8n, brand bindings, FR allocation for routes, migration review, notification replacement | this document |

**Decision (§2 of the master prompt):** The contract describes an app that does not
exist here, but the coordination context names Zuri's Marketing domain, so S6 builds
inside Marketing. Because no Meta client exists, S6 does not create one. Instead it
delivers ports, fixtures, the read-model query layer and the pure measurement core.
The provider, orchestration and persistence phases are gated (see the handoff).

**Technology mismatch (R-14):** The contract says TypeScript + Supabase. The host is
JavaScript + Zod with a Prisma/SQLite development baseline. S6 follows the host
(SDD-008) and does not migrate languages or ORMs. SQLite tests prove nothing about
Postgres queries, RLS or Supabase Auth, and this document makes no such claim.

## Reconciliation table

Status values: `PROPOSED` means awaiting a reviewer. `IMPLEMENTED-DEFENSIVE` means
the code already behaves safely either way without changing the baseline shape.
`BLOCKED` means a gate owned by someone else.

| id | baseline section | exact requirement | source evidence | observed implementation | discrepancy | proposed delta | authority / reviewer | decision status | affected tests |
|---|---|---|---|---|---|---|---|---|---|
| R-01 | §3 table | Views = `page_impressions_unique`, `post_impressions`; Viewers = `page_impressions_unique` | contract §3 | `metric-catalog.js` keeps `views` (ADDITIVE, count) and `viewers` (NON_ADDITIVE_UNIQUE, people) as separate definitions | One unique-reach field is named for both an impressions metric and a reach metric. Meta's deprecated-metrics page (read 2026-09-24) lists `page_impressions_unique` as deprecated from 2025-06-15 (replaced by `page_total_media_view_unique`), and `page_impressions` / `post_impressions` from 2025-11-15 (replaced by `page_media_view` / `post_media_view`). | Map Views to a views/media-view metric and Viewers to a unique metric, with the replacement fields chosen and verified against a pinned API version | Marketing owner (semantics) + Integration owner (provider fields) | PROPOSED; catalog marks both `CONTRACT_FIELD_DEPRECATED` | metric-catalog, metric-series |
| R-02 | §3 | Metric fields listed are usable | contract §3; [compatibility matrix](INSIGHTS-METRIC-COMPATIBILITY.md) | Every field is recorded with its `providerStatus` | `page_fan_adds` and `page_fan_removes` are also listed as deprecated from 2025-11-15 with **no replacement named**. The rest are UNVERIFIED because the metric reference page could not be read. | Integration owner verifies each field, period and permission against a pinned version using an authorized account. Unsupported fields show as unavailable, never 0. | Integration owner | PROPOSED | metric-catalog |
| R-03 | §8 | "no query may return data across brands unless `brand` param explicitly requests it (guard in API layer)" | contract §8 | `brand-scope.js`: the slug is only a selector. It is intersected with server-owned bindings and the viewer predicate (`seesBusiness` plus the `growth` domain gate). All refusals share one 404 shape. | The contract lets a brand parameter decide access. Here a parameter never grants anything. Cross-brand queries are not implemented. | A multi-brand read, if ever needed, becomes an explicit reviewed endpoint over an authorized set, with no aggregate across brands | Marketing owner + Identity owner | IMPLEMENTED-DEFENSIVE (stricter than baseline) | brand-scope, insight-scope-authority, insights-query-service (isolation) |
| R-04 | §4, §5 | `content_performance` holds one row per post, refreshed on sync | contract §4 | Content items carry `metricPeriod: LIFETIME_AS_OF_SYNC`. Responses declare `cohort: PUBLISHED_IN_WINDOW`. | Lifetime values of posts published in the window are not the same thing as engagement that occurred in the window | Keep the baseline cohort and label it. Add a separate observation-period table only when an approved per-period provider metric exists. Never rebuild history from current lifetime values. | Marketing owner | PROPOSED (D-05) | content-report, insights-query-service |
| R-05 | §3, §4 | `is_organic` boolean from `distribution_type` | contract §3/§4 | Daily observations carry a `distribution` of ALL, ORGANIC or PAID. Content items carry per-metric `organicViews` / `paidViews`. | One post can have both organic and paid distribution, so a boolean cannot express the breakdown | Replace `is_organic` with distribution-dimensioned measurements | Marketing + Integration owner | PROPOSED | metric-series, ports |
| R-06 | §6 content | Response has `watchTime`, `threeSecViews`, `organicViews`, `paidViews`, `thumbnailUrl` | contract §6 vs §4 | Content summary maps each field to an item metric. A missing field comes back `null` with `summaryQuality.reasonCode`. | The §4 table has no watch time, 3s views, organic/paid views or thumbnail columns | Add those as item measurements (value, unit, quality) plus an allowed thumbnail reference | Marketing owner; migration owner | PROPOSED | content-report |
| R-07 | §5 | recurring pull of the last 28 days | contract §5 | The window resolver uses 28 + 28 days (`from − 28 … to`) | Comparing against the previous period needs 56 days of coverage, which a 28-day recurring pull never provides | Split the work into an initial backfill (≥ 56 days, inside the provider window) and a recurring refresh. Report incomplete coverage instead of computing change. | Marketing owner + Integration owner | PROPOSED; code returns `PRIOR_INCOMPLETE` | report-window, insights-query-service |
| R-08 | §1 purpose, §4 | Purpose covers Pages **and ad accounts**; the tables have only `page_id` | contract §1/§4 | Bindings have `assetKind` of PAGE or AD_ACCOUNT, plus a namespace (`meta.page` / `meta.ad_account`). Tranche 1 reports Pages only (`REPORTABLE_ASSET_KINDS`). | An ad-account id would otherwise have to live in `page_id` | Typed asset binding and a backward-compatible `asset` selector | Marketing + Integration owner | PROPOSED; **Ad Insights remains open scope** | brand-scope |
| R-09 | §4 | `numeric default 0` / `bigint default 0` | contract §4 | Values are `number \| null` plus `quality`: OBSERVED, NOT_SYNCED, UNSUPPORTED, PERMISSION_DENIED, PROVIDER_ERROR or PRECISION_UNSAFE | A default 0 cannot be told apart from an observed zero | Nullable columns plus quality/reason metadata | Marketing owner; migration owner | PROPOSED | ports, metric-series |
| R-10 | §6 | `summary → {metricKey,total:number,changePct:number,series}[]`; `metric → {date,organic,paid}[]` | contract §6 | The service returns `{ data, meta }`. `data` keeps the baseline array/object shape with extra fields added. `total`, `changePct`, `organic` and `paid` are `number \| null`. | Making the numbers nullable changes the baseline types. Report metadata (window, snapshot, asset, cohort) needs a way to reach the client. | **D-API-1:** keep the baseline body and send `meta` in an `X-Insights-Meta` header (or as an opt-in envelope with `?envelope=1`). This is decided at route landing. | Marketing owner (consumer: Insights UI only, since none exists yet) | PROPOSED | insights-query-service |
| R-11 | §6 endpoint list | Endpoints are the four GETs under `/api/insights/*` | contract §6 | No routes yet (see R-15) | `/api/insights/**` is not claimed by any charter. Marketing owns `/api/growth/**`. | Keep the baseline namespace and add `src/app/api/insights/**` plus a `/growth/insights` page to Marketing `owns_routes` | Marketing owner; integrator (charter edit) | PROPOSED | — |
| R-12 | §5, §7 | A "refresh now" button exists, but the endpoint list has no POST | contract §5/§6 | `SyncOrchestratorPort` (`submitManualRefresh`, `readSyncStatus`, `nextScheduledTick`) plus four pure, unit-tested policies — refresh coalescing/conflict (`domain/sync-refresh-request.js`), retry classification (`domain/sync-retry-policy.js`), the shared 200/hour budget (`domain/sync-rate-budget.js`) and the 02:00 Asia/Bangkok tick (`domain/sync-schedule.js`) — are built and tested against an in-memory fake adapter (`tests/fixtures/marketing-insights/fixture-sync-orchestrator.js`). B4 (owner via MC0 apr_7b17e9cff91f): build only what needs no workflow engine, and keep the engine pluggable. | There is still no control endpoint (route landing is R-11/B1), and no engine-backed adapter exists | Narrowed scope: only the concrete workflow-engine adapter remains BLOCKED. Add the scoped `POST /api/insights/refresh` / `GET /api/insights/refresh/:syncRunId` routes once B1 is unblocked, wiring them to `SyncOrchestratorPort`. `unavailableSyncOrchestratorPort()`'s reason code is `WORKFLOW_ENGINE_OWNER_UNASSIGNED`, not a specific engine's name — the pure policies stay engine-agnostic (D-02) so a different engine could sit behind the port without a rewrite; the coordination context's intended engine (n8n) is recorded here, not in source. | Marketing + Integration/workflow-engine owner | PARTIALLY IMPLEMENTED: interface + policies done and unit-tested; BLOCKED only on the concrete engine adapter and on B1 for the routes | ports, sync-refresh-request, sync-retry-policy, sync-rate-budget, sync-schedule, sync-orchestrator-port |
| R-13 | §9 | CSV matches the displayed chart | contract §9 | Export reuses the exact series pipeline. `snapshot` pins the read, and an expired snapshot returns 409 `SNAPSHOT_EXPIRED`. | "Matches" needs a consistent read while a sync is running | A snapshot token for the report; the reader proves the snapshot or refuses | Marketing owner; persistence design at I2 | IMPLEMENTED-DEFENSIVE (port contract) | csv, insights-query-service |
| R-14 | §1, §4 | TypeScript + Supabase; `bigint generated always as identity` | contract §1/§4 | JS + Zod; internal UUID + human code + `ExternalEntityRef` (BR-002) | The key type and language differ from the contract | Create the tables with UUID keys and provider ids in namespaced columns / `ExternalEntityRef`. The baseline table names can survive as read views if a consumer needs them. | Migration owner (integrator) | PROPOSED | — |
| R-15 | repository rule | A route must implement a declared FR (preflight CRITICAL) | CLAUDE.md "Adding a feature" | No FR has been allocated, so no route or page was added | S6 may not allocate registry numbers | Registry owner allocates candidate FR ids for the Insights read routes and the refresh routes | Registry owner / integrator | BLOCKED | — |
| R-16 | §5 | Failure alert through the "existing LINE Notify integration" | contract §5; EXT-1 | `ReportNotificationPort` now has a real adapter, `infrastructure/line-push-report-notifier.js`, over the LINE Messaging API push endpoint used by Zuri's existing LINE OA — built against an **injected** transport (`transport.push({ credentialRef, to, messages, retryKey })`, the same call shape as `createServerLinePushTransport().send(...)` in `src/platform/integrations/providers/line/server-line-transport.js`, which this file only reads, never imports). The adapter itself has no URL, no `fetch`, no `process.env` and no credential material; the static "no live request path" check in `metric-catalog.test.js` covers it like every other file under `insights/`. | LINE Notify ended on 2025-03-31; the contract's "existing integration" does not exist. This repo does have a LINE Messaging push transport, owned by LINE OA Studio/Integration. | **DECIDED** (user via MC0 approval `apr_7b17e9cff91f`): use the LINE Messaging API push through the existing Zuri OA. Two inputs remain, both explicitly out of S6's authority: (1) the approved `recipients` list (`{kind: 'user' or 'group', id}`) — never guessed, never a real id in code or fixtures; (2) the real `transport` binding plus `credentialRef` (a NAME, never a token), owned by LINE OA Studio/Integration. Until both are supplied, `createLinePushReportNotifier(...)` returns the honest unavailable port (`CREDENTIAL_REF_NOT_CONFIGURED` / `RECIPIENT_NOT_CONFIGURED`) instead of guessing either one. The alert body (`domain/report-notification.js`) carries only brand name, a safe reason code from a closed allow-list, syncRunId and window — never a token, raw provider payload, customer data or provider error prose — and a retry key derived deterministically from `{syncRunId, failureKey}` so a repeated call for the same failure lands on LINE's own idempotency check instead of sending twice. | LINE OA Studio owner + Integration owner | DECIDED (B5); IMPLEMENTED against a stub transport — the real transport/credentialRef binding is still BLOCKED on those two owners | ports, report-notification, line-push-report-notifier |
| R-17 | §5 | ≤ 200 calls/hour/app "as currently configured elsewhere in the project" | contract §5 | Not found: no limiter or configuration for Meta exists in this repo | The configuration the contract refers to is not present | Keep 200/hour as the project safety cap and implement it once, in the Integration adapter, shared across workers | Integration owner | PROPOSED | — |
| R-18 | §7 UI | Brand selector, date range, tabs | contract §7 | Not built in this checkpoint | Where it goes: the approved Marketing navigation has Paid Media, Social and Analytics tabs ([navigation](../../change-requests/marketing/MARKETING-NAVIGATION-VIEWS.md)). The [channel contract](../../change-requests/marketing/MARKETING-CHANNEL-CONTRACTS.md) puts Meta Ads in Paid Media. | Put Insights at `/growth/insights`, linked from Analytics, and do not reshape Paid Media | Marketing owner | PROPOSED | — |

## Implementation decisions (PROPOSED)

- **D-01 Module placement:** `apps/server/src/modules/marketing/insights/{domain,ports,application}`
  holds all Insights code, so ownership can be claimed as one path. There is no new process and no service extraction.
- **D-02 Pure core:** Nothing in `domain/` imports Next, Prisma, `process.env`, n8n or an HTTP client. A test enforces this
  (`metric-catalog.test.js`, "no live request path").
- **D-03 Window semantics:** Dates are Asia/Bangkok calendar days, with both ends inclusive. The default is the 28 complete
  days ending yesterday. Today counts as a partial day. The comparison window is the same length immediately before. The maximum span is 93 days.
- **D-04 Aggregation:** Window totals are produced only for additive metrics with complete coverage and a single unit.
  Unique metrics need a provider aggregate for exactly that window. Organic + paid unique is never added together. Net follows is
  computed per day only when both inputs are observed.
- **D-05 Content semantics:** The cohort is `PUBLISHED_IN_WINDOW` and the numbers are `LIFETIME_AS_OF_SYNC`. Published is
  counted as unique content ids. Ranking is by views, then publishedAt descending, then contentId.
- **D-06 One asset per report:** A report covers exactly one binding. Several Pages of the same brand appear in the asset selector
  and are never summed.
- **D-07 Scope refusal shape:** Unknown brand, unreadable brand and foreign asset all return `404 SCOPE_NOT_FOUND`. A repository
  row outside the requested asset fails the whole read with `500 SCOPE_MISMATCH` and is never filtered out quietly.
- **D-08 URL safety:** Permalinks and thumbnails must be `https` on an allow-listed Meta host. The server never fetches them.
- **D-09 Notification adapter, credential and recipients stay separate (R-16, B5):** `createLinePushReportNotifier` takes an
  injected `transport` (never a URL or a client this module builds itself), a `credentialRef` NAME and a user-approved
  `recipients` list; any one missing returns the honest unavailable port rather than guessing. The alert body is built by a
  pure function from a closed reason-code allow-list plus brand/syncRunId/window only, and the LINE retry key is a
  deterministic hash of `{syncRunId, failureKey}` (RFC 4122 UUID v5) so a repeated call for the same failure relies on the
  provider's own idempotency instead of a second send.
- **D-10 The sync-orchestration core names no workflow engine (R-12, B4):** `SyncOrchestratorPort` and its four pure policies
  (refresh coalescing, retry, rate budget, schedule) are engine-agnostic by construction, not only by intent — the module's
  own static "no live request path" check (D-02) forbids the substring `n8n` anywhere under `insights/`, including inside a
  reason code, so `unavailableSyncOrchestratorPort()`'s default reason is `WORKFLOW_ENGINE_OWNER_UNASSIGNED`. This is a
  stronger reading of "make n8n pluggable later" than a docstring: the pure core cannot name the engine even if someone
  wanted it to. The coordination context's intended engine is n8n; that mapping lives in this document and in the handoff,
  never in source.

## Ports (versions are contract revisions, not FR ids)

| Port | Version | Provider owner | Consumer | State |
|---|---|---|---|---|
| InsightsRepository | v0 | Marketing (read model) over Integration raw evidence | Insights query service | Contract + fixture adapter; Postgres adapter BLOCKED on migration review |
| InsightBindingReadPort | v0 | Marketing binding table (proposed) using Integration `IntegrationConnection` | Insights query service | Contract + fixture; table BLOCKED |
| InsightScopeAuthority | v0 | Identity helpers (`seesBusiness`, `assertDomainVisible`) | brand scope | Implemented, no new role |
| MetaInsightsReadPort | v0 | Integration owner | sync writer | UNAVAILABLE `EXISTING_META_CLIENT_NOT_FOUND` |
| SyncOrchestratorPort | v0 | Integration / workflow-engine owner (the coordination context names n8n; this port does not) | refresh routes | Interface + four pure policies (coalescing, retry, rate budget, schedule) implemented and unit-tested against a fixture fake; engine-backed adapter UNAVAILABLE `WORKFLOW_ENGINE_OWNER_UNASSIGNED`. Supersedes the separate SyncRequestPort/SyncStatusReadPort split named in the original checkpoint. |
| ReportNotificationPort | v0 | LINE OA Studio / Integration | sync failure path | Adapter implemented (`createLinePushReportNotifier`) against an injected transport and a pure alert-text/retry-key core; unavailable with `CREDENTIAL_REF_NOT_CONFIGURED` or `RECIPIENT_NOT_CONFIGURED` until both are supplied by their owner. The real transport binding is still BLOCKED. |

No port accepts a Graph URL, a token or any credential material. There is no endpoint that executes an arbitrary Graph request.

## External references

- EXT-1 LINE Notify termination: https://developers.line.biz/en/news/2025/04/01/line-notify/ (cited by the master prompt)
- EXT-2 Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security (cited by the master prompt)
- EXT-3 Meta, "Deprecated Metrics — Facebook Pages API": https://developers.facebook.com/docs/platforminsights/page/deprecated-metrics/ (read 2026-09-24)
- EXT-4 Meta, "Page Insights API Updates" (2025-08-15): https://developers.facebook.com/blog/post/2025/08/15/page-insights-api-updates/ (read 2026-09-24)
