---
id: ZAI:FR-252-NOTE
title: Project Feature authority
feature: FR-252
domain: project-manager
source: v2-native
version: "0.6.0b"
status: beta
created_at: "2026-09-17T02:46:11+07:00,RWANG,approved e5ccfd7a"
last_update: "2026-09-17T20:28:51+07:00,RWANG final integrator"
relations:
  - type: references
    target: ZAI:FR-252
  - type: references
    target: ZAI:ADR-097
  - type: references
    target: ZAI:PM-PHASE-B-FEATURE-IMPLEMENTATION-PLAN
  - type: references
    target: ZAI:FR-251
---

# FR-252 — Project Feature authority

## Behavior and ownership

Owner approval on 2026-09-17 closes B1 for the exact Phase B packet in PR446 at
`e5ccfd7a8051cce551b95453b7435ac850f66d9d`. This note and ADR-097 supersede
that packet's historical pending-approval labels only; the selected behavior
is unchanged. Risk is HIGH, complexity C-3. Independent review, canonical
registration/governance and implementation tests remain distinct gates.

Project Manager owns Feature records, relationships, snapshot evidence and
typed receipts; Identity owns generic API-write CSRF. FR-251 remains a separate
read-only Domain projection and FR-250 remains navigation authority.

| Original owner-approved artifact | Version | SHA-256 |
|---|---|---|
| Plan 24 | 0.3.2b | 1d3899d9f9bfeb364f6cba17fad95ba432a95f4626213c7a29dec3173fc6ad0c |
| Phase B OpenAPI | 0.3.1b | be50cad5815f92c2a36e363674dc3aa48dac00c61d3fed49f4a8a7db096a9aa0 |
| Phase B data model | 0.2.1b | 068c9aeb79aa2dce0e5ef7cd8bfc3f85db695c21dc9f4d185ce9a61e3a96c2f4 |

## Input, output and failures

The [14-operation API](../../../architecture/project-manager-system/contracts/phase-b/openapi.candidate.json)
and [six-record contract](../../../architecture/project-manager-system/contracts/phase-b/data-model.candidate.json)
are the exact selected transport and persistence proposal. The Project-only UI
is `/projects/{projectId}/feature-view?featureId=UUID`; actual Next API folders
reuse `[id]`. Every read/write/replay validates the complete hierarchy before
loading Feature payloads. Body scope never grants authority.

Mutations use session-bound CSRF, exact Origin, scoped idempotency and CAS;
resource changes, receipt and one AuditEvent commit atomically. Receipt target
and resource discriminators remain distinct. Restore uses deletion batches,
preserves identities/lifecycle and refuses allocation overflow. Aggregate
snapshot stays null/UNAVAILABLE; verified per-record pins carry evidence.
Validation/refusal status, DTO bounds and signed pagination follow the API.

## Delivery slices and acceptance criteria

| Slice | Domain and approved waves | Entry and exit |
|---|---|---|
| [FR-252-P1](PHASE-FR-252-P1-feature-persistence.md) | Project Manager; W1/W2 | B1/B2 and independent review before schema; additive adapter parity and protected restore tests before writers. |
| [FR-252-P2](../../identity/features/PHASE-FR-252-P2-api-write-csrf.md) | Identity; CSRF dependency of W4 | Frozen issuer/verifier contract; issuance, live-session binding, exact Origin and refusal tests. |
| [FR-252-P3](PHASE-FR-252-P3-feature-api.md) | Project Manager; W3/W4 | P1 ports; mutation admission also requires P2. Scope-first reads, graph/allocation races, snapshot proof, CAS/idempotency/audit tests. |
| [FR-252-P4](PHASE-FR-252-P4-feature-ui-and-final-gate.md) | Project Manager UI; W3/W5/W6/W7 | Frozen DTOs allow UI/read work in parallel; full forms follow writers; independent verify and root integration close delivery. |

Acceptance additionally proves no inferred Feature rows, the 200-row bound,
WorkItem deduplication, unchanged weighted progress, same-scope dependencies,
redacted refusal and stale-state clearing, safe legacy restore, navigation
reachability, keyboard interaction and 390px readability. Machine schema checks
do not replace application or database tests.

## Current evidence and entry gates

B1 and B2 are closed. Independent Luna Max entry review passed the corrected
packet at bd99651f (plan24 v0.3.3b, API v0.3.3b, data v0.2.3b); its mechanical
proof includes 33 DTO cases and three rendered diagrams. Documentation merged
in PR446 at 9ad61f8a after required hosted governance, tests, build and Edge
checks passed. Browser/desktop jobs were skipped by that PR's policy.

Implementation has started in an isolated worktree. Identity P2 has 64 focused
passing tests and independent implementation PASS, including real Prisma/session
composition and the reproduced malformed-cookie correction. The final composed
suite passes 67 tests across eight files and the optimized build passes.
Feature schema, service/API and UI are not delivered by the Identity slice.
W1's exact policy review passed, including coupled receipt tuples and optional
same-Project snapshot pins. Schema parity and three SQLite/schema tests pass;
the provider migration passes 129 actual isolated non-bypass-role checks and
11 catalog/grant collision checks, followed by independent Luna Max PASS.
Those W1 proofs are database-only. Decision26's offline clean-target recovery
and reviewed PM field erasure were both approved on 2026-09-17. W2 is composed
with the existing CRM legal-hold release and independently passes repository,
Identity and recovery review. The complete Server suite passes 6066 tests with
32 skipped; optimized build, governance (zero CRITICAL) and 32 navigation/Domain
browser cases pass. Actual PostgreSQL adapter proof passes 13 checks; the actual
offline CLI passes 18 standard and 11 adversarial checks with unchanged source
bytes during execution. These overlapping local proofs are not production
evidence. P1 hands the frozen ports to W3 for parallel read/API and UI work.
The peer CRM hold serialization finding is closed by the separately approved
implementation and independent synthetic-provider proof below.
Production still requires the actual runtime-role isolation gate in ADR-097.
No Phase B production delivery or database migration is claimed.

### Composed W3-W5 evidence

The integration tree combines the local W1/W2 commit `052821a7` with main
`892f23f3`, preserving Pricing and LINE changes. The composed schema has 177
models; fresh isolated recovery proof passes 22 standard and 15 adversarial
checks. The earlier 175-model proof remains historical and cannot authorize a
restore into the new schema.

W3 list/detail browser checks pass 21 cases with zero flaky outcomes after
the recorded rendering/locator corrections. Actual PostgreSQL reads pass 18
checks. W4's expanded independent PostgreSQL proof passes 19 checks, including
separately observed Session/Membership/PlatformGrant lock waits, Session and
actual SUPERADMIN-only grant expiry, competing CAS writers, graph allocations
and audit rollback. Authorization uses the clock after lock acquisition.
These synthetic non-bypass-role checks do not prove production grants.

The current composed security/API/read/provenance/Swagger suite passes 111 tests
across twelve files, with another eleven Identity regression tests in two files
(122 total). It covers actual bound Git commits, unavailable source handling,
the default capture-to-Feature-to-requirement evidence path, and a reproduced
rollback/replay result correction. Snapshot capture returns the committed
resource named by its receipt. The runtime Swagger inventory has 308 paths and
411 operations; the selected Phase B contract remains 14 operations.

The owner separately approved the narrow CRM hold/audit transaction and shared
Customer-lock closure. Its focused suite passes 21 cases; independent PostgreSQL
proof passes fourteen checks with frozen source, including stale Serializable
rollback, actual Identity-service rollback and unchanged logical Customer fields.
Known lock/serialization conflicts retain the existing retryable 503 envelope.

The final full composed Server suite passes 6376 tests with 32 skips and the
optimized build passes on the final implementation. Source comparison confirms
2266 source/test/schema/configuration files remained unchanged across the suite.
Owner forms and the independent Luna Max source review pass; focused UI coverage
passes 25/25. Browser evidence is 45 passing checks plus two passing privacy
rechecks after one test-only locator correction (one recheck overlaps the
previous pass). The earlier 45-pass/one-failure run remains recorded as FAIL.
Product code is identical across those runs, with zero skips/flaky outcomes.
The full Server suite and optimized build pass on that product source.
The [integration report](../../../../.brain/reports/2026-09-17-project-feature-phase-b.md)
retains portable provider proofs and current gate results. Hosted CI and
production remain distinct gates. No Phase B implementation revision has been
deployed.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.6.0b | 2026-09-17 | beta | Record native implementation, independent owner-form source PASS and final 6376-test/build proof; retain browser and hosted release boundaries | 052821a7 + 892f23f3 | RWANG |
| 0.5.1b | 2026-09-17 | beta | Close independently verified CRM and authority-clock findings; record 122 current focused tests, historical full Server/build pass and remaining UI/release gates | 052821a7 + 892f23f3 | RWANG |
| 0.5.0b | 2026-09-17 | beta | Record composed 177-model recovery, W3/W4 provider proofs and W5 API/provenance tests; retain owner UI, CRM race and final release gates | 052821a7 + 892f23f3 | RWANG |
| 0.4.0b | 2026-09-17 | beta | Record W2 independent/root local PASS and full Server/build/browser/CLI evidence; authorize frozen-port W3 handoff | bd99651f | RWANG |
| 0.3.0b | 2026-09-17 | beta | Record both W2 approvals and first local composition proofs; keep complete W2/release gates open | bd99651f | RWANG |
| 0.2.1b | 2026-09-17 | beta | Record 67 composed tests, optimized build and W1 independent PASS; expose the W2 snapshot-coverage blocker | bd99651f | RWANG |
| 0.2.0b | 2026-09-17 | beta | Record merged design/entry PASS and local Identity progress; retain persistence, restore and production gates | bd99651f | RWANG |
| 0.1.0b | 2026-09-17 | beta | Register approved Feature authority and ordered cross-domain implementation slices | e5ccfd7a | RWANG |
