---
id: ZAI:PM-PIPELINE-PLAN-20261023
title: Project Manager Pipeline Builder implementation plan
doc_type: implementation-plan
status: approved
version: "0.1.2"
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

**Architecture:** Add the nullable Dependency contract described by FR-084 and reuse the existing PM import/authorization/audit lane. Keep graph layout derived and server enforcement authoritative. Owner-approved C0 v0.1.5 and the reconciled ADR-035 authorize selected C1; C2–C4 remain later increments.

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
- [ ] Verify migrations and backup/recovery against both adapters; run the new suites plus existing plan import, import authorization, dependency authorization, core and bundle regressions. Run production build and the global register browser journey, with zero required skips/flaky results.

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

C0 v0.1.5 D1–D6 is implemented in the candidate branch. Final acceptance still
requires the composed checks, browser qualification, independent exact-patch
review and hosted CI listed above; no deployment or merge is inferred.

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

## Task C2: Accessible edge creation on the Project canvas (FR-083)

**Files:** modify `views/DependencyMap.jsx`, `views/dependency-map.module.css`,
`application/project-dependency-map.js`, and its existing Project API read path.
Create `components/HandoffContractDialog.jsx`,
`tests/unit/pipeline-edge-interactions.test.js` and
`tests/e2e/pipeline-edge-editing.spec.js`.

**Interfaces:** consume C1's adopted preview/commit adapter through the existing
import routes and pure contract schema. Dialog completion proposes a command;
cancellation produces no command/write. Graph projection adds only authorized
contract/state fields from C0; no persisted x/y coordinates.

- [ ] Write interaction/browser assertions for drag and `Connect to…` equivalents, mandatory dialog cancellation, pending preview, stale-response rejection, self/cycle/foreign-scope refusal and inline recovery/retry. Both gestures must produce the same command/receipt; cancel must leave dependency/audit counts unchanged.
- [ ] Implement the dialog, focus restoration and pointer threshold without changing derived layout. Pending/declared/satisfied/undeclared/refused have text or shape and accessible announcements, not color alone. Reverted previews retain enough context to correct the error.
- [ ] Run `npm --prefix apps/server test -- tests/unit/pipeline-edge-interactions.test.js tests/unit/dependency-map-view.test.js` and `npm --prefix apps/server run test:e2e -- tests/e2e/pipeline-edge-editing.spec.js`. Include keyboard-only, single-pointer, narrow viewport and reduced-motion cases in the new browser file; run the behavior-appropriate build/governance/review/CI.
- [ ] Commit the complete gesture/equivalent unit as `feat(pm): create dependency edges accessibly`.

## Task C3: Structure add/reparent with the same writer (FR-082)

**Files:** modify `views/WbsCanvas.jsx`, its owned styles, existing work/container
forms and C1's delta command branch; create `tests/integration/plan-delta-moves.test.js`
and `tests/e2e/pipeline-structure-editing.spec.js`.

**Interfaces:** consume C0's adopted node-create/move variants and parent/mode
matrix. Derive valid drop targets from the same prospective semantic validation
used by dry run. Commit preserves entity identities and updates affected
descendants/references atomically under expected hashes.

- [ ] Write tests for legal child creation, invalid hierarchy, descendant cycle, stale parent, foreign Project, incompatible mode, retained Feature links and unchanged ID/audit on refusal. Include an undo after a newer edit that must conflict instead of overwriting it.
- [ ] Implement `+` forms and `Move to…` first, then drag using those same operations. Invalid targets never become active drop targets; the server independently revalidates. Preserve seven-mode contracts and the existing objective-first Project creation flow.
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
