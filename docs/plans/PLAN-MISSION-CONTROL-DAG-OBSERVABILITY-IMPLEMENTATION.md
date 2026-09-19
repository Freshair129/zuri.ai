---
id: ZAI:PLAN-MISSION-CONTROL-DAG-OBSERVABILITY-IMPLEMENTATION
title: "Mission Control — DAG orchestration observability implementation plan"
version: "0.2.0b"
status: candidate
created_at: "2026-09-19T00:00:00+07:00,Luna Max"
last_update: "2026-09-19T00:30:00+07:00,Luna Max"
attributes:
  domain: platform-control
  scope: documentation-first implementation plan for operator-only DAG observability
  source_of_truth: false
  registry_allocation: FEAT-044 and FR-260..FR-264 allocated; runtime code pending separate approval
relations:
  - type: relates_to
    target: ZAI:PLAN-MISSION-CONTROL-DAG-OBSERVABILITY
  - type: relates_to
    target: ZAI:ADR-048
  - type: relates_to
    target: ZAI:ADR-086
  - type: relates_to
    target: ZAI:ADR-092
---

# Mission Control — DAG orchestration observability implementation plan

This is the implementation plan following approval of the design proposal.
It is still a candidate: it authorizes no runtime/UI code, migration,
deployment, or production action. Registry allocation is now recorded in the
documentation gate; governed generated outputs are regenerated separately.

The design proposal remains the boundary document:
PLAN-MISSION-CONTROL-DAG-OBSERVABILITY.md. The implementation must preserve
its two-source authority model and its truthful LIVE / SNAPSHOT / UNKNOWN /
BLOCKED / NOT_RUN vocabulary.

## 1. Approval, complexity, and proposed identity

The first approval covers the design scope, operator-only route, PORL adapter
boundary, blocker projections, and acceptance/verification criteria.

This plan records the following newly allocated identities:

| Identity | Proposed subject | Reason |
|---|---|---|
| FEAT-044 | Mission Control DAG orchestration observability | A new capability that joins the roadmap DAG with externally reported execution observations; it is not telemetry or usage detail. |
| FR-260 | Operator reads the roadmap DAG and verified orchestration observations | The protected read surface and blocker projection. |
| FR-261 | Orchestration observations carry provenance and truthful execution state | The PORL adapter contract and unknown/not-run semantics. |
| FR-262 | Same-wave work is separated from merge-safe work by explicit gates | Dependency, owner, lane, shared-file, revision, and capability conflict evaluation. |
| FR-263 | Member roadmap projection excludes operator orchestration detail | Server-side redaction and preservation of the existing /roadmap boundary. |
| FR-264 | Mission Control remains responsive and read-only on supported mobile widths | Operator evidence/gate rendering and accessibility at 390x844 and 430x932. |

These are the next unused IDs found by repository enumeration. FEAT-034 and
FEAT-039 remain pinned to programme delivery telemetry and agent usage detail;
reusing either would change an existing subject. The registry rows and ID
ledger are written by the sanctioned documentation gate. No new ADR identity
is proposed yet because the PORL owner, freshness policy, and persistence
choice remain open.

Risk: HIGH. This is an installation-wide authorization boundary and a
cross-system evidence contract, even though the first slice is read-only.

## 2. Existing authority and file-level scope

### 2.1 Read-only inputs

The implementation reads, without changing:

- docs/roadmap/ROADMAP.md as the canonical task/status/proof/implementation/
  dependency SOT;
- generated apps/server/src/modules/platform-control/roadmap-sot.js as the
  checked-in projection of the roadmap SOT, including 118 nodes, 132 dependency
  edges, 21 waves, and SUBPLAN-ROADMAP-MOBILE;
- existing programme data/container modules only where the generated board
  already uses them;
- the approved external Programme Orchestration Run Ledger through a read-only
  adapter, if and when its owner and contract are approved.

The implementation must not edit ROADMAP.md, roadmap-sot.js, or any generated
board module to create run state. Existing PROGRAMME_USAGE and
ProgrammeUsageReport data remains measured usage, not orchestration state.
Pipeline tracking remains the knowledge-ingestion execution ledger, not a
worker/thread/branch/worktree ledger.

### 2.2 Proposed implementation files

The following is the proposed bounded write set after second approval. File
names are a plan, not files that exist today:

| Area | Proposed path | Responsibility |
|---|---|---|
| Contract | apps/server/src/modules/platform-control/mission-control/mission-control-contract.js | Validate the normalized observation envelope, state vocabulary, source/time requirements, and opaque identifier policy. |
| Adapter | apps/server/src/modules/platform-control/mission-control/application/programme-orchestration-run-ledger.js | Read PORL records only; return source-bound observations or explicit unknown/not-run reasons. |
| Read model | apps/server/src/modules/platform-control/mission-control/application/mission-control-read-model.js | Join SOT DAG data and PORL observations, compute blocker/gate projections, and expose no mutation operation. |
| Route | apps/server/src/app/(control)/control/mission-control/page.jsx | Server entrypoint under the existing PlatformControlGuard; load protected data only after authorization. |
| View | apps/server/src/modules/platform-control/mission-control/components/MissionControlBoard.jsx | Read-only DAG, wave, blocker, observation, evidence, and merge-gate rendering. |
| Styles | apps/server/src/modules/platform-control/mission-control/components/mission-control-board.module.css | Responsive bounded layout without document-level horizontal overflow. |
| Unit tests | apps/server/tests/unit/mission-control-contract.test.js, mission-control-read-model.test.js, mission-control-route-contract.test.js | Contract, source precedence, state vocabulary, auth boundary, and gate fixtures. |
| E2E | apps/server/tests/e2e/fr260-mission-control.spec.js | Operator route, forbidden member, read-only UI, blockers, stale/unknown states, and mobile viewports. |

The route may instead be a tab under /control/roadmap only if the open route
decision is explicitly resolved. The first implementation must not add both
surfaces.

## 3. Data flow and PORL contract

The read path is:

    ROADMAP.md
      -> generated roadmap-sot.js
      -> SOT DAG read model

    PORL source
      -> read-only adapter
      -> schema/provenance validation
      -> observation normalizer

    SOT DAG + normalized PORL observations
      -> Mission Control read model
      -> operator-only route and responsive board

The member path remains separate:

    ROADMAP.md + existing usage projection
      -> existing server member redaction
      -> /roadmap

No PORL field may enter that member path.

The minimum normalized observation shape is:

    {
      schemaVersion,
      observationId,
      runRef,
      taskId,
      laneId,
      assignment: { ownerRef, workerRef, threadRef },
      revision: { branch, worktreeRef, baseCommit, headCommit },
      runState,
      freshness,
      source: { kind, ref, observedAt, capturedAt },
      checks: [{ kind, state, scope, startedAt, finishedAt, evidenceRefs }],
      changedFiles: { state, paths, sourceRef },
      blockers: [{ code, state, sourceRef }]
    }

The adapter may return only opaque references where raw identity would expose
more than an operator needs. It must preserve the source reference and the
observation/capture time for every returned field. It must reject or quarantine
malformed records rather than guessing.

Required rules:

- runState is QUEUED, RUNNING, SUCCEEDED, FAILED, or CANCELLED, and comes from
  PORL only.
- freshness is LIVE only when the approved freshness rule is satisfied; a
  historical capture is SNAPSHOT; absent, stale, or unmapped data is UNKNOWN.
- A declared check with no execution record is NOT_RUN; a wrapper exit code
  cannot substitute for the missing record.
- Local, isolated, hosted-CI, and production proof scopes remain distinct.
- A task marked done by the SOT with no PORL record keeps the SOT status and
  has UNKNOWN execution observation; no worker completion is inferred.
- No adapter method assigns, cancels, retries, merges, deploys, resets,
  activates, notifies, or writes to PORL.

## 4. DAG and merge-safety implementation

The read model derives the topological waves and dependency edges from the SOT
projection. It does not recompute or mutate the SOT. For every task pair:

1. Mark candidate-parallel only when both tasks are in the same SOT wave and
   no declared dependency path exists between them.
2. Evaluate merge-safe only after all applicable gates pass.
3. Return the first failed or unknown gate with source and observation time.

The gates are:

1. Dependency — required predecessors are resolved and have no BLOCKED,
   UNKNOWN, or NOT_RUN required check.
2. Owner/assignment — exactly one owner/PIC and one compatible active
   assignment; duplicate active claims require an explicit relation.
3. Lane — the run maps to one declared lane and permitted branch; a branch
   claimed by two lanes is a conflict.
4. Shared file — changed-file manifests are disjoint or a declared serial
   integrator owns the overlap; an unknown manifest is not safe.
5. Revision — base, head, branch, and worktree references are mutually
   consistent; missing or contradictory revision data is unknown.
6. Capability identity — duplicate capability keys require an explicit
   adapter, legacy, fallback, or replacement relation.

Generated sources and SOT files are shared files even when tasks are in the
same wave. The board must display a trace such as
candidate-parallel -> shared-file unknown -> merge-safe: false; it must never
render scheduling eligibility as merge approval.

## 5. Blockers, evidence, and display model

The first blocker panel reads the canonical rows without changing them:

- TASK-ZAI-081 remains blocked with UNKNOWN proof and BLOCKED implementation
  until the real LINE test channel, both provider/store paths, and
  Supabase/Vault/operator evidence exist in a development deployment.
- TASK-ZAI-100 -> TASK-ZAI-101 -> TASK-ZAI-102 remains an external MSP
  dependency chain. Missing thread/erase tools and the MSP canary are shown as
  blockers, not as local activation.

Every displayed run, check, revision, and evidence item must show:

- its source or source reference;
- observed/captured time;
- freshness/state;
- proof scope;
- a reason when it is unknown, stale, blocked, or not run.

The absence of a PORL record is not a failed run and is not a success. A stale
snapshot can prove the old commit only; it cannot prove current liveness.

## 6. Authorization and member boundary

The route is mounted below the existing (control) layout and
PlatformControlGuard. The server must resolve the viewer and apply
isInstallationOperator before loading the PORL adapter or rendering protected
data. A trusted non-operator receives the existing non-enumerating forbidden
behavior. Business, Tenant, Project, domain, global, and isPlatform labels do
not grant access.

The operator view is read-only and may expose only opaque, provenance-bound
worker/thread/branch/worktree/commit/check/evidence references. It must exclude
secrets, prompts, customer payloads, tokens, and arbitrary child-agent output.

/roadmap remains ADR-092's signed-in member projection. It may continue to
show the existing plan, Domain map, evidence badges, and redacted lane-level
usage within its declared window. It must not receive PORL records, assignments,
device/tool/model details, thread identifiers, or live orchestration state.
The redaction must be server-side and tested as absence from the serialized
payload.

## 7. Mobile and accessibility implementation

Mission Control reuses SUBPLAN-ROADMAP-MOBILE; it does not create a second
mobile SOT or task-status source. The implementation must:

- stack wave, blocker, evidence, and gate sections at 360–430px;
- keep DAG/evidence tables inside bounded scroll regions;
- avoid document-level horizontal overflow;
- preserve keyboard navigation and aria-expanded state for collapsible detail;
- render the same state truthfully at desktop and mobile widths;
- keep member redaction identical at all widths.

The existing /roadmap checks at 390x844 and 430x932 remain unchanged. Mission
Control adds operator-focused checks at those widths after the PORL contract is
approved.

## 8. Verification matrix

| Layer | Proof required | Scope |
|---|---|---|
| Contract | Valid/invalid envelopes, source/time requirements, state vocabulary, opaque identifiers, immutable snapshots | Unit |
| Adapter | No record, stale record, live observation, snapshot, malformed record, duplicate claim, missing manifest | Unit with explicit fixtures |
| SOT join | 118 nodes, 132 edges, 21 waves, no missing targets/cycles, no SOT writes | Unit/static |
| Merge gates | Each gate passes/fails/unknown; first-failure trace; same-wave candidate does not imply safe | Unit |
| Authorization | Operator ready; member/non-operator denied before PORL access; no protected payload on forbidden path | Viewer factory + route contract |
| Member projection | No PORL/person/device/tool/model/thread fields in serialized /roadmap payload | Unit + e2e |
| Operator browser | Blockers, live/snapshot/unknown/not-run, evidence sources, conflict trace, read-only controls | E2E |
| Mobile browser | 390x844 and 430x932, keyboard disclosure, bounded table scroll, no document overflow | E2E |
| Governance | Registry/ID ledger, graph, preflight, annotations, generated-output freshness | After second approval |
| Build/release | Tests, build, e2e, then separately hosted-CI and production evidence | Each scope labeled |

Production readiness is NOT_RUN until an actual approved production observation
and deployment evidence exist. Local or isolated success cannot be promoted by
the dashboard.

## 9. Ordered execution after second approval

1. Approve IDs and plan. Approve FEAT-044, FR-260..FR-264, the implementation
   file set, and the unresolved PORL boundary.
2. Declare identity. Add the feature/FR rows without changing existing
   subjects, run the sanctioned ID-ledger writer, and review the resulting
   diff.
3. Governance reconciliation. Run npm run govern; review graph, preflight,
   traceability, and generated outputs. Do not hand-edit generated artifacts.
4. Contract slice. Implement the PORL envelope validator and read-only adapter
   with fixture-based unit tests. No route or UI yet.
5. Read-model slice. Join the SOT DAG to normalized observations, blocker
   projections, and merge gates. Add unit tests for every unknown/conflict
   state.
6. Authorization slice. Add the route below the existing guard and prove
   pre-guard payload suppression with viewer-factory tests.
7. UI/mobile slice. Add the operator board and responsive/accessibility
   checks. Do not expose it through member navigation.
8. Full verification. Run focused tests, build, e2e, governance, and review
   evidence scopes before any deployment discussion.

If the PORL owner requires durable storage, a separate ADR and migration plan
must be approved before step 4. The first implementation remains adapter-only
until that decision is closed.

## 10. Open decisions and risks

The second approval must either resolve these or explicitly carry them as
implementation blockers:

1. PORL owning system, authentication, and whether the first adapter reads a
   remote ledger or signed/read-only receipts.
2. Freshness threshold and snapshot retention.
3. Raw versus opaque thread/worktree references and re-authentication.
4. Changed-file manifest authority and serial-integrator selection.
5. Separate /control/mission-control route versus a tab under /control/roadmap.
6. Whether a durable local receipt store is needed; no migration is planned by
   this document.

Primary risks are accidental inference from stale data, leaking operator
identity or connector details to members, marking shared-file work safe without
a manifest, and letting an external ledger outage appear as a green board.
The fail-closed response for each is explicit UNKNOWN/NOT_RUN, server-side
redaction, a failed shared-file gate, and a visible source outage.

## 11. Non-goals

This plan does not authorize a second roadmap SOT, changes to ROADMAP.md or
roadmap-sot.js, live Codex-process discovery, scheduler or assignment behavior,
cancellation/retry/merge/deploy/migration/activation, replacement of usage
telemetry or pipeline tracking, Business/Tenant data changes, raw
prompts/secrets/customer data, or production activation.

## 12. Version diff and second approval

Before: the approved design proposal existed, but the implementation plan and
registry identities were only proposed.

After: this candidate plan records allocated FEAT-044 and FR-260..FR-264, defines the
file-level implementation scope, PORL contract, DAG/merge gates,
authorization/member boundary, blocker projections, mobile checks, test
matrix, governance order, risks, and explicit open decisions.

Not changed: runtime/UI code, tests, migrations, ROADMAP.md, roadmap-sot.js,
or production. Runtime implementation remains gated separately.

Remaining implementation approval required: Please approve the PORL
open-decision boundary and runtime/UI implementation scope; code may begin
only after that approval.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.0b | 2026-09-19 | candidate | FEAT-044 and FR-260..FR-264 allocated; implementation plan remains documentation-only and runtime is gated | 33cb69c7 (base, uncommitted) | Luna Max |
