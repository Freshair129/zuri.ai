---
id: ZAI:MARKET-INTELLIGENCE-HANDOFF
version: "0.1.0b"
status: candidate
last_update: "2026-09-24T08:30:00+07:00,Claude"
attributes:
  domain: market-intelligence
  scope: market-intelligence-extraction-checkpoint
relations:
  - type: relates_to
    target: ZAI:ADR-038
  - type: relates_to
    target: ZAI:FR-092
---

# Market Intelligence extraction handoff (Session 4)

**Checkpoint state:** M0 discovery done, M1 pure core + isolated tests done. Nothing
executes in the new package yet: `apps/server` still runs every Market request. No
extraction, integration or release claim is made.

## Provenance

- Repository: `Freshair129/zuri.ai`
- Branch: `feat/market-intelligence-service` (worktree `.claude/worktrees/market-intelligence-service`)
- Base SHA: `fad8ec6252941ca3de01afdb3116484f86b366c3` (`origin/main` on 2026-09-24)
- Code head SHA: the commit that adds this file (no earlier implementation commit exists)
- PR: none yet
- Existing work checked first: no Market branch, PR or handoff existed. Session 1
  (`codex/conversation-runtime-service`, PR #542) and Session 3 (local worktree
  `codex/file-management-service`, uncommitted ADR-107) were read, not modified.
- Not read or touched: production `.env`, production DB, Edge repo, MSP/GKS repos,
  legacy zuri. No deploy, migration, provider call or live model call.

## Governing decision found in M0 — ADR-038 D8 blocks M2 as written

[ADR-038](../../decisions/ADR-038-MARKET-INTELLIGENCE-DOMAIN-BOUNDARY.md) D8 says a
Market worker process is an execution topology, not a microservice boundary. It also
says extraction to a service requires a real operational trigger (independent load,
deployment cadence, security/compliance, availability or ownership). The
[charter](../../domains/market-intelligence/CHARTER.md) repeats this: *"A worker is not
an independently owned service."*

M1 does not conflict with D8. It moves code within one codebase and release; nothing
runs separately. **M2 (its own process, owned persistence, network API) does conflict.**
It needs a new accepted ADR that amends or supersedes D8 and names the operational
trigger. Session 1 did the same for its service (ADR-106, still unmerged). Only the
owner can make this decision. Session 4 has not allocated an ADR number: ADR-106 is
held by Session 1's PR and ADR-107 by Session 3's local worktree.

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
| Persistence (`insertIfAbsent` / `listRecent` / `findTranslatedRawRecordIds`) | apps/server Prisma adapter | Market (`MarketObservation`, unique `lineageKey`, **no FK relations**) | feed, run | service-owned adapter | M2 — **blocked by the D8 gate** | legacy tests only |
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

## Verification

| Axis | Result | Evidence |
|---|---|---|
| CODE_IMPLEMENTED | PARTIAL | M1 core only; no process, persistence adapter or façade |
| ISOLATED_TESTS_VERIFIED | PASS | `npm --prefix services/market-intelligence test`: 51 pass / 0 fail / 0 skipped, Node 24.19.0, Windows 11, local |
| Boundary build | PASS | `npm --prefix services/market-intelligence run build`: 8 source files, no violation |
| Legacy parity | PASS | `npx vitest run tests/unit/market-intelligence/service-core-parity.test.js` (apps/server): 10 pass |
| Legacy Market baseline (before change) | PASS | 23 files / 130 tests at `fad8ec62` |
| CONTRACT_VERIFIED | NOT_RUN | ports are a proposal; in-memory fakes only, and the "concurrent runs" test is single-threaded fake proof, not DB race proof |
| CONSUMER_INTEGRATION_VERIFIED | NOT_RUN | routes still call the legacy module |
| DATA_OWNERSHIP_ENFORCED | NOT_RUN | no service persistence exists |
| IMAGE_BUILD_VERIFIED / IMAGE_START_VERIFIED | NOT_APPLICABLE at M1 | no process yet |
| CI_VERIFIED | NOT_RUN | no PR; CI does not run the service package yet (shared patch below) |
| PRODUCTION_CUTOVER | NOT_RUN | not authorized |

## Contracts

| Contract | Provider owner | Consumer | Revision | State |
|---|---|---|---|---|
| ScopeAuthorityPort | Identity / core integrator | Session 4 | `src/ports/contracts.js` at this commit | PROPOSED |
| RawEvidenceReadPort | Integration owner | Session 4 | same | PROPOSED |
| AuditPort | project-manager audit owner | Session 4 | same | PROPOSED |
| KnowledgeIdentityReadPort (optional) | Knowledge read owner | Session 4 | same | PROPOSED; existing in-process reader shape |
| Market API (feed + translation run) | Session 4 | `/market` BFF | legacy shape, feed version 1.0 | preserved by parity vectors |
| translation-vectors v1 | Session 4 | apps/server legacy module | `contracts/v1/translation-vectors.json` | PASS on both sides |

## Blockers

```yaml
- dependency: accepted ADR amending ADR-038 D8 for a separately running Market service
  kind: HARD_START
  phase_blocked: M2
  owner_to_unblock: owner (Boss) + ADR id allocation via the integrator
  condition_to_unblock: accepted ADR naming the operational trigger, the runtime shape and data ownership
  evidence: [docs/decisions/ADR-038-MARKET-INTELLIGENCE-DOMAIN-BOUNDARY.md D8, docs/domains/market-intelligence/CHARTER.md "Runtime topology"]
  safe_work_now: [M1 hardening, contract review, M3 façade design as a proposal]
- dependency: reviewed ScopeAuthority / RawEvidenceRead / Audit contracts (Gate MARKET)
  kind: CONTRACT
  phase_blocked: M3
  owner_to_unblock: Identity + Integration + audit owners, with Session 1 as integrator
  condition_to_unblock: reviewed revision + provider conformance run against the fakes' semantics
  evidence: [services/market-intelligence/src/ports/contracts.js]
  safe_work_now: [M1, fake conformance]
- dependency: governance scanners, CI job and root scripts include services/market-intelligence
  kind: INTEGRATION_ORDER
  phase_blocked: CI_VERIFIED
  owner_to_unblock: integrator (Session 1 by default)
  condition_to_unblock: shared patch merged (see below)
  evidence: [PR #542 adds the same wiring for services/conversation-runtime only]
  safe_work_now: [local test/build]
```

## Shared changes requested from the integrator (not made on this branch)

These files are Session 1's integration surface in PR #542. Editing them here would
create conflicts:

- `apps/server/scripts/doc-graph.mjs` and `doc-preflight.mjs`: scan
  `services/market-intelligence/{src,test,contracts}` the same way #542 scans
  `services/conversation-runtime`. Generalizing to every `services/*` is preferable.
- `apps/server/scripts/workspace-path.mjs`: `services` as a shared root (already in #542).
- `.github/workflows/governance.yml`: a `market-intelligence` job (`npm ci`, `test`,
  `build`) that feeds the `verify` aggregate. It must also make the server `tests` job
  able to read `services/market-intelligence/contracts/`, which a full checkout already does.
- Root `package.json`: `market-intelligence:test` / `market-intelligence:build`.

## Next exact action

1. Owner: decide the D8 question (a new ADR for a separately running service, or
   keep Market in-process and stop at a shared-core package).
2. Integrator: land the scanner/CI wiring above, or ask Session 4 for a standalone
   shared-patch PR.
3. Session 4, once D8 is decided: M2 service-local runtime with owned persistence
   (`MarketObservation`, no FKs, so a same-DB restricted-role transition is feasible),
   and meanwhile M3 façade proposals for the three core ports.

```yaml
session: S4
workstream: market-intelligence
observed_at: "2026-09-24T08:30:00+07:00"
base_sha: fad8ec6252941ca3de01afdb3116484f86b366c3
code_head_sha: null   # the commit adding this file; see git log
branch: feat/market-intelligence-service
pr_number: null
current_tranche: M1
execution_status: PARTIAL
merge_status: NOT_MERGED
production_status: NOT_RUN
board_update: PENDING
```
