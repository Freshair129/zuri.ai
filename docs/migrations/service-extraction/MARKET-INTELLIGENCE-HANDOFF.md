---
id: ZAI:MARKET-INTELLIGENCE-HANDOFF
version: "0.2.0b"
status: candidate
last_update: "2026-09-24T10:00:00+07:00,Claude"
attributes:
  domain: market-intelligence
  scope: market-intelligence-extraction-checkpoint
relations:
  - type: relates_to
    target: ZAI:ADR-038
  - type: relates_to
    target: ZAI:FR-092
  - type: relates_to
    target: ZAI:ADR-108
---

# Market Intelligence extraction handoff (Session 4)

**Checkpoint state:** M2 service-local runtime done (2026-09-24). The Market service
runs as its own process with an owned Postgres/SQLite store, and a real workflow
through its started image is proven. **Nothing routes to it yet:** `apps/server`
still executes every production Market request, and core's façade routes (M3) do not
exist. No extraction-complete, integration or release claim is made.

## Provenance

- Repository: `Freshair129/zuri.ai`
- Branch: `feat/market-intelligence-service` (worktree `.claude/worktrees/market-intelligence-service`)
- Base SHA: `fad8ec6252941ca3de01afdb3116484f86b366c3` (`origin/main` on 2026-09-24)
- Commits: M1 `d40a3329`; M2 is the commit that adds this revision (see `git log`)
- PR: none yet
- Existing work checked first: no Market branch, PR or handoff existed. Session 1
  (`codex/conversation-runtime-service`, PR #542) and Session 3 (local worktree
  `codex/file-management-service`, uncommitted ADR-107) were read, not modified.
- Not read or touched: production `.env`, production DB, Edge repo, MSP/GKS repos,
  legacy zuri. No deploy, migration, provider call or live model call.

## Governing decision — resolved by ADR-108

M0 found that [ADR-038](../../decisions/ADR-038-MARKET-INTELLIGENCE-DOMAIN-BOUNDARY.md)
D8 blocked a separately running Market service without an operational trigger. On
2026-09-24 the owner chose **ownership** and delegated the remaining decisions for
this lane to Claude Fable 5.1. The rulings are recorded in
[ADR-108](../../decisions/ADR-108-MARKET-INTELLIGENCE-SERVICE-EXTRACTION.md), which is
pinned in `docs/.id-ledger.json`. When this branch and Session 1's PR (which pins
ADR-106) both land, the ledger needs a trivial merge: two independent additions.

## M0 — capability inventory at `fad8ec62`

"Runtime caller" was established by searching `src/` and `scripts/`, not from folder
names.

| Capability | Current executor | Data owner | Runtime consumers | Target | Decision | Proof |
|---|---|---|---|---|---|---|
| Raw → observation draft (`translate-raw-record.js`) | apps/server, via `POST /api/market/translations` | Market (logic) | translation run | service core | MOVE — copied in M1; legacy copy deleted at M3 | vectors pass in both copies |
| Generic candidate extractor | apps/server | Market | translation route | service core | MOVE — copied | vectors |
| `MarketObservation` draft schema | apps/server | Market | translator, repository | service core | MOVE — copied | `test/domain.test.js` + vectors |
| Observation feed (`GET /api/market/observations`) | Next route → service fn | Market | `MarketDashboard` (`/market`) | service core behind a BFF | MOVE core (M1); route becomes a thin ADAPTER at M3 | `test/observation-feed.test.js` + feed-row vectors |
| Translation run (`POST /api/market/translations`) | Next route → service fn | writes Market; reads Integration; appends PM audit | `MarketDashboard` button | service core | MOVE core (M1); route becomes an ADAPTER at M3 | `test/translation-run.test.js` |
| Persistence (`insertIfAbsent` / `listRecent` / `findTranslatedRawRecordIds`) | apps/server Prisma adapter | Market (`MarketObservation`, unique `lineageKey`, **no FK relations**) | feed, run | service-owned adapter | MOVE — M2 pg + sqlite adapters (ADR-108 D2/D3); legacy Prisma writer remains until the M3 flag | shared conformance suite on both engines |
| Scope authority (`seesBusiness`, `ownsBusiness`, `assertDomainVisible`, Business lookup) | Identity, in-process | Identity | feed, run | `ScopeAuthorityPort` → core façade | KEEP in core; ADAPTER | fake conformance only |
| Raw candidate read (`listMarketLaneRawRecordCandidates` reads `rawExternalRecord` directly) | Market infra reading Integration's table | Integration | run | `RawEvidenceReadPort` → Integration façade | SHARED-TRANSITION | none yet |
| Audit (`recordAudit`, project-manager) | PM, in-process | PM audit | run | `AuditPort` | KEEP owner; ADAPTER | fake only |
| Knowledge identity resolver (`gks-market-identity-resolver.js`) | **no runtime caller**: the route leaves `knowledgeResolver` unset, so every production row is UNRESOLVED | Knowledge | none | optional `KnowledgeIdentityReadPort` | copied as `knowledge-identity-resolver.js`; OPTIONAL | resolver tests |
| `createMarketRawRecordRepository`, `loadTranslateAndPersistRawMarketRecord` | **no runtime caller** (tests only) | — | none | — | not moved; recorded as unused | — |
| `market-research`, `price-intelligence`, `procurement-recommendation`, `supplier-intelligence` services and the `market-signals`, `market-research`, `price-observation`, `supplier-candidate`, `watch-rule` domain files | **no runtime caller** (tests only) | — | none | — | NOT MOVED: planned concepts, not delivered features | — |
| `/market` page + `MarketDashboard` | Next | UI | users | stays in the console as BFF/UI | KEEP | existing render test |
| Backup/restore of `marketObservation` | `project-manager/application/backup-service.js` | PM backup | backup, restore | consumer inventory | must keep reading the table until a data-ownership migration | existing backup tests |
| Agent tools `record_market_observation`, `query_market_prices` | only named in `identity/agent-tool-authorizer.js` | — | **no implementation found** | — | UNKNOWN intent; not moved | — |
| Erasure | no erasure code names `MarketObservation` | — | — | — | UNKNOWN whether tenant erasure covers the table; needs owner check before any data move | — |

Findings for owners (no semantics were changed):

1. **The GKS resolver never runs in production.** Every translated row is UNRESOLVED
   because the route does not wire a reader. This matches the route's own comment. It
   is recorded here because the prompt lists resolution as an existing capability.
2. **The candidate filter uses `rawRecordId`, not `lineageKey`.** This is correct only
   while `translationSchemaVersion` and the extractor's type mapping stay fixed, as
   the repository comment says. After a schema-version bump, already-translated raw
   records would be skipped instead of re-translated under the new version. Not a
   bug today, but a trap for any M4 replay/version work. It is covered by the note
   in `write-vectors.mjs`: bump the version whenever vectors change.
3. **An audit failure after writes returns 500 while the observations stay committed.**
   A retry is idempotent through `lineageKey`, so no data is duplicated, but the audit
   event for that run is lost. This is an M4 durable-audit item and is pinned by a test.

## M1 — what was implemented

`services/market-intelligence/` is a Node ≥22 ESM package. Its only dependency is
`zod@3.23.8`, the same version apps/server uses.

- `src/domain/market-observation.js`, `src/core/translate-raw-record.js`,
  `src/core/generic-candidate-extractor.js`, `src/core/knowledge-identity-resolver.js`:
  moved verbatim from apps/server (only import extensions and headers changed).
- `src/core/observation-feed.js`, `src/core/translation-run.js`: ports of the two
  application functions. Same limits, same response shapes, same refusal statuses.
  Identity, the Business lookup, Integration raw reads and PM audit are now **ports**,
  not imports.
- `src/ports/contracts.js`: proposed `ScopeAuthorityPort`, `RawEvidenceReadPort`,
  `ObservationStore`, `AuditPort`, `KnowledgeIdentityReadPort` semantics, plus
  `authorizeScope`, which treats a malformed authority answer as a fault, never as
  an allow.
- One deliberate tightening: the run re-checks every raw candidate against the
  authorized tenant, Business and lane, and refuses a mismatch per record
  (`RAW_EVIDENCE_SCOPE_MISMATCH`). The legacy code trusted the query's `where`
  clause; across a process boundary that trust becomes a confused-deputy risk.
- `scripts/build.mjs`: boundary scan. It fails on imports of apps/server, Next,
  Prisma or a foreign domain, on undeclared packages, and on `process.env` or I/O
  modules in `src/core`, `src/domain` and `src/ports`.
- `contracts/v1/translation-vectors.json` (written by `scripts/write-vectors.mjs`):
  8 translation and 5 feed-row golden vectors. Replayed by the service's
  `test/parity-vectors.test.js` **and** by apps/server's
  `tests/unit/market-intelligence/service-core-parity.test.js`, so the two copies
  cannot drift silently. Only the JSON file crosses the app boundary; the server
  image is unaffected.

## M2 — what was implemented (ADR-108 D2–D7)

- `src/adapters/observation-schema.js`: one column list for both adapters, and
  Postgres DDL used **only** for disposable databases. `test/ddl-parity.test.js`
  pins it to `apps/server/supabase/migrations/20260820080000_market_observation.sql`
  and to the generated `schema.postgres.prisma` model.
- `src/adapters/pg-observation-store.js`: the production store.
  `INSERT … ON CONFLICT ("lineageKey") DO NOTHING RETURNING *` makes creation atomic.
  Timestamps are written and parsed as UTC, and it never runs DDL outside
  `ensureTestSchema({ disposable: true })`.
- `src/adapters/sqlite-observation-store.js`: the dev/test store (`node:sqlite`, WAL,
  busy timeout). It is lazy-loaded, so a production process never imports it.
- `test/store-conformance.js`: the shared ObservationStore contract, run by both
  adapters. It includes a race of 8 inserts from separate connections (worker threads
  for SQLite, separate pools for Postgres) and a cross-scope lineage collision treated
  as a fault.
- `src/adapters/core-client.js`: HTTP adapter for ScopeAuthority, RawEvidenceRead,
  Audit, execution ownership and health against
  `/api/internal/market-intelligence/v1/*` (`market-core.v1` envelope). It sends the
  service bearer token plus the opaque `x-zuri-subject` header, fails closed with 503
  `CORE_UNAVAILABLE`, retries only reads (bounded and jittered), and never retries audit.
- `src/http/server.js`: `/healthz`, `/readyz` (deps named, and never ready on a fake
  core in production), `GET /v1/observations`, `POST /v1/translations` (64 KiB cap,
  strict schema, 409 `MARKET_NOT_EXECUTION_OWNER` unless core grants execution). The
  legacy `{ error, issues? }` bodies are kept, and the server drains on close.
- `src/config.js` + `src/main.js`: env-only configuration. Production refuses sqlite,
  schema creation, assumed ownership and a non-private plain-http core. SIGTERM drains.
- `Dockerfile` + `Dockerfile.dockerignore`: `node:22-alpine`, copies only this package,
  `npm ci --omit=dev` (pg, zod), no mounts, no `next build`.
- `compose.rehearsal.yml`: a separate Compose project `zuri-market-rehearsal`
  (disposable Postgres, fake core, loopback port 38082). `test/compose-guard.test.js`
  fails if it could ever resolve to `zuri-ai`, join its network or mount source.
- `test/support/fake-core.js`: the fake of core's M3 façade, announcing
  `mode: "fake"`.
- `docs/decisions/ADR-108-…md` + ledger pin.

Behaviour differences from legacy, all deliberate:

1. When the audit owner is unreachable after the writes, the service answers
   **503 `CORE_UNAVAILABLE`**, where legacy answers 500. In both, the observations
   stay committed and replay is idempotent.
2. The service refuses translation writes unless core says it owns execution
   (ADR-108 D6).
3. Raw candidates outside the authorized scope or lane are refused per record
   (introduced in M1).

## Verification

Environment: Windows 11 Pro, Node 24.19.0 (host), `node:22-alpine` (image), Docker
29.8.0, `postgres:16-alpine`. Source: the commit that adds this revision (M2 code and
this handoff are committed together).

| Axis | Result | Evidence |
|---|---|---|
| CODE_IMPLEMENTED | PARTIAL | M2 complete; M3 façades/BFF flag, M4 not started |
| ISOLATED_TESTS_VERIFIED | PASS | `npm --prefix services/market-intelligence test`: 95 tests, 94 pass, 0 fail, 1 skipped (the Postgres suite, reported `NOT_RUN: MARKET_TEST_PG_URL is unset`, because it runs separately below) |
| Postgres conformance | PASS | `npm --prefix services/market-intelligence run test:pg`: disposable `postgres:16-alpine` container, 10/10 including the 8-connection lineage race; container removed afterwards |
| SQLite conformance | PASS | included above: 10/10 including the 8-thread race |
| Boundary build | PASS | `npm --prefix services/market-intelligence run build`: 15 source files, no violation |
| Legacy parity | PASS | apps/server `service-core-parity.test.js` 10/10; service `parity-vectors` and HTTP-level parity (service-translated rows equal the v1 vectors) |
| Legacy Market suite | PASS | apps/server Market unit + integration + parity: 140 tests (M1 run; no apps/server code changed in M2) |
| CONTRACT_VERIFIED | PARTIAL | consumer side proven against a conformant **fake** core over real HTTP; no real provider exists until M3 |
| CONSUMER_INTEGRATION_VERIFIED | NOT_RUN | the Next routes still call the legacy module (flag is M3) |
| DATA_OWNERSHIP_ENFORCED | PARTIAL | the service writes only `"MarketObservation"` through its own adapter; the restricted role is **not applied**, and legacy still writes the same table |
| IMAGE_BUILD_VERIFIED | PASS | `docker compose -f services/market-intelligence/compose.rehearsal.yml up -d --build --wait` |
| IMAGE_START_VERIFIED | PASS | through the started container: `/readyz` → `{"ready":true,"deps":{"store":"postgres","core":"fake"}}`; POST translation → `{"translated":1}`, replay → `{"translated":0}`; feed returned the row; `psql` showed 1 row `raw-rehearsal-1`; SIGTERM logged draining → stopped, exit 0; stack removed; the live `zuri-ai` containers were untouched |
| CI_VERIFIED | NOT_RUN | CI does not run the service yet (shared patch requested) |
| PRODUCTION_CUTOVER | NOT_RUN | not authorized |

## Contracts

| Contract | Provider owner | Consumer | Revision | State |
|---|---|---|---|---|
| `market-core.v1` façade: authorize / raw-candidates / audit / execution-ownership / health | core integrator (Session 1) with Identity, Integration, audit owners | Session 4 | `src/adapters/core-client.js` + `test/support/fake-core.js` at this commit | PROPOSED; consumer proven against the fake; provider NOT_RUN |
| Market service API v1 (`/v1/observations`, `/v1/translations`) | Session 4 | console BFF (M3) | `src/http/server.js` at this commit | provider tested; consumer NOT_RUN |
| ObservationStore | Session 4 | Market core | `test/store-conformance.js` | PASS on sqlite and postgres |
| translation-vectors v1 | Session 4 | apps/server legacy module | `contracts/v1/translation-vectors.json` | PASS on both sides and at the HTTP level |

## Blockers

```yaml
- dependency: core façade routes /api/internal/market-intelligence/v1/* (market-core.v1)
  kind: CONTRACT
  phase_blocked: M3
  owner_to_unblock: integrator (Session 1) + Identity/Integration/audit owners; Session 4 can draft the routes as a separate shared-patch PR on request
  condition_to_unblock: reviewed routes passing the same scenarios test/support/fake-core.js encodes (refusal statuses, subject re-check on raw-candidates, envelope shape)
  evidence: [services/market-intelligence/src/adapters/core-client.js, services/market-intelligence/test/http-api.test.js]
  safe_work_now: [M4 durable-audit design, BFF flag patch on the two Market-owned routes]
- dependency: restricted DB role zuri_market_service + RLS policy
  kind: HARD_START
  phase_blocked: cutover (and M4 rehearsal on production-like data)
  owner_to_unblock: operator (ADR-057)
  condition_to_unblock: runbook in ADR-108 applied and verified
  evidence: [docs/decisions/ADR-108-MARKET-INTELLIGENCE-SERVICE-EXTRACTION.md]
  safe_work_now: [everything before cutover]
- dependency: governance scanners, CI job and root scripts include services/market-intelligence
  kind: INTEGRATION_ORDER
  phase_blocked: CI_VERIFIED
  owner_to_unblock: integrator (Session 1 by default)
  condition_to_unblock: shared patch merged (see below)
  evidence: [PR #542 adds the same wiring for services/conversation-runtime only]
  safe_work_now: [local test/build/test:pg/rehearsal]
```

## Shared changes requested from the integrator (not made on this branch)

- `apps/server/scripts/doc-graph.mjs` and `doc-preflight.mjs`: scan
  `services/market-intelligence/{src,test,contracts}` as #542 does for
  `services/conversation-runtime`. Generalizing to every `services/*` is preferable.
- `apps/server/scripts/workspace-path.mjs`: `services` as a shared root (already in #542).
- `.github/workflows/governance.yml`: a `market-intelligence` job that feeds `verify`.
  It should run `npm ci --prefix services/market-intelligence`, `npm test`,
  `npm run build`, `npm run test:pg` (Docker is available on ubuntu-latest) and
  `docker build -f services/market-intelligence/Dockerfile .`.
- Root `package.json`: `market-intelligence:test` / `market-intelligence:build`.
- `docs/.id-ledger.json`: merge ADR-106 (Session 1) and ADR-108 (this branch), which
  are independent additions.

## Board delta (for the integrator to paste into REFACTOR-STATUS.md)

The board stays at snapshot 0.1 on this branch because it belongs to the integrator.
Replacement row for §1:

```text
| **Market Intelligence — Session 4** | **PARTIAL / M2 DONE**; ADR-108 (ownership trigger); standalone process + pg/sqlite stores (shared conformance, 8-connection race) + image-start rehearsal PASS; branch feat/market-intelligence-service, draft PR | Nothing routes to the service; core façade /api/internal/market-intelligence/v1/* absent; MARKET_EXECUTOR flag (M3a) in progress; restricted DB role not applied; CI not wired | M3a on branch; M3b façade offered to integrator as a separate draft PR; Gate MARKET = façade review + provider conformance |
```

Replacement §3 Session 4 tranche statuses: M0 DONE, M1 DONE, M2 DONE, M3 IN_PROGRESS
(flag on this branch; façade waiting on the integrator), M4 NOT_STARTED, M5 NOT_STARTED.

## Next exact action

1. Integrator: land the scanner/CI wiring and decide who writes the core façade
   routes (Session 4 can draft them as a separate shared-patch PR).
2. Session 4, M3: the `MARKET_EXECUTOR` flag in `apps/server/src/app/api/market/*`
   (Market-owned routes), a BFF client for the service API, and provider conformance
   once the façade exists.
3. Session 4, M4: a durable audit handoff (with the audit owner's review), a replay
   and schema-version rehearsal (see finding 2), and a revoke/redaction path.

```yaml
session: S4
workstream: market-intelligence
observed_at: "2026-09-24T10:00:00+07:00"
base_sha: fad8ec6252941ca3de01afdb3116484f86b366c3
m1_commit: d40a3329
code_head_sha: null   # the commit adding this revision; see git log
branch: feat/market-intelligence-service
pr_number: null
current_tranche: M2
execution_status: PARTIAL
merge_status: NOT_MERGED
production_status: NOT_RUN
board_update: PENDING
```
