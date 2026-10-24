---
id: ZAI:PM-PIPELINE-PLAN-20261023
title: Project Manager Pipeline Builder implementation plan
doc_type: implementation-plan
status: approved
version: "0.1.6"
approved_at: "2026-10-23"
approved_plan_commit: "c291afcd601a9036a0f188656b96a233c20d4979"
source_revision: "e1014247b01cd42bca589e679c840d2c2c8f2857"
relations:
  - type: references
    target: ZAI:PM-DOMAIN-SRS
  - type: references
    target: ZAI:FEAT-007
  - type: references
    target: ZAI:ADR-035
---

# Project Manager Pipeline Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After exact contract adoption, join Structure Plan, Dependency Map and Board through persisted handoff obligations and accessible editing.

**Architecture:** Add the nullable Dependency contract described by FR-084 and reuse the existing PM import/authorization/audit lane. Keep graph layout derived and server enforcement authoritative. Owner-approved C0 v0.1.5 and the reconciled ADR-035 authorize the shared foundation. C1 is merged; C2 is qualified in open PR740; the owner selected C3. C4 remains a later increment.

**Tech Stack:** Existing React components, Zod/JSON Schema, PM import/services, Prisma adapters, Vitest and Playwright; no drag library or graph service is selected.

**Spec:** [Approved linked SRS](../domains/project-manager/SRS.md), [FEAT-007](../features/FEAT-007/feature.md), [FR-082](../features/FEAT-007/requirements/FR-082.md), [FR-083](../features/FEAT-007/requirements/FR-083.md), [FR-084](../features/FEAT-007/requirements/FR-084.md), [FR-085](../features/FEAT-007/requirements/FR-085.md), [ADR-035](../decisions/ADR-035-DIRECT-MANIPULATION-PIPELINE-CANVAS.md), [UX note](../domains/project-manager/features/FR-082-pipeline-canvas.md).

## Global Constraints

All [master constraints](PROJECT-MANAGER-IMPLEMENTATION-20261023.md#global-constraints)
apply. Additional controlling sources are [BR-017](../requirements/BR-017.md),
[SDD-046](../requirements/SDD-046.md) and [NFR-008](../requirements/NFR-008.md).
Only registered Project-contained work is shown on the Project canvas; the
existing global dependency register retains cross-Project CRUD authority.
Existing undeclared rows remain visibly undeclared and do not gain retroactive
holds. New edge writes require declared contracts after the adopted activation.
Preview is read-only; commit, idempotency and audit are transactional.

## Review Focus

Cross-Project endpoint leakage, opposing edge/cycle races, stale preview and
undo, incompatible reparenting, and drag-only interactions are owned by C0–C4.
Non-ordering dependency types and non-WorkItem endpoints require an adopted
release truth table; the executor cannot guess their blocking meaning.

**Adoption update (2026-10-24):** owner accepted exact C0 v0.1.5 D1–D6 at
`1b76049a` and selected C1, including isolated runtime-role race/recovery proof.
The following C0 preparation notes are historical; canonical reconciliation is
recorded in [the approved migration](../change-requests/PM-PIPELINE-C0-ADOPTION-20261024.md).
C2–C4 remain outside this C1 increment.

## Task C0: Resolve the technical contract before any schema/UI code

**Current selection (2026-10-24):** C0 v0.1.5 D1–D6 is adopted at
`1b76049a`; the canonical adoption migration records that decision. C1 is selected.
The following preparation checklist records C0's original design work; it does
not reinstate the former `CONTRACT_NOT_ADOPTED` boundary.

**Files:** prepare a source-owned supplement at
`docs/architecture/project-manager-system/30-PIPELINE-CONTRACT-FOUNDATION.md` and
its reviewed contract examples; reconcile ADR-035 and the existing FEAT-007 note.
These are proposed until the exact supplement/ADR disposition is accepted.
No source row, transport schema or application file changes in C0 preparation.

**Input:** current `Dependency` has no contract/version column; the existing
`PlanEnvelope` accepts versions 1.0/1.1/1.2 and implements full imports, not a
general delta/move/undo protocol. Existing `/api/import/dry-run` and `/api/import/commit`
read `body.plan`. No current audit-driven undo API was identified in this bounded scan.

**Proposed interfaces for the supplement (builder choices, not adopted contracts):**

| Interface | Proposed contract and decision to settle |
|---|---|
| `zHandoffContractV1` in `application/handoff-contract.js` | Strict versioned JSON: non-empty deliverable; either a Gate reference or explicit manual decision with server-owned actor/time/audit provenance. Gate status remains authoritative; manual client input cannot forge provenance |
| `Dependency.contractJson` | One nullable JSON-string column, matching FR-084 and existing SQLite string conventions. Candidate CAS uses `expectedDependencyHash` over canonical stored content under the shared graph lock, avoiding an unreviewed extra version column. The supplement must freeze serialization and legacy-null hashing |
| `PlanEnvelope` delta variant | Proposed version 1.3 under the existing `body.plan`, with one server-authorized Project target, trace/idempotency identity, expected preview hash and a bounded allow-list of create/move/contract/remove commands. Keep earlier readers; do not turn a drag into a full import that duplicates the Project |
| `dryRunPlanDelta(plan, {workspaceId,viewer,db})` | Internal shared-lane branch returning `ok/errors/conflicts/previewHash/projectId/commands`; no writes or grant changes |
| `commitPlanDelta(plan, {workspaceId,viewer,db})` | Internal shared-lane branch that reauthorizes, rechecks preview hashes and graph invariants inside one transaction, then emits the existing import/trace/audit identities with an adopted additive receipt shape |
| Release evaluation | `getWorkItemReleaseState(itemId,{viewer,db}) -> {held, blockers}` where each authorized blocker names dependency/predecessor/acceptance state. Freeze the exact DTO, dependency-type direction table, endpoint-to-WorkItem rules and protected status transitions before C4 |
| Undo | An authorized inverse delta linked to the original audit event and current expected hashes, never unconditional replay of an old snapshot. Freeze which operations are reversible and how later edits cause a typed conflict |

- [ ] Write positive/negative contract examples for all six endpoint types, every existing dependency type, foreign Gate, legacy null, manual provenance, repeated idempotency key, stale preview and stale undo. Pin request/response/error shapes and size bounds in the supplement; no undeclared command or executable input is accepted.
- [ ] Explicitly resolve Gate scope and release semantics: direct vs aggregate endpoints, ordering vs lineage/related edges, REQUIRES direction, eligible start/finish status transitions and behavior of missing/deleted acceptance evidence. ADR-035/FR-085 do not define this complete matrix; no default may silently weaken or broaden the requirement.
- [ ] Resolve the delta's typed move matrix and authority boundary. Recommended first scope is moves within one Project with prospective seven-mode semantic validation, stable entity IDs and atomic descendant updates; illegal hierarchy/cycle/mode moves are refused before drop and again at commit. Cross-Project movement is not inferred from a Project-local canvas.
- [ ] Resolve compatibility explicitly: old versions without new edge writes retain their behavior, but old API/import/bundle payloads creating bare edges cannot silently bypass the new invariant after activation. Define typed dry-run refusals, consumer migration and activation ordering; read compatibility is not permission to keep writing new undeclared edges.
- [ ] Obtain exact review/adoption of this supplement and ADR-035's implementation scope through the normal product/document workflow. If source wording must change, use the reviewed canonical migration process. Until resolved, mark C1–C4 **CONTRACT_NOT_ADOPTED** and proceed with eligible Track A/B work.

**Exit:** accepted exact contracts/examples and an explicit scope for C1–C4.
This is product/contract adoption, not a developer DDC admission or packet.
If the adopted choices differ from the proposals above, revise the affected
interfaces/tests in this plan before their code task starts.

## Task C1: Handoff persistence, shared delta lane and global register (FR-084)

**Entry:** C0 adopted; schema/receipt/security/recovery consequences reviewed.

The proposed C0 supplement adapter extension makes RegisterDelta1.3 (body.plan on
the existing dependency route) and Bundle1.1 part of C1's consumer migration.
Keep the existing bundle.import.commit receipt label/anchor, add contract fields
and preview hashing through the same transaction writer, and test shared-key
cross-Tenant conflicts plus numeric/counter-overflow refusal. These exact adapter choices are adopted in C0 v0.1.5 and selected for C1.

**Files (Server-relative; proposed new files):**

- Create `src/modules/project-manager/application/handoff-contract.js` for pure validation/state derivation; `import/plan-delta-schema.js` for the adopted command schema; `import/plan-delta-service.js` for shared-lane orchestration.
- Modify `import/plan-schema.js`, `import/plan-import-service.js`, `contracts/plan-envelope.schema.json`, the two existing import routes and their OpenAPI source to dispatch the adopted additive variant; retain prior full-envelope parsing.
- Modify `application/dependency-service.js`, `src/lib/validation/entities.js`, `views/universal/DependenciesView.jsx`, the existing dependency routes and bundle schema/commit collaborators where they create edges. Add a `db`/transaction seam to shared domain helpers; do not call global Prisma inside a supplied transaction.
- Schema: `prisma/schema.prisma`, new additive SQLite/provider migration files, generated PostgreSQL schema/SQL; update backup/export/restore readers for the new field and current frozen inventory via its reviewed binding workflow. No historical migration is rewritten.
- Create `tests/unit/handoff-contract.test.js`, `tests/integration/plan-delta.test.js`, `tests/integration/dependency-handoff.test.js`, `tests/e2e/dependency-handoff.spec.js`; include real PG race coverage in `tests/postgres/pipeline-handoff-races.test.js` and explicitly select it in the PG config.

**Interfaces:** C0's exact schemas and delta functions; proposed pure
`handoffContractState(contract,{gate}) -> 'UNDECLARED'|'DECLARED'|'SATISFIED'`.
`createDependency`/delete/contract-update and cycle checking use the same
transaction-aware domain implementation from both register and import. All
affected endpoints must authorize both governing scopes; Gate facts are read
only after authorization.

- [x] Write failing tests for new edge without contract, invalid/foreign Gate, forged manual provenance, identical retry, changed-payload retry, audit rollback, legacy null round-trip and two opposing concurrent edges. Assert no partial writes or second cycle implementation. Add authorized stale inverse/undo refusal and exact receipt linkage assertions from C0.
- [x] Implement the pure schema/state functions, additive migration and transaction-aware domain/import branch. Serialize graph-changing writes on the adopted common scope locks; acquire multiple scope locks in deterministic order. Repeat authority, self/cycle and CAS checks at commit, not only in preview.
- [x] Wire the existing global register's mandatory contract form and preview/error states before enabling any new canvas writer. Update API/full-import/bundle edge writers under C0's compatibility policy. Legacy stored rows stay null; do not backfill satisfaction or actor evidence.
- [x] Verify migrations and backup/recovery against both adapters; run the new suites plus existing plan import, import authorization, dependency authorization, core and bundle regressions. Run production build and the global register browser journey, with zero required skips/flaky results.

```text
npm --prefix apps/server test -- tests/unit/handoff-contract.test.js tests/integration/plan-delta.test.js tests/integration/dependency-handoff.test.js tests/integration/plan-import.test.js tests/integration/import-target-authorization.test.js tests/integration/fr072-dependency-authorization.test.js tests/integration/project-core.test.js
npm --prefix apps/server run test:postgres -- tests/postgres/pipeline-handoff-races.test.js
npm --prefix apps/server run test:e2e -- tests/e2e/dependency-handoff.spec.js
```

- [ ] Independently review the exact schema/service/UI patch, generate owned schema/document outputs serially, run scoped shared-contract checks/governance and exact-head CI, then commit `feat(pm): add declared dependency handoffs`.

**Exit:** the existing register and shared import lane enforce the adopted new-edge
contract, with legacy read/recovery compatibility. C1 alone does not claim canvas
editing or Board holding.

### C1 execution boundary (2026-10-24)

C0 v0.1.5 D1–D6 is implemented in the candidate branch. Local C1 PM application qualification
and independent source review are complete as recorded below. Final composed
documentary/governance and exact-head hosted results are PR gates; no deployment or merge is inferred.

- Nullable `Dependency.contractJson` preserves existing SQL NULL rows without
  backfill. The issued SQLite and PostgreSQL migrations add only nullable TEXT.
  Recovery uses the new `pipeline-target-schema.inventory.json`; the historical
  Phase B inventory and approved C0 examples remain unchanged.
- The shared writer covers ProjectDelta1.3, RegisterDelta and Bundle1.1, with
  strict schemas, server-owned manual provenance, CAS, receipt linkage and undo.
  Full Plan1.0–1.2 and Bundle1.0 retain imports without new bare edge writes;
  legacy XLSX new bare edges receive `CONTRACT_REQUIRED` through that same lane.
- New actor/hash/UUID frames require a current Person. Existing Enterprise API
  service keys remain supported by legacy full envelopes and Bundle1.0, with
  their actual key row rechecked inside the commit fence. No service-actor
  identity is inferred for the new protocols.
- Existing register GET adds only state/hash after both endpoint scopes. Editing
  an existing edge resolves both endpoint Projects through an authorized opt-in
  scope response from the existing resolver; it never prefills private evidence.
  RegisterDelta still contains exactly one command. Atomic identity replacement
  uses the adopted ProjectDelta command batch where applicable; this increment
  does not add a multi-command global register or an identity-edit UI.
- Gate state begins as structural IDs and scope only, then hydrates complete rows
  after Project read authorization. Manual audit reads are scoped before fetching
  evidence. Opaque affected releases refuse the entire preview; a dangling edge's
  structural locator is never substituted for a full AuditEvent fingerprint.
  Successor membership changes refresh the locator in the same delta, import or
  CRUD audit, including cross-Project aggregates. Project-local undo cannot widen
  an original two-Project Register scope.
- HTTP adapters retain actual UTF-8 body byte counts before JSON parsing discards
  whitespace or duplicate keys; new protocols enforce the adopted 1 MiB limit
  before graph expansion. The retained domain service bound remains in force.
- PostgreSQL takes a utility table lock before its first MVCC SELECT, then the
  adopted advisory key, under Serializable isolation. SQLite acquires its writer
  reservation before graph facts. Receipt-key conflicts roll back before a fresh
  authorization and winning-receipt lookup; unrelated unique failures do not replay.
- The new import protocols and retained full-import consumer guard their own
  initially protected work changes. Existing CRUD joins the serializer and
  endpoint-retention checks. FR-085-wide CRUD/Board holds and explanation remain
  Task C4; C1 does not claim that later capability.
- Canonical FR identities, membership and subject anchors are retained. The
  sanctioned ID-ledger writer records owner-approved same-subject statement
  reviews for FR-084 and FR-085. C2–C4 remain unselected and production untouched.


### C1 qualification record (2026-10-24)

This is implementation evidence for the selected increment, not a requirement
source. The approved C0 examples and historical Phase B schema inventory remain
unchanged. The initial reviewed C1 PM application/contracts/Prisma checkpoint is `e41240f17ad617b1672d232de4d0ca597d312723`;
reviewed test-only follow-ups end at `30120d04ea7de61e317f51674d67f4d79f91346a`.
Git comparison confirms no C1 PM application, contract or Prisma differences between
those revisions. The earlier main synchronization at `75e20709` retains upstream
PR #734/#735 changes outside that PM tree and preserves both PostgreSQL test
selections. Hosted checks must evaluate the final PR head independently.

| Check | Observed result and boundary |
| --- | --- |
| SQLite C1 and retained consumers | 41 files, 324 tests passed together after fixture cleanup; includes endpoint/type matrix, Delta/Register/Bundle, authorization, shared writer, CAS/undo, raw-body bounds, receipt races, migration mirrors and actual snapshot round trip |
| Changed consumer reruns | 7 files, 102 tests passed: CRM legal hold, canonical source verifier, FR-072 refusal disclosure, stocktake backup, full plan import, Marketing Campaign and FileAsset service |
| PostgreSQL C1 | `test:postgres -- tests/postgres/pipeline-handoff-races.test.js`: 13 tests passed on the final application source with actual isolated runtime login roles; includes observed lock contention, opposing cycles, unique receipt race, revocation/CAS, recovery process and wrong-schema/corruption refusal |
| PostgreSQL retained Phase B | Earlier composed run: 2 files, 26 tests passed, including the 13 actual-role Phase B/recovery CLI tests; the final C1-only PostgreSQL rerun above qualifies the later phase-display fix |
| Production build and browser | The merged-source `75e20709` build passed, including lint/type and 94 static pages. Its owned isolated production-build browser journey passed in one attempt with the fail-on-flaky guard: preview/cancel without writes, create/reload, edit, stale CAS and removal |
| Canonical migration/readers | Pre-main-sync `npm run docs:migration:test`: 146 tests passed after updating the exact approved-migration and planned-status assertions; identities and implementation evidence remain distinct. The composed post-merge reader rerun and final hosted result must be recorded in the PR |
| Independent source review | GPT-6 Luna Max approved application patch `e41240f1` against main `7d6a80e0`; subsequent fixture-only changes were separately reviewed and their reported issue corrected |
| Governance / hosted CI | Registry, graph, views and govern passed on the merged `75e20709` tree. This qualification-wording follow-up requires its own final govern pass; record that result, the composed reader rerun and exact-head hosted jobs in the PR before acceptance |

The broad local Server run was interrupted after observing seven failed files
and changing their fixtures; it is **not** a clean full-suite or final-patch PASS.
The 102-test rerun covers every observed failed file. A subsequent composed
C1 run exposed one CAS test leaving deliberately corrupt JSON in the shared test
database; restoring its original bytes in `finally` allowed all 324 selected
tests, including the affected recovery files, to pass together. Neither recovery
validation nor verification time budgets were relaxed. Exact-head hosted full
Server checks remain required; scoped reruns do not replace them.

#### Hosted-CI correction round

The first final-head run caught SCM kernel mirror drift; the sanctioned
`kernel:sync` updated only the shared enum mirror and its manifest at `7eb5854e`.
Its exact-head hosted governance/build and all three services passed, but full
Server shards found further retained-consumer failures. That red run is not
acceptance. The follow-up retains explicit Serializable transaction options on
SQLite as well as PostgreSQL, and forwards version-specific PlanEnvelope error
paths through a preprocessor around the original OpenAPI-capable union.
Snapshot fixtures now supply explicit empty Dependency arrays, Pricing mocks
supply the writer reservation/schema probe, and the Marketing execution reader
fixture uses actual Person/Membership rows. Existing recovery refusal and
Serializable race assertions remain unchanged.

The initial focused eight-file run passed 98 tests before the OpenAPI-compatible
preprocess correction; it does not qualify that corrected representation. The composed follow-up
passed **49 files / 422 tests** together, including all original 324 C1 tests,
OpenAPI schema mirrors and all seven newly failing hosted files. The diagnostic
regression covers every supported full-plan version (1.0/1.1/1.2). GPT-6 Luna Max
reviewed this seven-file application/fixture correction and found no remaining
source blocker after the OpenAPI representation was corrected. Record fresh
PostgreSQL, build, governance and final-head hosted results in the PR before
acceptance; the earlier source checkpoint does not prove this correction.
The corrected application source is committed at `0842c3e9`; fresh qualification
passed 26/26 actual-role PostgreSQL tests (C1 plus retained Phase B), the
production build, one isolated browser attempt and strict governance before the
latest main composition. Upstream main `6b66fd28` (PR #736, Agent/Ollama and
FR-079) was subsequently merged without C1 PM application changes. Regenerate
canonical outputs and run governance on that composed tree; final hosted tests
and build must qualify the final PR head.

C2 canvas gestures, C3 structure editing, C4 Board/CRUD release enforcement,
production migration, deployment and merge remain outside this increment.

## C2 source qualification (2026-10-24)

The owner selected C2 after PR #737 merged. Reconciled before coding against
main `cb0bfbbcf42140bdd7295c8ebe95461e5d988a4b`, C0 v0.1.5 D1–D6,
ZAI:FR-083, BR-017, SDD-046 and NFR-008. C1 is merged and its exact-commit
post-merge governance, Edge/Desktop and Docker build workflows succeeded
(40059388443, 40059388437, 40059388466). Docker did not publish or deploy.
The original C1 preparation/qualification sections remain historical evidence.

C2 consumes ProjectDelta1.3 through the existing `/api/import/dry-run` and
`/api/import/commit` adapters. The mandatory dialog proposes one
`dependency.create`; the pending edge is the preview. Successful dry run
continues to the existing transactional commit, receipt and guarded undo.
Cancellation before commit invalidates delayed responses and writes nothing.
An uncertain commit response retains the same idempotent request for retry.
Self/cycle and fresh authority decisions remain in the existing server writer.

The old map projects only endpoints of existing edges. C2 adds active,
authorized Project-contained endpoints so the first edge can be created, plus
only the existing safe contract-state projection. Stored provenance and raw
contract JSON remain private. The unscoped internal compatibility mapper and
global register retain their existing contracts. Input contract validation is
factored into a browser-safe pure schema, re-exported by the existing server
module; this changes no adopted schema or provenance semantics.

No new model, route, migration, persisted position, graph library, release
predicate or requirement statement is selected. C3 structure editing and C4
Board/CRUD release enforcement remain unselected; production is untouched.

## Task C2: Accessible edge creation on the Project canvas (FR-083)

**Files:** modify `views/DependencyMap.jsx`, `views/dependency-map.module.css`,
`application/project-dependency-map.js`, and its existing Project API read path.
Create `components/HandoffContractDialog.jsx`,
`tests/unit/pipeline-edge-interactions.test.js` and
`tests/e2e/pipeline-edge-editing.spec.js`. The composed scope also factors
`application/handoff-contract-schema.js` from the existing server module,
adds `components/pipeline-edge-interactions.js`, updates existing map/route
unit tests, adds `tests/integration/pipeline-canvas-adapter.test.js` and
`tests/postgres/pipeline-canvas-adapter.test.js`, and selects the latter in
`vitest.postgres.config.js`. Generated tracked verification/domain-state views
follow these annotations; no canonical requirement row is changed.

**Interfaces:** consume C1's adopted preview/commit adapter through the existing
import routes and pure contract schema. Dialog completion proposes a command;
cancellation produces no command/write. Graph projection adds only authorized
contract/state fields from C0; no persisted x/y coordinates.

- [x] Write interaction/browser assertions for drag and `Connect to…` equivalents, mandatory dialog cancellation, pending preview, stale-response rejection, self/cycle/foreign-scope refusal and inline recovery/retry. Both gestures must produce the same command/receipt; cancel must leave dependency/audit counts unchanged.
- [x] Implement the dialog, focus restoration and pointer threshold without changing derived layout. Pending/declared/satisfied/undeclared/refused have text or shape and accessible announcements, not color alone. Reverted previews retain enough context to correct the error.
- [x] Run `npm --prefix apps/server test -- tests/unit/pipeline-edge-interactions.test.js tests/unit/dependency-map-view.test.js` and `npm --prefix apps/server run test:e2e -- tests/e2e/pipeline-edge-editing.spec.js`. Include keyboard-only, single-pointer, narrow viewport and reduced-motion cases in the new browser file; run the behavior-appropriate build/governance/review/CI.
- [x] Commit the complete gesture/equivalent unit as `feat(pm): create dependency edges accessibly`.

## C3 source qualification (2026-10-24)

The owner selected C3 after C2 local/hosted acceptance, explicitly choosing C3
rather than merging PR740. Work starts on `codex/pm-pipeline-c3-20261024`,
composed source `e9d312ad` (C2 `fc2ec33b` plus main `08ecc44e` / PR741).
PR740 remains open and unchanged. C4, production and merge are excluded.

FR-082, adopted C0 section7, ADR-035 and the current strict delta schema agree:
create WORKSTREAM under PROJECT, and WORK_CONTAINER/WORK_ITEM under a contained
WORKSTREAM or WORK_CONTAINER. Moves retain identity, descendants and Feature
links, require source/destination subtree hashes, and revalidate hierarchy,
mode, effective cycles and release under the existing graph transaction.
No new schema, command variant or canonical requirement migration is needed.

Current `compilePlanDelta` already implements these commands. `WbsCanvas` has no
editing affordance; the existing tree GET has no subtree fingerprints and only
two container levels. C3 adds an explicit canvas projection on the same GET,
with contained structural labels/hashes and read-only eligible-parent discovery
through the existing compiler. Mutation remains exclusively dry-run/commit.
The unchanged plain GET and read-only view remain available to readers without
write authority; their nested-container assembly is extended to preserve visibility
at every new depth. No authority or provenance rows enter the canvas DTO.

Owned additions: a structure-canvas read model, browser-safe command helpers,
an accessible StructureCanvas editor/dialog and their adapter/unit/browser tests;
the WBS entrypoint, owned styles, existing tree route and PG test selection are
integrated. Existing standalone edit forms retain their CRUD purpose; new canvas
create/move actions use the shared delta lane. Drop targets activate only after
server prospective validation; keyboard/single-pointer Move to uses the same
eligible set and command. Delayed reads/previews and uncertain commit recovery
retain C2's generation/idempotency protections. This explanatory qualification
was initially recorded before application/test changes; subsequent implementation
clarifications are noted below and executed results follow separately.

The eligible-parent implementation calls the exact `preparePlanDelta` used by
dry run, including release-effect validation, not a second approximation. That
internal preparation function is exported without changing its write semantics.

## Task C3: Structure add/reparent with the same writer (FR-082)

**Files:** modify `views/WbsCanvas.jsx`, its owned styles and the existing tree
GET; add `components/StructureCanvas.jsx`, browser-safe structure command helpers
and `application/structure-canvas.js`. Reuse C1's existing command branch;
extract its shared read preparation in `import/plan-delta-service.js` without
adding commands. Existing standalone forms retain their purpose. Add
`tests/integration/plan-delta-moves.test.js`,
`tests/e2e/pipeline-structure-editing.spec.js`, the owned helper/tree unit tests,
`tests/postgres/pipeline-structure-moves.test.js` and its PG selection entry.

**Interfaces:** consume C0's adopted node-create/move variants and parent/mode
matrix. Derive valid drop targets from the same prospective semantic validation
used by dry run. Commit preserves entity identities and updates affected
descendants/references atomically under expected hashes.

- [x] Write tests for legal child creation, invalid hierarchy, descendant cycle, stale parent, foreign Project, incompatible mode, retained Feature links and unchanged ID/audit on refusal. Include an undo after a newer edit that must conflict instead of overwriting it.
- [x] Implement `+` forms and `Move to…` first, then drag using those same operations. Invalid targets never become active drop targets; the server independently revalidates. Preserve seven-mode contracts and the existing objective-first Project creation flow.
- [ ] Run `npm --prefix apps/server test -- tests/integration/plan-delta-moves.test.js tests/integration/plan-delta.test.js` and `npm --prefix apps/server run test:e2e -- tests/e2e/pipeline-structure-editing.spec.js`; repeat the graph contention cases for affected move operations on PG. Build/review/governance/CI then commit `feat(pm): edit Project structure through plan deltas`.

## Task C4: Server-enforced release holds and Board explanation (FR-085)

**Files:** create `application/work-release-policy.js`; modify `application/work-service.js`,
`application/dependency-service.js`, `views/KanbanBoard.jsx`, the actual work-status
API/modal paths (`src/app/api/work/[id]/route.js`,
`components/WorkpackageModal.jsx`, `components/StatusSelect.jsx`),
`src/modules/agent/line-project-work-tools.js`, `import/plan-import-service.js`
and all additional writers found by the census that can perform the adopted protected
status transitions. Create `tests/unit/work-release-policy.test.js`,
`tests/integration/work-release-gates.test.js`,
`tests/postgres/work-release-races.test.js` and `tests/e2e/pipeline-release-holds.spec.js`.

**Interfaces:** implement C0's `getWorkItemReleaseState(itemId,{viewer,db})`
and share its pure predicate between authorized reads and protected transactional
writers. `updateItem(id,patch,{viewer,db,expectedVersion})` retains its public
signature and consumes the policy before a protected transition. Direct HTTP,
registered tools and import cannot bypass the same check.

- [ ] Write failing truth-table tests for every adopted endpoint/type/status combination, manual and Gate acceptance, missing evidence, undeclared legacy rows and foreign-scope redaction. Include creation/import with an initially protected status, not only PATCH transitions. Add a two-client test that races release against acceptance/contract changes; one consistent transaction outcome must win.
- [ ] Enumerate all actual status writers before editing, including raw ORM calls in import/tool services. Route protected transitions through the owning policy/transaction without adding a second progress calculator. Render held state and authorized predecessor links before the user attempts a move; preserve the `StatusSelect` equivalent.
- [ ] Run `npm --prefix apps/server test -- tests/unit/work-release-policy.test.js tests/integration/work-release-gates.test.js tests/integration/line-project-work-tools.test.js tests/integration/plan-import.test.js`, `npm --prefix apps/server run test:postgres -- tests/postgres/work-release-races.test.js`, and `npm --prefix apps/server run test:e2e -- tests/e2e/pipeline-release-holds.spec.js`. Add any further consumer regression files discovered by the writer census, then run build/governance and required shared consumers.
- [ ] Obtain independent whole-track review, current schema/recovery proof and exact-head hosted checks. Commit `feat(pm): enforce handoff release holds`. Pass the selected artifact to B4; do not mark deployment from local completion.

## Version history

0.1.0 (2026-10-23): initial proposed gated plan. C0 identifies source gaps in
transport, undo, move and release semantics; C1–C4 are not authorized to guess
them or implement the wider PM candidate.

0.1.1 (2026-10-23): owner approved the implementation-plan package at c291afcd; only A1 is selected for this increment. Track B/C execution and C0 contract adoption remain unstarted.

0.1.2 (2026-10-23): owner selected C; prepare source-qualified C0 supplement and
examples before application code. No implicit adoption of new release semantics.


0.1.3 (2026-10-24): owner adopted C0 v0.1.5 D1–D6 at `1b76049a` and
selected C1. Canonical sources were reconciled through the reviewed migration;
C1 implementation, isolated SQLite/PostgreSQL qualification and independent
source review are recorded above. Hosted exact-head acceptance remains a PR gate.

0.1.4 → 0.1.5 (2026-10-24): records C1 merge/post-merge qualification and the
owner-selected C2 source reconciliation. Canonical identities and behavior
contracts remain unchanged; C3–C4 and production are excluded.

## C2 independent review and corrections

GPT-6 Luna Max reviewed the full application/test/plan snapshot tree
`81492bffb8a9fd443041ecc674180592cf077ace` against merged main `cb0bfbbc`.
It identified two Important issues: coded 5xx commit failures discarded the
idempotent request, and unordered graph refreshes could replace a newer view.
The latter also lacked inline reload recovery after a saved commit's GET failed.
The review's minor scope-list omission is reconciled in Task C2 above.

The correction preserves accepted requests for uncertain commit outcomes,
uses only explicit definitive refusals to abandon them, guards graph reads by
generation/Project and invalidates reads on unmount/mutation. Save stays busy
until its refresh settles. Failed refresh retains an inline Reload Project
control. Deferred-response and coded-5xx regressions were written and observed
failing first. Final execution evidence is recorded separately from the original
review snapshot. C1 writer internals were retained, and C3/C4, production and
merge were explicitly outside that review.

Governance additionally caught a copied endpoint-type list in the new read
projection. It now consumes the canonical endpoint enum and existing model map,
rather than introducing another catalogue or widening an accepted baseline.

An additional recovery regression reproduced that Reload Project dismissed an
uncertain-save alert while controls remained fenced, hiding Retry handoff.
Reload now preserves refusal/uncertain context until correction, replay or
dismissal; it clears only a saved commit's failed-refresh alert. Browser fixture
cleanup retains per-test edge baselines, uses the explicit disposable E2E URL,
and distinguishes the canvas alert from Next's route announcer.

## C2 local qualification (2026-10-24)

C2 implementation and local acceptance are complete on the selected candidate
application source. This records execution evidence, not a canonical lifecycle
promotion, complete Pipeline Builder acceptance, merge or production release.

| Check | Executed result and scope |
|---|---|
| SQLite scoped regression | `npm --prefix apps/server test --` the 16 selected canvas, contract/register, endpoint, bounds, private-evidence, bundle/delta and authorization files: 139 assertions passed, no failures/skips |
| PostgreSQL canvas adapter | `npm --prefix apps/server run test:postgres -- tests/postgres/pipeline-canvas-adapter.test.js`: 1 passed against an owned disposable cluster and actual non-superuser/non-bypass runtime role; manual/Gate, undeclared/invalid state projection and persistence |
| Browser | Guarded Playwright on owned loopback port 3127 and its isolated seeded SQLite: `tests/e2e/pipeline-edge-editing.spec.js`, all 10 passed in one attempt with retries disabled and the flaky/zero-test guards retained |
| Browser behaviors | Keyboard-only, drag and single-pointer equivalents; 390px/reduced-motion; mandatory cancellation and focus restoration; delayed preview cancellation; self/cycle/opaque foreign refusal; real stale commit; transport and coded-503 replay with the identical request; guarded undo; failed and out-of-order graph reload recovery |
| Canonical reader | `node --test apps/server/tests/node/canonical-document-registry.test.mjs`: 12 passed, no failures/skips |
| Build | `npm --prefix apps/server run build`: PASS, including Next's validity phase; no standalone Server typecheck or configured ESLint project is claimed |
| Local governance | Registry, graph and view regeneration followed by `npm run govern`: 0 critical / 0 warning; owned tracked generated views were inspected; ignored graph/corpus/report outputs are not staged |

The original independent review and its corrections are recorded above. Final
same-patch review confirmation and exact-head hosted CI remain integration gates
recorded in the PR. No preview or PostgreSQL test process is left serving this
candidate. Production and C3–C4 remain unselected. The retained local logs are
under `.local/pm-pipeline-c2-20261024/`; the PR records reproducible commands and
hosted evidence without treating those ignored logs as canonical authority.

## C2 latest-main composition

After local acceptance and PR740 creation, main advanced through PR738 to
`832e365d14703c5cb70cb63514afeb86093b00cb` (LINE product disclosure). The
composition preserves that main change, its new model/migrations, canonical
record migration and updated current-schema recovery inventory; C2 introduces
no additional model or migration relative to this base. C0 v0.1.5, ADR-035 and
FR-083/084/085 have no changes between the original and composed base. BR-017's
pinned source row is unchanged; upstream removed its explanatory successor note,
while the adopted interpretation remains explicit in FR-085 and C0.

The PostgreSQL selection conflict is resolved by retaining both new upstream
LINE suites and the C2 canvas adapter suite. Generated state is rebuilt from
the composed source rather than merged JSON. The C2 application files remain
byte-identical to the reviewed local-acceptance source. Fresh adapter/browser,
build, governance, exact-head hosted CI and review of this composed scope are
required before integration. Production and C3–C4 remain unselected.

## C2 composed verification corrections

The first composed run at `12fcd8b5` exposed two gaps after the earlier local
qualification. Hosted PostgreSQL recovery failed four tests because the extracted
handoff schema was imported without `.js`: the bundled application accepted it,
but the unbundled Node recovery CLI raised `ERR_MODULE_NOT_FOUND`. A child-process
CLI-load regression failed first; both the import and re-export now use the
explicit extension. The existing full affected recovery suites are rerun in
addition to the canvas adapter; a canvas-only pass cannot qualify recovery.

The composed browser run passed 9 of 10 cases. Its failed-refresh test installed
the simulated 503 before the initial page graph read had settled, causing an
initial-load refusal rather than the intended post-save refusal. Browser setup
now waits for the rendered connection control before fault injection. This
changes test synchronization, not product behavior. The final PR evidence
must record fresh results and independent review for these corrections; the failed
run is retained and is not counted as a pass. Production and C3–C4 remain excluded.

## C3 independent review and corrections

GPT-6 Luna Max reviewed immutable tree `4faa85e8` against composed base
`e9d312ad`. Two Important findings were verified: a successful HTTP response
missing `committed` was incorrectly treated as a definitive refusal, losing the
accepted idempotent request; and eligible-parent discovery repeated full graph
reads/preparation for every candidate. Regressions were observed failing first.

Malformed commit results now remain uncertain and retain the identical request
for replay. Eligible-parent discovery shares one transaction snapshot of the
graph, readable scopes and evidence. It runs the same complete semantic/release
validation against each prospective result, without recalculating unused preview
fingerprints. The query-count regression observed ten graph reads before the
fix and one afterward for eight eligible parents. This proves snapshot reuse,
not maximum-size latency or production capacity. Writer previews/commits retain
their complete fingerprints and current authority checks; these are internal
read-model options, not envelope bypass fields.

The reviewer also found an ARIA parent/group relationship issue and an outdated
Task C3 file list. The hierarchy issue was treated as part of FR-082/NFR-008
acceptance: a browser regression failed before nesting each group within its
own treeitem and retaining visible keyboard focus. The file list above is
reconciled with the pre-code qualification and actual owned files. No C4,
canonical requirement migration, production or merge is introduced. Final review
confirmation and executed qualification are recorded separately.

0.1.5 → 0.1.6 (2026-10-24): records owner-selected C3, current-source
reconciliation, actual file ownership and review corrections. C2 remains in open
PR740; C3 is a separate branch, with no merge or production authority.

## C3 local application qualification (2026-10-24)

Application/test source tree `a07b7a0e` has completed scoped local acceptance.
This is a source/implementation snapshot, not canonical lifecycle promotion,
complete Pipeline Builder acceptance or a production release.

| Check | Executed result and scope |
|---|---|
| SQLite | 11 selected files, 75 assertions passed, no failures/skips: structure adapter/helper/tree, shared delta, contract/register, authorization, existing WBS and Project core |
| PostgreSQL | 3 suites, 17 passed on owned disposable clusters and actual non-owner/non-superuser/non-bypass runtime role; includes C3 cross-Workstream descendant/Feature-link retention, observed opposing-move contention and audit rollback, C1 graph races/process recovery and C2 adapter |
| Browser | Guarded Playwright on owned loopback port3129 and its isolated seeded SQLite: 12/12 passed in one attempt, 19.1s; retries disabled and flaky/zero-test guards retained |
| Browser behaviors | Actual keyboard create/cancel/focus, every create family, Move to and drag/invalid targets, 390px/reduced motion, stable identity/readback, newer-edit undo refusal, retained WorkItem metadata, delayed-preview cancellation, stale destination, coded503/malformed-success idempotent replay, deep compatible read and ARIA group ownership |
| Build | `npm --prefix apps/server run build`: PASS, including Next validity phase; no standalone configured lint/typecheck run is claimed |
| Independent review | GPT-6 Luna Max confirmed tree `a07b7a0e` against `e9d312ad`: no remaining Critical/Important blocker; shared snapshot preserves full semantics and internal options are not exposed through HTTP |

The document/generated-output composition passed strict governance with
0 critical / 0 warning / 43 info. Exact-head hosted CI remains a delivery gate;
its revision-specific outcome will be recorded in the PR. The integration
checkbox above is a pre-delivery snapshot; the PR will record its subsequent
remote gate result without issuing a
new canonical requirement state. No preview/test process remains serving after
each owned run. Ignored local logs are under `.local/pm-pipeline-c3-20261024/`.

C3 will target the C2 branch in a stacked PR while PR740 remains unmerged.
Its branch also contains the already-merged PR741 composition from main; those
six LINE files are upstream context, not new C3 implementation. No merge,
C4, production, migration or maximum-size runtime-capacity claim is selected.
