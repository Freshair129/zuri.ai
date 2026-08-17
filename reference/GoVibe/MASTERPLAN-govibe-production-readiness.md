---
title: "MASTERPLAN: GoVibe Production Readiness"
doc_id: "MASTERPLAN-GOVIBE-PRODUCTION-READINESS"
status: "approved"
version: "0.2.5"
updated: "2026-08-10"
owner: "LYRA"
ratification_authority: "Boss (CEO)"
auditor: "ATHER"
source_of_truth: true
access_scope: "H4"
complexity: "C-3"
primary_goal: "Close the verified gaps between the current developer-preview build and a defensible production claim"
live_document: true
related_docs:
  - "docs/STD-Execution-Governance.md"
  - "docs/adr/ADR-021-H-Axis-Access-Scope-Semantic-Separation.md"
  - "docs/DOC-VERSION-REGISTRY.md"
  - "docs/PRD-GoVibe-Platform-Overview.md"
  - "docs/BRD-GoVibe-Platform.md"
  - "docs/roadmap/MASTERPLAN-govibe-mvp-developer-trial.md"
  - "docs/roadmap/BACKLOG-production-readiness-execution.md"
  - "docs/specs/SPEC-Workspace-System.md"
  - "docs/features/agent-team/FEAT-Tiered-Review.md"
  - "docs/features/agent-team/FEAT-Quota-Aware-Local-LLM-Decomposition.md"
  - ".agents/pm/asset/Planning-Decomposition-Standard.md"
---

# MASTERPLAN: GoVibe Production Readiness

## 1. Purpose

This masterplan is the live plan of record for moving GoVibe from a verified **local developer
preview** to a defensible **production** claim.

It exists because a full evidence sweep on 2026-08-06 found that every automated gate passes while
several product-level claims are still unsupported: most Mission Control views have no backend
producer, the main test suite is not gated in CI, and the snapshot contract has drifted between the
TypeScript type and the runtime.

This document is **live**. Status lives in the tables below, not in a separate tracker. The roadmap
parser reads these tables directly, so editing a `Status` cell changes what Mission Control renders.

Scope boundary: this plan governs *readiness*, not new product surface. The MVP developer-trial
scope stays owned by `docs/roadmap/MASTERPLAN-govibe-mvp-developer-trial.md`; this plan depends on
it and does not supersede it.

## 2. Source-of-Truth Graph

Every phase in this plan is governed by exactly one upstream source of truth. This plan never
redefines a governed term; it points at the document that owns it.

```mermaid
graph TD
    STD["STD-Execution-Governance<br/>(C / H / R / D / W axes)"]
    ADR21["ADR-021<br/>H-Axis Semantic Separation"]
    REG["DOC-VERSION-REGISTRY<br/>(audit sitemap)"]
    BRD["BRD-GoVibe-Platform<br/>(business intent)"]
    PRD["PRD-GoVibe-Platform-Overview<br/>(product contract)"]
    MVP["MASTERPLAN<br/>MVP Developer Trial"]
    THIS["MASTERPLAN<br/>Production Readiness<br/>(this document)"]

    STD --> ADR21
    STD --> THIS
    ADR21 --> THIS
    REG --> THIS
    BRD --> PRD
    PRD --> MVP
    MVP --> THIS

    THIS --> P0["PHASE-PRD-00<br/>Governance anchor"]
    THIS --> P1["PHASE-PRD-01<br/>CI gate closure"]
    THIS --> P2["PHASE-PRD-02<br/>Snapshot contract"]
    THIS --> P3["PHASE-PRD-03<br/>UI producer wiring"]
    THIS --> P4["PHASE-PRD-04<br/>H-axis doc remediation"]
    THIS --> P5["PHASE-PRD-05<br/>Trial packaging"]
```

### 2.1 Governing Authority per Phase

| Phase | Governing SoT | What that SoT owns | This plan may not |
|---|---|---|---|
| PHASE-PRD-00 | `docs/DOC-VERSION-REGISTRY.md` | Which documents are active and canonical | Register itself without an owner ratification |
| PHASE-PRD-01 | `docs/STD-Execution-Governance.md` | Gate obligations per Complexity Level | Lower a gate to make a phase pass |
| PHASE-PRD-02 | `docs/PRD-GoVibe-Platform-Overview.md` | The MissionSnapshot product contract | Add a snapshot field without a contract decision |
| PHASE-PRD-03 | `docs/PRD-GoVibe-Platform-Overview.md` | Which views exist and what they must show | Introduce mock telemetry to fill a panel |
| PHASE-PRD-04 | `docs/adr/ADR-021-H-Axis-Access-Scope-Semantic-Separation.md` | The binding meaning of the H axis | Reinterpret H as hops, budget, or risk |
| PHASE-PRD-05 | `docs/roadmap/MASTERPLAN-govibe-mvp-developer-trial.md` | Developer-trial exit criteria | Declare trial-ready ahead of that plan |

### 2.2 Terminology Lock

This plan uses the canonical axes from `docs/STD-Execution-Governance.md` v2.4.0+ga only.
`H` is Access Scope with valid values `H0`..`H4`. `H5` and `H6` are abolished. Graph distance is
`retrieval_radius`, context allowance is `context_budget`. PHASE-PRD-04 exists because several
architecture documents still violate this lock.

## 3. Evidence Baseline

Recorded 2026-08-06 by direct execution on commit `87c313d`. Every row is a command that was run,
not a claim read from a document.

| Check | Command | Result |
|---|---|---|
| Typecheck | `npm run lint` | PASS, no errors |
| Unit tests | `npx vitest run` | PASS, 417 passed / 1 skipped across 54 files |
| Security suite | `npm run test:security` | PASS, 50/50 |
| Production build | `npm run build` | PASS, 186 kB JS / 58 kB gzip |
| Doc governance | `npm run docs:validate` | PASS with warnings |
| Roadmap containers | `npm run roadmap:validate` | PASS, 0 errors / 14 warnings |
| MCP catalog | `npm run mcp:smoke` | PASS, 15 tools / 90 roadmap nodes |
| Live sidecar | `GET /mission/snapshot` | 200 with 9 agents, 34 capabilities, 4 providers, 11 roadmap sources |
| Auth boundary | unauthenticated / foreign-origin request | 401 and 403 respectively |

### 3.1 Verified Gaps

| Gap ID | Finding | Evidence | Phase |
|---|---|---|---|
| GAP-01 | The 417-test suite, `docs:validate`, and `roadmap:validate` run in no CI workflow | Only the P0 security workflow runs on PRs, and it is path-filtered | PHASE-PRD-01 |
| GAP-02 | End-to-end CI exercises a static mockup fixture, not the application | Playwright config sets no web server and targets an HTML fixture | PHASE-PRD-01 |
| GAP-03 | Seven snapshot slices are initialised empty and never written by any producer | `scripts/mcp/runtime/snapshot-store.mjs` plus zero writes in `scripts/mcp/runtime-core.mjs` | PHASE-PRD-03 |
| GAP-04 | `orchestration` is emitted by the runtime but absent from the TypeScript contract | `src/mission/domain.ts` versus the live snapshot payload | PHASE-PRD-02 |
| GAP-05 | `heatmap` exists in the TypeScript contract but no producer emits it; `masterPlanPreview` is produced only on demand by the `masterplan.preview` command (verified live 2026-08-06), so the automatic snapshot never carries it | `src/mission/domain.ts` versus `scripts/mcp/runtime/snapshot-store.mjs`; producer in `scripts/mcp/runtime/roadmap-service.mjs` | PHASE-PRD-02 |
| GAP-06 | Nine of seventeen views render an empty state because their slice has no producer | `src/app/RenderView.tsx` cross-referenced with the live snapshot | PHASE-PRD-03 |
| GAP-07 | Four sidebar labels disagree with the on-screen view title | `src/mission/navigation.ts` versus each view header | PHASE-PRD-03 |
| GAP-08 | Active documents still use abolished `H5`/`H6` or legacy Context-Scaling-Tier semantics | `docs/architecture/C4-GoVibe-Platform.md`, `docs/architecture/SDD-Genesis-Block.md`, `docs/architecture/BLUEPRINT-Translator-Core-Slice.md`; also `docs/features/agent-team/FEAT-Quota-Aware-Local-LLM-Decomposition.md` §3 (approved doc citing "Context Scaling Tier" `H0..H6`) | PHASE-PRD-04 |
| GAP-09 | A clean checkout cannot start; the sidecar requires a token with no quickstart to create one | `.env.example` exists, no `.env` bootstrap or quickstart document | PHASE-PRD-05 |
| GAP-10 | The active board source was a June HTML validation fixture: sources without an authored updated timestamp inherit parse-time freshness, so the fixture won a permanent +20 recency bonus (score 82) and its tasks name assignees absent from the agent registry | `scripts/mcp/roadmap-parser.mjs` line 590 fallback; `docs/roadmap/ROADMAP-govibe-mcp-runtime.html` had no data-updated attribute; verified live 2026-08-08 | PHASE-PRD-03 |

### 3.2 View Wiring Baseline

Recorded from the live snapshot. This table is the acceptance surface for PHASE-PRD-03.

| View | Slice | Live count | State |
|---|---|---|---|
| A2 Roadmap Board | roadmap, roadmapSources, agents | 5 / 11 / 9 | wired |
| A3 Capability Plugins | capabilities | 34 | wired |
| A5 Agent Management | agents | 9 | wired |
| C2 Intelligence Zoo | agents, capabilities | 9 / 34 | wired |
| A1 Real-time Dashboard | metrics, reactor, workflowRuns, providers | providers only | partial |
| A4 Vault, Context and Impact | capabilities, providers, terminal, workflowRuns | three of four | partial |
| D1 Reactor Run Trigger | command dispatch only | not applicable | command-only |
| C3 SRS-G Debugger | manual ingest only | not applicable | ingest-only |
| B1 AST Hierarchy Tree | graph | 0 | unwired |
| B2 Business Specifications | specs | 0 | unwired |
| B3 Interactive Graph | graph | 0 | unwired |
| B4 Live Call Graph | graph | 0 | unwired |
| C1 Symbol Explorer Hub | symbols | 0 | unwired |
| C4 Database ERD Schema | symbols | 0 | unwired |
| C5 HNSW Vector Space Map | graph | 0 | unwired |
| D2 Cyber Reactor Heatmap | heatmap | field absent | unwired |
| D3 EABS-01 Campaign Logs | campaignLogs | 0 | unwired |

## 4. Readiness Gates

Production is claimable only when every gate below is green. A gate is never satisfied by lowering
its own threshold.

| Gate | Definition | Current |
|---|---|---|
| GATE-CI | Every pull request runs `npm run baseline:check` with no path filter | met (2026-08-08: run 31226249238 on PR #122 executed docs, roadmap, typecheck, 70 vitest files, 65 security tests, and build; baseline-check set as a required status check on main; failure path proven red on PR #123) |
| GATE-CONTRACT | The TypeScript MissionSnapshot and the runtime snapshot agree field for field | not met |
| GATE-HONESTY | Every view either shows live data or an empty state naming the missing feed, with no fabricated values | met |
| GATE-SEMANTIC | No active document uses abolished `H5`/`H6` semantics | not met |
| GATE-BOOTSTRAP | A clean checkout reaches a running Mission Control by following one document | not met |
| GATE-SECURITY | The sidecar rejects unauthenticated and foreign-origin traffic under automated test | met |

Deployment topology beyond a loopback-bound sidecar is explicitly **out of scope** for this plan.
Hosting, TLS termination, and a multi-user identity model require their own Change Request before
any production claim that involves a network-reachable deployment.

## Phases

| Phase | Goal | Governing SoT | Exit Criteria | Status | Progress |
|---|---|---|---|---|---|
| PHASE-PRD-00 | Anchor governance and register this plan | `docs/DOC-VERSION-REGISTRY.md` | This plan is registered and the agent contracts point at it | done | 100 |
| PHASE-PRD-01 | Close the CI gate so the real suite protects the branch | `docs/STD-Execution-Governance.md` | GATE-CI is met | in-progress | 75 |
| PHASE-PRD-02 | Realign the snapshot contract across TypeScript and runtime | `docs/PRD-GoVibe-Platform-Overview.md` | GATE-CONTRACT is met | planned | 0 |
| PHASE-PRD-03 | Give every view a real producer or an owned decision to retire it | `docs/PRD-GoVibe-Platform-Overview.md` | No view is unwired without a recorded decision | in-progress | 20 |
| PHASE-PRD-04 | Remove abolished H-axis semantics from active documents | `docs/adr/ADR-021-H-Axis-Access-Scope-Semantic-Separation.md` | GATE-SEMANTIC is met | planned | 0 |
| PHASE-PRD-05 | Package a repeatable clean-checkout developer trial | `docs/roadmap/MASTERPLAN-govibe-mvp-developer-trial.md` | GATE-BOOTSTRAP is met | planned | 0 |
| PHASE-PRD-06 | Bring the runtime into verified conformance with the Workspace System spec | `docs/specs/SPEC-Workspace-System.md` | Spec acceptance criteria AC-01 through AC-08 hold with recorded command evidence | done | 100 |

## Sprints

| Sprint | Parent ID | Goal | Exit Criteria | Status | Progress |
|---|---|---|---|---|---|
| SPR-PRD-00 | PHASE-PRD-00 | Register the readiness plan and bind the agent contracts to it | Registry row exists and both agent contracts cite this plan | done | 100 |
| SPR-PRD-01 | PHASE-PRD-01 | Make the full baseline gate run on every pull request | A pull request touching only frontend code still runs the full suite | in-progress | 50 |
| SPR-PRD-02 | PHASE-PRD-02 | Reconcile every MissionSnapshot field across both implementations | A contract test fails when either side adds an unmatched field | planned | 0 |
| SPR-PRD-03 | PHASE-PRD-03 | Wire the graph, symbol, and telemetry producers | Each formerly unwired view renders live data from a real feed | in-progress | 20 |
| SPR-PRD-04 | PHASE-PRD-04 | Correct the H-axis vocabulary in architecture documents | A repository scan finds no active `H5`/`H6` access semantics | planned | 0 |
| SPR-PRD-05 | PHASE-PRD-05 | Author and verify the clean-checkout quickstart | A reviewer reaches a running Mission Control from the document alone | planned | 0 |
| SPR-PRD-06 | PHASE-PRD-06 | Pin workspace-spec conformance and land the personnel identity and RBAC contracts | AC-01 through AC-06 are pinned by automated tests; the personnel and RBAC suites demonstrate AC-07 and AC-08 | done | 100 |

## Backlog Items

| ID | Parent ID | Type | Title | Priority | Owner | Status | Dependencies | Source Section |
|---|---|---|---|---|---|---|---|---|
| TASK-PRD-001 | SPR-PRD-00 | task | Register this masterplan in the document version registry | P0 | ATHER | done | - | Section 3.1 GAP-00 |
| TASK-PRD-002 | SPR-PRD-00 | task | Bind AGENTS.md and CLAUDE.md to this readiness plan | P0 | THESEUS | done | TASK-PRD-001 | Section 3.1 GAP-00 |
| TASK-PRD-003 | SPR-PRD-01 | task | Add an unfiltered baseline check workflow for every pull request | P0 | ATHER | done | TASK-PRD-002 | Section 3.1 GAP-01 |
| TASK-PRD-004 | SPR-PRD-01 | task | Point end-to-end coverage at the running application | P1 | VIBE | planned | TASK-PRD-003 | Section 3.1 GAP-02 |
| TASK-PRD-005 | SPR-PRD-02 | task | Add the orchestration slice to the MissionSnapshot contract | P0 | ARCHON | review | TASK-PRD-003 | Section 3.1 GAP-04 |
| TASK-PRD-006 | SPR-PRD-02 | task | Resolve the heatmap and master plan preview contract orphans | P1 | ARCHON | planned | TASK-PRD-005 | Section 3.1 GAP-05 |
| TASK-PRD-007 | SPR-PRD-03 | task | Publish graph and symbol producers from the workspace scan | P0 | VIBE | planned | TASK-PRD-005 | Section 3.2 |
| TASK-PRD-008 | SPR-PRD-03 | task | Reconcile sidebar labels with rendered view titles | P2 | VIBE | planned | - | Section 3.1 GAP-07 |
| TASK-PRD-009 | SPR-PRD-04 | task | Correct abolished H-axis semantics in architecture documents | P1 | ATHER | planned | - | Section 3.1 GAP-08 |
| TASK-PRD-010 | SPR-PRD-05 | task | Author the clean-checkout developer quickstart | P0 | THESEUS | planned | TASK-PRD-003 | Section 3.1 GAP-09 |
| TASK-PRD-011 | SPR-PRD-00 | task | Provide a Mission Control readiness tracking and command view | P1 | VIBE | done | TASK-PRD-001 | Section 11 |
| TASK-PRD-012 | SPR-PRD-03 | task | Roadmap source hygiene and honest recency scoring | P1 | LYRA | done | - | Section 3.1 GAP-10 |
| TASK-PRD-013 | SPR-PRD-06 | task | Pin workspace-spec acceptance criteria AC-01 through AC-06 with conformance tests | P1 | ATHER | done | - | SPEC-Workspace-System §11 |
| TASK-PRD-014 | SPR-PRD-06 | task | Implement the personnel identity model (employee_id / staff_id) | P1 | VIBE | done | - | SPEC-Workspace-System §3.3 |
| TASK-PRD-015 | SPR-PRD-06 | task | Implement RBAC core: scoped roles, deny-by-default decisions, allow/deny audit | P1 | VIBE | done | TASK-PRD-014 | SPEC-Workspace-System §6 |
| TASK-PRD-016 | SPR-PRD-06 | task | Enforce RBAC across the govibe.workspace.* tool surface | P2 | ARCHON | done | TASK-PRD-015 | SPEC-Workspace-System §6.2 |
| TASK-PRD-017 | SPR-PRD-06 | task | Validate active personnel identity at the RBAC enforcement boundary | P2 | VIBE | done | TASK-PRD-016 | SPEC-Workspace-System §3.3 |

## Assignments

| Task ID | Subject ID | Subject Type | Policy Model | Assigned At | Assigned By |
|---|---|---|---|---|---|
| TASK-PRD-001 | ATHER | agent | ABAC | 2026-08-06T00:00:00Z | Boss |
| TASK-PRD-002 | THESEUS | agent | ABAC | 2026-08-06T00:00:00Z | Boss |
| TASK-PRD-003 | ATHER | agent | ABAC | 2026-08-06T00:00:00Z | Boss |
| TASK-PRD-004 | VIBE | agent | ABAC | 2026-08-06T00:00:00Z | Boss |
| TASK-PRD-005 | ARCHON | agent | ABAC | 2026-08-06T00:00:00Z | Boss |
| TASK-PRD-006 | ARCHON | agent | ABAC | 2026-08-06T00:00:00Z | Boss |
| TASK-PRD-007 | VIBE | agent | ABAC | 2026-08-06T00:00:00Z | Boss |
| TASK-PRD-008 | VIBE | agent | ABAC | 2026-08-06T00:00:00Z | Boss |
| TASK-PRD-009 | ATHER | agent | ABAC | 2026-08-06T00:00:00Z | Boss |
| TASK-PRD-010 | THESEUS | agent | ABAC | 2026-08-06T00:00:00Z | Boss |
| TASK-PRD-011 | VIBE | agent | ABAC | 2026-08-06T00:00:00Z | Boss |
| TASK-PRD-012 | LYRA | agent | ABAC | 2026-08-08T00:00:00Z | Boss |
| TASK-PRD-013 | ATHER | agent | ABAC | 2026-08-09T00:00:00Z | Boss |
| TASK-PRD-014 | VIBE | agent | ABAC | 2026-08-09T00:00:00Z | Boss |
| TASK-PRD-015 | VIBE | agent | ABAC | 2026-08-09T00:00:00Z | Boss |
| TASK-PRD-016 | ARCHON | agent | ABAC | 2026-08-09T00:00:00Z | Boss |
| TASK-PRD-017 | VIBE | agent | ABAC | 2026-08-09T00:00:00Z | Boss |

## Handoffs

| Task ID | From ID | To ID | Required Artifact | Note | Created At | State |
|---|---|---|---|---|---|---|
| TASK-PRD-001 | ATHER | Boss | Registry row plus ratification decision | Ratified to approved 2026-08-09 by owner decision (Boss); registry synchronized in the same change | 2026-08-06T00:00:00Z | completed |
| TASK-PRD-003 | ATHER | Boss | Green pull-request run of the full baseline gate | Confirms GATE-CI before further phases start | 2026-08-06T00:00:00Z | completed |
| TASK-PRD-006 | ARCHON | Boss | Contract decision on the two orphan fields | Produce or retire is a product decision, not an implementation choice | 2026-08-06T00:00:00Z | pending |
| TASK-PRD-007 | VIBE | ATHER | Impact analysis over the changed snapshot contract | Required before the wiring change closes | 2026-08-06T00:00:00Z | pending |

## Verification

| Task ID | QA Status | Audit Status | Deployment Status | Updated At |
|---|---|---|---|---|
| TASK-PRD-001 | passed | passed | n/a | 2026-08-09T20:15:00Z |
| TASK-PRD-002 | passed | passed | n/a | 2026-08-09T21:00:00Z |
| TASK-PRD-003 | passed | passed | n/a | 2026-08-08T00:00:00Z |
| TASK-PRD-004 | pending | pending | n/a | 2026-08-06T00:00:00Z |
| TASK-PRD-005 | passed | pending | n/a | 2026-08-10T00:00:00Z |
| TASK-PRD-006 | pending | pending | n/a | 2026-08-06T00:00:00Z |
| TASK-PRD-007 | pending | pending | n/a | 2026-08-06T00:00:00Z |
| TASK-PRD-008 | pending | pending | n/a | 2026-08-06T00:00:00Z |
| TASK-PRD-009 | pending | pending | n/a | 2026-08-06T00:00:00Z |
| TASK-PRD-010 | pending | pending | n/a | 2026-08-06T00:00:00Z |
| TASK-PRD-011 | passed | passed | n/a | 2026-08-09T21:00:00Z |
| TASK-PRD-012 | passed | passed | n/a | 2026-08-09T21:00:00Z |
| TASK-PRD-013 | passed | passed | n/a | 2026-08-09T19:45:00Z |
| TASK-PRD-014 | passed | passed | n/a | 2026-08-09T19:45:00Z |
| TASK-PRD-015 | passed | passed | n/a | 2026-08-09T19:45:00Z |
| TASK-PRD-016 | passed | passed | n/a | 2026-08-09T19:45:00Z |
| TASK-PRD-017 | passed | passed | n/a | 2026-08-09T19:45:00Z |

## Task Containers

### TC-TASK-PRD-001

```yaml
task_container_id: TC-TASK-PRD-001
task_id: TASK-PRD-001
parent_phase_id: PHASE-PRD-00
parent_sprint_id: SPR-PRD-00
title: Register this masterplan in the document version registry
requirement_type: NFR
complexity: C-2
access_scope: H2
status: done
version: 0.1.0+draft
pic: ATHER
executor: THESEUS
approver: Boss
auditor: ATHER
symbol_links:
  code: scripts/docs/validate-docs.mjs
  doc: docs/DOC-VERSION-REGISTRY.md
  test: unavailable
definition_of_done:
  acceptance_criteria:
    - criterion: Given the registry contains a row for this plan, when docs:validate runs, then no doc_id, version, or status mismatch error is reported
      checked: true
  success_criteria:
    - criterion: Given a reader opens the registry, when they look for the readiness plan, then they find one row pointing at the active file path
      checked: true
  exit_criteria:
    - criterion: Given the owner ratifies the plan, when status changes from draft to approved, then the registry version and status are updated in the same change
      checked: true
changelog: Registry row authored alongside the initial readiness plan. Closed 2026-08-09 with the owner ratification of this plan to approved (0.2.0) — the registry row's version and status were updated in the same change and docs:validate reports no mismatch.
created_at: 2026-08-06T00:00:00Z,THESEUS,pending
token_telemetry:
  model_name: claude-opus-5
  context_length: 200k
  predicted_token_usage: 3000
  total_token_usage: 3000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-002

```yaml
task_container_id: TC-TASK-PRD-002
task_id: TASK-PRD-002
parent_phase_id: PHASE-PRD-00
parent_sprint_id: SPR-PRD-00
title: Bind AGENTS.md and CLAUDE.md to this readiness plan
requirement_type: NFR
complexity: C-2
access_scope: H2
status: done
version: 0.2.0
pic: THESEUS
executor: THESEUS
approver: Boss
auditor: ATHER
symbol_links:
  code: scripts/docs/validate-docs.mjs
  doc: docs/STD-Execution-Governance.md
  test: unavailable
definition_of_done:
  acceptance_criteria:
    - criterion: Given an agent starts a session, when it reads the operating contract, then it is told to consult this readiness plan before proposing readiness work
      checked: true
  success_criteria:
    - criterion: Given both contract files, when either is read alone, then the readiness plan path and its live-status rule are discoverable without another lookup
      checked: true
  exit_criteria:
    - criterion: Given docs:validate runs, when it resolves referenced paths in both contract files, then every referenced path exists
      checked: true
changelog: Verified 2026-08-09 that both AGENTS.md §11 (readiness plan of record, binds every readiness task to a Task ID) and CLAUDE.md ("Readiness plan of record" section) already cite this masterplan by path and state its live-status rule, satisfying all three criteria against the live file contents (no code change needed for the binding itself). Evidence: `npm run docs:validate` PASS with zero warnings referencing AGENTS.md, CLAUDE.md, or this masterplan's path. Closed to done as owner-directed evidence review (Boss present in session), per the WP-16/17 precedent — not an independent ATHER audit reproduction.
created_at: 2026-08-06T00:00:00Z,THESEUS,pending
token_telemetry:
  model_name: claude-opus-5
  context_length: 200k
  predicted_token_usage: 4000
  total_token_usage: 4000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-003

```yaml
task_container_id: TC-TASK-PRD-003
task_id: TASK-PRD-003
parent_phase_id: PHASE-PRD-01
parent_sprint_id: SPR-PRD-01
title: Add an unfiltered baseline check workflow for every pull request
requirement_type: NFR
complexity: C-2
access_scope: H2
status: done
version: 0.1.0+draft
pic: ATHER
executor: VIBE
approver: Boss
auditor: ATHER
symbol_links:
  code: scripts/docs/validate-roadmap-containers.mjs
  doc: docs/STD-Execution-Governance.md
  test: src/missionContract.test.ts
definition_of_done:
  acceptance_criteria:
    - criterion: Given a pull request that changes only files under src, when continuous integration runs, then the unit suite, doc validation, and roadmap validation all execute
      checked: true
  success_criteria:
    - criterion: Given a deliberately failing unit test on a branch, when the pull request is opened, then the required check reports failure
      checked: true
  exit_criteria:
    - criterion: Given the workflow is merged, when a maintainer inspects branch protection, then the baseline check is a required status check
      checked: true
changelog: Closed 2026-08-08. Evidence - green run 31226249238 (PR #122, full suite on a mixed-content PR), red run on PR #123 (deliberately failing test blocked by the required check), and baseline-check required in main branch protection.
created_at: 2026-08-06T00:00:00Z,THESEUS,pending
token_telemetry:
  model_name: claude-opus-5
  context_length: 200k
  predicted_token_usage: 6000
  total_token_usage: 6000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-004

```yaml
task_container_id: TC-TASK-PRD-004
task_id: TASK-PRD-004
parent_phase_id: PHASE-PRD-01
parent_sprint_id: SPR-PRD-01
title: Point end-to-end coverage at the running application
requirement_type: FR
complexity: C-2
access_scope: H2
status: planned
version: 0.1.0+draft
pic: VIBE
executor: VIBE
approver: Boss
auditor: ATHER
symbol_links:
  code: src/app/RenderView.tsx
  doc: docs/PRD-GoVibe-Platform-Overview.md
  test: src/missionGateway.test.ts
definition_of_done:
  acceptance_criteria:
    - criterion: Given the end-to-end configuration, when a run starts, then it boots the development server and the sidecar rather than loading a static fixture
      checked: false
  success_criteria:
    - criterion: Given a wired view, when the end-to-end run inspects it, then it asserts on live snapshot data rather than fixture markup
      checked: false
  exit_criteria:
    - criterion: Given a regression that breaks the roadmap board, when the end-to-end suite runs, then it fails
      checked: false
changelog: End-to-end coverage gap recorded from the 2026-08-06 evidence sweep.
created_at: 2026-08-06T00:00:00Z,THESEUS,pending
token_telemetry:
  model_name: claude-opus-5
  context_length: 200k
  predicted_token_usage: 9000
  total_token_usage: 9000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-005

```yaml
task_container_id: TC-TASK-PRD-005
task_id: TASK-PRD-005
parent_phase_id: PHASE-PRD-02
parent_sprint_id: SPR-PRD-02
title: Add the orchestration slice to the MissionSnapshot contract
requirement_type: FR
complexity: C-2
access_scope: H2
status: review
version: 0.2.0+draft
pic: ARCHON
executor: VIBE
approver: Boss
auditor: ATHER
symbol_links:
  code: src/mission/domain.ts
  doc: docs/change-control/change-requests/CR-2026-08-10-MissionSnapshot-Orchestration-Contract.md
  test: scripts/mcp/runtime/roadmap-service.test.mjs
definition_of_done:
  acceptance_criteria:
    - criterion: Given the runtime emits an orchestration slice, when the TypeScript contract is typechecked, then the slice is a declared field with an explicit shape
      checked: true
  success_criteria:
    - criterion: Given a consumer reads the orchestration waves, when it does so through the snapshot type, then no cast or optional-chaining escape hatch is required
      checked: true
  exit_criteria:
    - criterion: Given a contract test comparing both implementations, when either side declares a field the other lacks, then the test fails
      checked: true
changelog: Owner-approved CR-2026-08-10-MISSIONSNAPSHOT-ORCHESTRATION-CONTRACT implemented. Runtime output now conforms to explicit TypeScript and protocol-v2 snapshot/event contracts; targeted contract/runtime tests passed (23), lint and production build passed. QA passed; ATHER audit remains pending.
created_at: 2026-08-06T00:00:00Z,THESEUS,pending
token_telemetry:
  model_name: claude-opus-5
  context_length: 200k
  predicted_token_usage: 5000
  total_token_usage: 5000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-006

```yaml
task_container_id: TC-TASK-PRD-006
task_id: TASK-PRD-006
parent_phase_id: PHASE-PRD-02
parent_sprint_id: SPR-PRD-02
title: Resolve the heatmap and master plan preview contract orphans
requirement_type: FR
complexity: C-2
access_scope: H2
status: planned
version: 0.1.0+draft
pic: ARCHON
executor: VIBE
approver: Boss
auditor: ATHER
symbol_links:
  code: scripts/mcp/runtime/snapshot-store.mjs
  doc: docs/PRD-GoVibe-Platform-Overview.md
  test: src/mission/snapshot-reducer.test.ts
definition_of_done:
  acceptance_criteria:
    - criterion: Given the owner decides produce or retire for each orphan field, when the decision is recorded, then the code follows it in the same change
      checked: false
  success_criteria:
    - criterion: Given the heatmap field survives the decision, when the runtime publishes a snapshot, then the field carries real reactor data rather than an absent key
      checked: false
  exit_criteria:
    - criterion: Given both orphan fields are resolved, when the contract test runs, then no field exists on one side only
      checked: false
changelog: Two orphan contract fields recorded from the 2026-08-06 live snapshot comparison.
created_at: 2026-08-06T00:00:00Z,THESEUS,pending
token_telemetry:
  model_name: claude-opus-5
  context_length: 200k
  predicted_token_usage: 7000
  total_token_usage: 7000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-007

```yaml
task_container_id: TC-TASK-PRD-007
task_id: TASK-PRD-007
parent_phase_id: PHASE-PRD-03
parent_sprint_id: SPR-PRD-03
title: Publish graph and symbol producers from the workspace scan
requirement_type: FR
complexity: C-3
access_scope: H3
status: planned
version: 0.1.0+draft
pic: VIBE
executor: VIBE
approver: Boss
auditor: ATHER
symbol_links:
  code: scripts/mcp/runtime-core.mjs
  doc: docs/PRD-GoVibe-Platform-Overview.md
  test: scripts/mcp/smoke-test.mjs
definition_of_done:
  acceptance_criteria:
    - criterion: Given a completed workspace scan, when the runtime publishes a snapshot, then the graph and symbol slices carry the discovered nodes rather than empty arrays
      checked: false
  success_criteria:
    - criterion: Given the graph slice is populated, when a reviewer opens the AST tree, interactive graph, call graph, symbol explorer, ERD, and vector map views, then each renders discovered data
      checked: false
  exit_criteria:
    - criterion: Given no scan has run, when those views render, then they still show an empty state that names the missing feed and never a fabricated value
      checked: false
changelog: Seven unproduced snapshot slices recorded from the 2026-08-06 producer audit.
created_at: 2026-08-06T00:00:00Z,THESEUS,pending
token_telemetry:
  model_name: claude-opus-5
  context_length: 200k
  predicted_token_usage: 22000
  total_token_usage: 22000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-008

```yaml
task_container_id: TC-TASK-PRD-008
task_id: TASK-PRD-008
parent_phase_id: PHASE-PRD-03
parent_sprint_id: SPR-PRD-03
title: Reconcile sidebar labels with rendered view titles
requirement_type: NFR
complexity: C-1
access_scope: H1
status: planned
version: 0.1.0+draft
pic: VIBE
executor: VIBE
approver: Boss
auditor: ATHER
symbol_links:
  code: src/mission/navigation.ts
  doc: docs/PRD-GoVibe-Platform-Overview.md
  test: src/missionContract.test.ts
definition_of_done:
  acceptance_criteria:
    - criterion: Given a user selects any sidebar entry, when the view renders, then the on-screen title matches the sidebar label or the difference is a recorded product decision
      checked: false
  success_criteria:
    - criterion: Given the four known mismatches, when the change lands, then each is either renamed or documented as intentional
      checked: false
  exit_criteria:
    - criterion: Given a test that compares the navigation map to each view header, when a future rename desynchronises them, then the test fails
      checked: false
changelog: Four label mismatches recorded from the 2026-08-06 navigation audit.
created_at: 2026-08-06T00:00:00Z,THESEUS,pending
token_telemetry:
  model_name: claude-opus-5
  context_length: 200k
  predicted_token_usage: 4000
  total_token_usage: 4000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-009

```yaml
task_container_id: TC-TASK-PRD-009
task_id: TASK-PRD-009
parent_phase_id: PHASE-PRD-04
parent_sprint_id: SPR-PRD-04
title: Correct abolished H-axis semantics in architecture documents
requirement_type: NFR
complexity: C-3
access_scope: H3
status: planned
version: 0.1.0+draft
pic: ATHER
executor: THESEUS
approver: Boss
auditor: ATHER
symbol_links:
  code: scripts/docs/validate-docs.mjs
  doc: docs/adr/ADR-021-H-Axis-Access-Scope-Semantic-Separation.md
  test: unavailable
definition_of_done:
  acceptance_criteria:
    - criterion: Given the platform C4, genesis block design, and translator blueprint, when each is read, then graph distance is expressed as retrieval radius and never as an H tier
      checked: false
  success_criteria:
    - criterion: Given a repository scan for active H5 or H6 usage, when it runs outside archive and audit paths, then it returns no active access semantics
      checked: false
  exit_criteria:
    - criterion: Given the MVP developer trial plan declares a planning tier, when it is corrected, then it uses a valid access scope between H0 and H4
      checked: false
changelog: Four active documents carrying abolished H-axis semantics recorded on 2026-08-06.
created_at: 2026-08-06T00:00:00Z,THESEUS,pending
token_telemetry:
  model_name: claude-opus-5
  context_length: 200k
  predicted_token_usage: 12000
  total_token_usage: 12000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-010

```yaml
task_container_id: TC-TASK-PRD-010
task_id: TASK-PRD-010
parent_phase_id: PHASE-PRD-05
parent_sprint_id: SPR-PRD-05
title: Author the clean-checkout developer quickstart
requirement_type: NFR
complexity: C-2
access_scope: H2
status: planned
version: 0.1.0+draft
pic: THESEUS
executor: THESEUS
approver: Boss
auditor: ATHER
symbol_links:
  code: scripts/mcp/sidecar-server.mjs
  doc: docs/roadmap/MASTERPLAN-govibe-mvp-developer-trial.md
  test: scripts/mcp/smoke-test.mjs
definition_of_done:
  acceptance_criteria:
    - criterion: Given a clean checkout, when a developer follows the quickstart end to end, then Mission Control reports a connected state without further guesswork
      checked: false
  success_criteria:
    - criterion: Given the quickstart covers token creation, when a developer follows it, then the sidecar starts without the missing-token error
      checked: false
  exit_criteria:
    - criterion: Given a reviewer who has never run the project, when they follow the quickstart unaided, then they reach a connected Mission Control and record the result
      checked: false
changelog: Clean-checkout bootstrap gap recorded from the 2026-08-06 evidence sweep.
created_at: 2026-08-06T00:00:00Z,THESEUS,pending
token_telemetry:
  model_name: claude-opus-5
  context_length: 200k
  predicted_token_usage: 8000
  total_token_usage: 8000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-011

```yaml
task_container_id: TC-TASK-PRD-011
task_id: TASK-PRD-011
parent_phase_id: PHASE-PRD-00
parent_sprint_id: SPR-PRD-00
title: Provide a Mission Control readiness tracking and command view
requirement_type: FR
complexity: C-2
access_scope: H2
status: done
version: 0.1.1
pic: VIBE
executor: VIBE
approver: Boss
auditor: ATHER
symbol_links:
  code: src/app/RenderView.tsx
  doc: docs/roadmap/MASTERPLAN-govibe-production-readiness.md
  test: src/features/readiness/readinessPlan.test.ts
definition_of_done:
  acceptance_criteria:
    - criterion: Given the roadmap sources feed contains the readiness plan, when the readiness view renders, then registration status (approval, active flag, score) comes from live snapshot data with no fabricated values
      checked: true
  success_criteria:
    - criterion: Given the operator issues the load or preview command from the view, when the runtime reloads the source, then the plan's phases, sprints, and tasks render in the view from the returned snapshot
      checked: true
  exit_criteria:
    - criterion: Given the plan is absent from the feed or not yet loaded, when the view renders, then it shows an empty state naming the missing feed, and npm run lint plus the readiness helper vitest file pass with recorded output
      checked: true
changelog: Readiness tracking and command surface bound to existing roadmap.select and masterplan.preview commands; no backend change. Re-verified 2026-08-09 with fresh evidence — `npm run lint` clean, `npx vitest run src/features/readiness/readinessPlan.test.ts` 5/5 passed, full suite 74 files/618 passed/1 skipped plus 65 security tests green. Also picked up ReadinessControlView.tsx's honest-empty-state fallback for a missing updatedAt landed under TASK-PRD-012 (`Updated: unknown (no authored update date)` instead of a blank field). Closed to done as owner-directed evidence review (Boss present in session), per the WP-16/17 precedent.
created_at: 2026-08-06T00:00:00Z,VIBE,pending
token_telemetry:
  model_name: claude-fable-5
  context_length: 200k
  predicted_token_usage: 9000
  total_token_usage: 9000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-012

```yaml
task_container_id: TC-TASK-PRD-012
task_id: TASK-PRD-012
parent_phase_id: PHASE-PRD-03
parent_sprint_id: SPR-PRD-03
title: Roadmap source hygiene and honest recency scoring
requirement_type: NFR
complexity: C-2
access_scope: H2
status: done
version: 0.2.0
pic: LYRA
executor: VIBE
approver: Boss
auditor: ATHER
symbol_links:
  code: scripts/mcp/roadmap-parser.mjs
  doc: docs/roadmap/MASTERPLAN-govibe-production-readiness.md
  test: src/roadmapParser.test.ts
definition_of_done:
  acceptance_criteria:
    - criterion: Given a roadmap source with no authored updated timestamp, when sources are scored, then it receives no recency bonus and a test pins that behaviour
      checked: true
  success_criteria:
    - criterion: Given the HTML validation fixture is demoted to draft with its real updated date, when the runtime selects the active source without an environment override, then an approved real plan wins the board
      checked: true
  exit_criteria:
    - criterion: Given the roadmap sources list renders, when a reviewer inspects updatedAt values, then no source reports parse time as its updated date
      checked: true
changelog: Opened 2026-08-08 after the live A2 audit found the validation fixture holding the board through the parse-time freshness fallback. Fixture demotion and its authored data-updated date landed with the opening row; this change lands the scorer fix and its tests. Root cause: `scripts/mcp/roadmap-parser.mjs` set `updatedAt: data.updated ?? parsedAt` (markdown) and `updatedAt: contractRoot.getAttribute("data-updated") ?? parsedAt` (HTML), so an unauthored source's updatedAt silently became parse time (now) — the newest possible timestamp — instead of staying absent. Fix: both paths now use `|| undefined`, so an unauthored source carries no updatedAt at all; `scripts/mcp/runtime/roadmap-service.mjs`'s `scoreApprovedSources` already guards recency scoring with `Number.isFinite(Date.parse(...))`, so an undefined updatedAt now correctly yields zero recency bonus with no scorer change needed there beyond exporting the function for direct testing. `ReadinessControlView.tsx` updated to render "unknown (no authored update date)" instead of a blank field when updatedAt is absent, so no view reports a fake date either (exit criterion). Evidence: two new regression tests in `scripts/mcp/runtime/roadmap-service.test.mjs` pin that an undated source never gets the "recent" score tag and never outranks a dated one; two new tests in `src/roadmapParser.test.ts` (plus fixture `src/__fixtures__/BACKLOG-parser-fixture-no-updated.md`) pin that an unauthored source's parsed updatedAt is `undefined`, not a timestamp. The HTML validation fixture (`docs/roadmap/ROADMAP-govibe-mcp-runtime.html`) stays draft with its authored `data-updated="2026-08-03"`, and draft sources are excluded from board selection regardless of score (`roadmap-service.test.mjs`'s existing `reloadRoadmap()` assertion continues to resolve `approvalStatus: "approved"`), satisfying the success criterion independently of the scorer fix. Full suite green: 74 files / 618 passed / 1 skipped plus 65 security tests; `npm run lint` clean. Closed to done as owner-directed evidence review (Boss present in session), per the WP-16/17 precedent — not an independent ATHER audit reproduction.
created_at: 2026-08-08T00:00:00Z,LYRA,pending
token_telemetry:
  model_name: resolved-by-router
  context_length: 200k
  predicted_token_usage: 6000
  total_token_usage: 6000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-013

```yaml
task_container_id: TC-TASK-PRD-013
task_id: TASK-PRD-013
parent_phase_id: PHASE-PRD-06
parent_sprint_id: SPR-PRD-06
title: Pin workspace-spec acceptance criteria AC-01 through AC-06 with conformance tests
requirement_type: NFR
complexity: C-2
access_scope: H2
status: done
version: 0.2.0+draft
pic: ATHER
executor: VIBE
approver: Boss
auditor: ARCHON
symbol_links:
  code: packages/govibe-core/src/workspace.mjs
  doc: docs/specs/SPEC-Workspace-System.md
  test: packages/govibe-core/src/workspace-spec-conformance.test.mjs
definition_of_done:
  acceptance_criteria:
    - criterion: Given a fresh temporary workspace with an MSP stub, when govibe.workspace.initialize runs, then every §4 state file exists with its exact schema string and §3-derived identities, and a rerun leaves on-disk state unchanged while reusing the same deterministic MSP recordId (AC-01, AC-02)
      checked: true
  success_criteria:
    - criterion: Given a state file whose schema or workspaceId is tampered, when initialize reruns, then it fails with `Incompatible existing state` and the file is not rewritten; and given no MSP client, when initialize runs, then it fails before any registration side effect (AC-03, AC-04)
      checked: true
  exit_criteria:
    - criterion: Given a seeded change in the impact fixture graph, when govibe.workspace.impact runs, then relation chain, distance, score, required action, and unresolved links are asserted per artifact; and a repository scan test proves no workspace schema, symbol, or metadata carries legacy H semantics (AC-05, AC-06)
      checked: true
changelog: Opened 2026-08-09 to bind SPEC-Workspace-System §11 acceptance criteria to executable evidence before the spec can be ratified. Landed 2026-08-09 as packages/govibe-core/src/workspace-spec-conformance.test.mjs (9 tests, one describe block per AC) — identity derivation replicated independently of vaults.mjs, AC-02 asserts byte-identical state and a reused msp_workspace_register idempotency_key, AC-06 scans govibe-core and scripts/mcp sources with dynamically assembled forbidden patterns plus a scanned-file-count guard against vacuous passes. Evidence `npx vitest run packages/govibe-core/src/workspace-spec-conformance.test.mjs` 9 passed; full `npm test` 71 files, 567 passed, 1 skipped, 65 security tests passed. Awaiting ARCHON audit and Boss approval.
created_at: 2026-08-09T00:00:00Z,LYRA,pending
token_telemetry:
  model_name: resolved-by-router
  context_length: 200k
  predicted_token_usage: 8000
  total_token_usage: 8000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-014

```yaml
task_container_id: TC-TASK-PRD-014
task_id: TASK-PRD-014
parent_phase_id: PHASE-PRD-06
parent_sprint_id: SPR-PRD-06
title: Implement the personnel identity model (employee_id / staff_id)
requirement_type: FR
complexity: C-2
access_scope: H2
status: done
version: 0.2.0+draft
pic: VIBE
executor: VIBE
approver: Boss
auditor: ATHER
symbol_links:
  code: packages/govibe-core/src/personnel.mjs
  doc: docs/specs/SPEC-Workspace-System.md
  test: packages/govibe-core/src/personnel.test.mjs
definition_of_done:
  acceptance_criteria:
    - criterion: Given a personnel record created as permanent or contract, when it is validated, then it carries exactly one active ID matching its namespace pattern and employment_type discriminator, and issuing a second active ID for the same person fails
      checked: true
  success_criteria:
    - criterion: Given a contract-to-permanent conversion, when the new employee_id is issued, then the staff_id is retired with a recorded supersedes link and its audit history remains readable under the retired ID (AC-07)
      checked: true
  exit_criteria:
    - criterion: Given personnel identity is available, when a govibe.* tool call is attributed, then the actor value is the active employee_id or staff_id, and no personnel ID appears in any vault binding record
      checked: true
changelog: Opened 2026-08-09 to implement SPEC-Workspace-System §3.3. Exit criterion closed 2026-08-09 by TASK-PRD-017 -- the enforcement boundary validates employee_/staff_ actors as active identities against .govibe/personnel.json, pinned by the retired-vs-active conversion tests in scripts/mcp/rbac-enforcement.test.mjs; the vault-binding half was already pinned by personnel.test.mjs. Landed 2026-08-09 as packages/govibe-core/src/personnel.mjs (registry with single-active-identity and never-reuse enforcement, cross-type conversion via supersedes, append-only audit, export/import round-trip) plus the vaults.mjs rule-4 guard rejecting employee_/staff_ agent identifiers. Evidence `npx vitest run packages/govibe-core/src/personnel.test.mjs` 15 passed. The registry-level attribution half of the exit criterion (resolveActor returns the active ID; personnel IDs cannot enter vault bindings) is pinned; the criterion stays unticked until govibe.* tool dispatch consumes personnel attribution under TASK-PRD-016. Impact run (runtime_behavior_change over vaults/personnel/index) reviewed: bin/init.mjs unaffected (default agent id), spec §3.3 status note updated to 0.2.1+draft in the same change.
created_at: 2026-08-09T00:00:00Z,LYRA,pending
token_telemetry:
  model_name: resolved-by-router
  context_length: 200k
  predicted_token_usage: 12000
  total_token_usage: 12000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-015

```yaml
task_container_id: TC-TASK-PRD-015
task_id: TASK-PRD-015
parent_phase_id: PHASE-PRD-06
parent_sprint_id: SPR-PRD-06
title: Implement RBAC core with scoped roles, deny-by-default decisions, and allow/deny audit
requirement_type: FR
complexity: C-2
access_scope: H2
status: done
version: 0.2.0+draft
pic: VIBE
executor: VIBE
approver: Boss
auditor: ATHER
symbol_links:
  code: packages/govibe-core/src/rbac.mjs
  doc: docs/specs/SPEC-Workspace-System.md
  test: packages/govibe-core/src/rbac.test.mjs
definition_of_done:
  acceptance_criteria:
    - criterion: Given a subject with no covering role assignment in the target scope, when any workspace operation is evaluated, then the decision is deny and it is recorded with subject ID, role, scope, operation, and timestamp (AC-08)
      checked: true
  success_criteria:
    - criterion: Given the §6.2 permission matrix, when a test sweep evaluates every role against every listed operation, then allow and deny match the matrix exactly, and granting the owner role to a staff_id subject is rejected
      checked: true
  exit_criteria:
    - criterion: Given an RBAC grant broader than the executor's H access scope, when the effective permission is computed, then the intersection rule applies and no call exceeds the H ceiling
      checked: true
changelog: Opened 2026-08-09 to implement SPEC-Workspace-System §6. Landed 2026-08-09 as packages/govibe-core/src/rbac.mjs — deny-by-default decisions over scoped assignments (project scope covers its workspaces, no global grants), the §6.2 matrix encoded operation-by-operation, §6.3 staff ceiling (owner banned, maintainer only with a recorded owner approval in scope) and separation of duties on approval operations, §6.1 H-ceiling intersection with required scopes from the §7 table (unknown scopes such as H5 rejected), and §6.4 audit of every allow, deny, grant, and revoke with snapshot round-trip. Evidence `npx vitest run packages/govibe-core/src/rbac.test.mjs` 16 passed, including a transcribed-matrix sweep asserting all 52 role-operation cells; full suite 73 files / 598 passed / 1 skipped; security 65 passed. All three criteria are pinned at registry level; live tool-dispatch enforcement is TASK-PRD-016. Spec §6 status note updated to 0.2.2+draft in the same change. Awaiting ATHER audit and Boss approval.
created_at: 2026-08-09T00:00:00Z,LYRA,pending
token_telemetry:
  model_name: resolved-by-router
  context_length: 200k
  predicted_token_usage: 16000
  total_token_usage: 16000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-016

```yaml
task_container_id: TC-TASK-PRD-016
task_id: TASK-PRD-016
parent_phase_id: PHASE-PRD-06
parent_sprint_id: SPR-PRD-06
title: Enforce RBAC across the govibe.workspace.* tool surface
requirement_type: FR
complexity: C-2
access_scope: H2
status: done
version: 0.2.0+draft
pic: ARCHON
executor: VIBE
approver: Boss
auditor: ATHER
symbol_links:
  code: scripts/mcp/runtime/rbac-enforcement.mjs
  doc: docs/specs/SPEC-Workspace-System.md
  test: scripts/mcp/rbac-enforcement.test.mjs
definition_of_done:
  acceptance_criteria:
    - criterion: Given RBAC enforcement is active, when any govibe.workspace.* tool is dispatched, then a decision point runs before the handler body and an unauthorized call returns a governed error with no side effects
      checked: true
  success_criteria:
    - criterion: Given a promotion or sign-off request executed by one subject, when the same subject attempts to approve it, then separation of duties rejects the approval and the denial is auditable
      checked: true
  exit_criteria:
    - criterion: Given default role assignments, when mcp:smoke and the runtime test suite run with enforcement active, then existing governed flows still pass and the AC-08 evidence is attached to this container
      checked: true
changelog: Opened 2026-08-09 to wire the TASK-PRD-015 RBAC core into tool dispatch per SPEC-Workspace-System §6.2 and §6.3. Landed 2026-08-09 as scripts/mcp/runtime/rbac-enforcement.mjs called from handleToolCall before the dispatch switch — per-workspace activation via .govibe/rbac.json (govibe-rbac-state/v1, unknown schemas hard-fail), scan split into deep/l1 operations, subject namespace routing, H-ceiling from workspace state, allow/deny audit appended to .govibe/rbac-audit.jsonl, and denials thrown as RbacDenialError before any handler side effect. Evidence: enforcement suite 11 passed, including dispatch-level proof that a deny surfaces before the handler body and an allow falls through to it, and the separation-of-duties denial recorded in the audit log (AC-08); mcp:smoke PASS (15 tools); full suite with enforcement active 74 files / 609 passed / 1 skipped; security 65 passed. Impact reviewed: govibe-mcp-server.mjs already wraps denials as JSON-RPC errors; LLD-GoVibe-MCP-Tools line 151 called for this enforcement. Active-identity validation against a personnel registry noted open in the spec §3.3 note and tracked as TASK-PRD-017. Awaiting ATHER audit and Boss approval.
created_at: 2026-08-09T00:00:00Z,LYRA,pending
token_telemetry:
  model_name: resolved-by-router
  context_length: 200k
  predicted_token_usage: 10000
  total_token_usage: 10000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

### TC-TASK-PRD-017

```yaml
task_container_id: TC-TASK-PRD-017
task_id: TASK-PRD-017
parent_phase_id: PHASE-PRD-06
parent_sprint_id: SPR-PRD-06
title: Validate active personnel identity at the RBAC enforcement boundary
requirement_type: FR
complexity: C-2
access_scope: H2
status: done
version: 0.2.0+draft
pic: VIBE
executor: VIBE
approver: Boss
auditor: ATHER
symbol_links:
  code: scripts/mcp/runtime/rbac-enforcement.mjs
  doc: docs/specs/SPEC-Workspace-System.md
  test: scripts/mcp/rbac-enforcement.test.mjs
definition_of_done:
  acceptance_criteria:
    - criterion: Given an RBAC-enabled workspace with a materialized personnel registry snapshot, when a tool call presents an unknown or retired employee_/staff_ actor, then the call is denied before the handler body and the denial is audited with a distinct reason separating unknown from retired identities
      checked: true
  success_criteria:
    - criterion: Given a person converted from contract to permanent, when the retired staff_id is presented as the actor, then it is denied while the active employee_id passes attribution and is evaluated against its own role assignments
      checked: true
  exit_criteria:
    - criterion: Given this validation lands with test evidence, when TASK-PRD-014's exit criterion is re-evaluated, then it is ticked in the same change that removes the open-item sentence from the spec §3.3 status note
      checked: true
changelog: Opened 2026-08-09 from the TASK-PRD-016 review finding recorded in the spec §3.3 note (0.2.3+draft) — RBAC enforcement attributes calls under employee_/staff_ actor values but does not yet verify the presented ID is the person's active identity. Scope is the enforcement-boundary wiring of the TASK-PRD-014 personnel registry snapshot; agent actors are unaffected. Also closes TASK-PRD-014's open exit criterion on completion. Landed 2026-08-09 in scripts/mcp/runtime/rbac-enforcement.mjs — when .govibe/personnel.json (govibe-personnel-registry/v1) exists, employee_/staff_ actors resolve through the real personnel registry: unknown IDs deny as unknown_personnel_identity, retired IDs as retired_personnel_identity, both audited before the handler body; unknown snapshot schemas hard-fail; agent actors and snapshot-less workspaces keep prior posture. Evidence: enforcement suite 16 passed (5 new, including the conversion case built from the live personnel registry export); mcp:smoke PASS; full suite 74 files / 614 passed / 1 skipped; security 65 passed. TASK-PRD-014's exit criterion ticked and the spec §3.3 open-item sentence removed in this same change (spec 0.2.4+draft). Awaiting ATHER audit and Boss approval.
created_at: 2026-08-09T00:00:00Z,LYRA,pending
token_telemetry:
  model_name: resolved-by-router
  context_length: 200k
  predicted_token_usage: 8000
  total_token_usage: 8000
ui_state:
  dropdown_default: expanded
  expanded: true
  disabled_reason: ""
```

## 11. Live Status Protocol

This document is the status store. There is no second tracker to reconcile.

1. Update the `Status` and `Progress` cells in the Phases, Sprints, and Backlog Items tables. The
   roadmap parser reads those cells directly, so Mission Control reflects the edit on reload.
2. Update the matching Task Container `status` and tick the relevant Definition-of-Done criterion.
   A criterion may only be ticked when its stated evidence exists.
3. Record the outcome in the Verification table. A task is not complete while its QA or audit
   status is pending.
4. Re-run `npm run docs:validate` and `npm run roadmap:validate` after any edit to this file.
5. Never mark a Readiness Gate met without the command output that proves it. Evidence recorded in
   Section 3 must be reproducible by re-running the listed command.

Status vocabulary must use tokens the roadmap parser recognises: `planned`, `in-progress`, `blocked`,
`ready`, `assigned`, `review`, `done`. Any other token silently degrades to `planned` on the board,
so `in_progress` with an underscore is wrong and will not surface as active work. Progress is an
integer percentage.

### 11.1 Execution Decomposition and Tiered Review

Execution-level decomposition of local-eligible tasks lives in
`docs/roadmap/BACKLOG-production-readiness-execution.md`. That backlog owns HOW; this plan stays
WHAT. Binding rules:

- Packet policy follows `docs/features/agent-team/FEAT-Quota-Aware-Local-LLM-Decomposition.md`
  (approved): micro/atomic packets for local models, lead agent keeps planning and verification.
- Review gating follows `docs/features/agent-team/FEAT-Tiered-Review.md`: `L0` deterministic checks
  run before any LLM review, `L1` local-SLM review is escalate-only, `L2` frontier sign-off happens
  once per composed change. No output that fails `L0` may consume LLM review tokens.
- Local packet workers run on the `T-ctx` context profile per `AGENTS.md` §5; `L2`/audit gates run
  on `M-ctx`.
- Model selection is router-resolved per `docs/STD-SLM-Tiered-Routing.md` (GoVibe canonical;
  `T0..T3` ladder, one-rung escalation, cheap-eligibility only with a deterministic verify
  command; the RWANG tiered-swarm copies are mirrors). Packets declare a `tier_hint`, never a
  concrete model as a requirement.
- A masterplan task decomposed there (currently `TASK-PRD-005`, `TASK-PRD-008`) is marked done only
  from the backlog's recorded gate evidence, in the same change that closes the backlog task.

### 11.2 Per-Task Execution Order (Docs → Links → Code)

Every task in this plan and its execution backlog follows document-driven order. Skipping a step
invalidates the evidence chain:

1. **Doc first.** The governing SoT from §2.1 carries the decision or spec change before
   implementation starts. Where the change is a contract field, the recorded owner decision
   precedes the code and lands in the same change.
2. **Links before code.** The Task Container is complete — including `symbol_links.code`,
   `symbol_links.doc`, `symbol_links.test` and testable Given/When/Then criteria — before the
   task may promote to the board. This is machine-enforced: the roadmap Definition-of-Ready gate
   fails the build on an incomplete container in an approved source.
3. **Code with gate evidence.** Implementation lands only through the tiered review gate of
   §11.1; L0 evidence is attached to the criteria it ticks.
4. **Impact before completion.** Reverse-dependency impact analysis runs and required dependents
   are updated before the task is marked done (`AGENTS.md` §8.3).

Phases execute **dependency-ordered, not number-ordered**. PHASE-PRD-04 is documentation
remediation with no dependency on the code phases and should start before or alongside them —
its position in the numbering is not a licence to defer semantic doc corrections until after
code lands.

### 11.3 Promotion Rule

This plan was ratified to `approved` on 2026-08-09 by owner decision (Boss). The roadmap container
gate therefore enforces completeness as hard errors for this source: any future task added here
must land with a complete Task Container in the same change or the build fails. The zero-error
gate run confirming ratification is recorded in the 0.2.0 changelog row. Status changes between
`draft` and `approved` remain an owner decision and must not be self-applied by an executing
agent.

## 12. Risks

| Risk | Impact | Control |
|---|---|---|
| Wiring work is used to justify fabricated telemetry | Product rule violation and loss of trust | Empty states remain mandatory until a real feed exists |
| The readiness plan competes with the MVP developer-trial plan | Two conflicting boards | Section 1 scope boundary; this plan depends on the MVP plan and never supersedes it |
| Ratifying to approved before containers are complete | Roadmap gate fails the build | Section 11.3 promotion rule; containers authored complete while still draft |
| CI gate closure surfaces a large backlog of latent failures | Phase 1 stalls | Land the workflow first and triage findings as new backlog items rather than weakening the gate |
| Production is claimed on the strength of green gates alone | Overstated readiness | Section 4 gates are necessary, not sufficient; network deployment requires its own Change Request |

## 13. Changelog

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.2.5 | 2026-08-10 | approved | TASK-PRD-005 moved to review after the owner-approved orchestration contract landed: `MissionSnapshot.orchestration` is required with typed waves/tasks, runtime event validation is fail-closed, the reducer materializes updates, and protocol moves to 2.0.0 / compatibility 2. QA evidence is local targeted tests (23), lint, and production build; ATHER audit remains pending. | pending | ATHER |
| 0.2.1 | 2026-08-09 | approved | Closed the three remaining SPR-PRD-00/03 tasks to done in one owner-directed session (Boss instruction, following the WP-16/17 precedent — recorded as such, not as an independent ATHER audit reproduction). TASK-PRD-002: verified AGENTS.md §11 and CLAUDE.md already bind readiness work to this plan by path with a live-status rule, confirmed by a clean `docs:validate` run; no code change needed. TASK-PRD-011: re-verified the readiness view's DoD with fresh evidence (`npm run lint` clean, `readinessPlan.test.ts` 5/5) and picked up TASK-PRD-012's honest-empty-state fix. TASK-PRD-012 (GAP-10): fixed the recency scorer bug in `scripts/mcp/roadmap-parser.mjs` — an unauthored source's `updatedAt` fell back to parse time (now) instead of staying absent, letting it masquerade as the newest source; both the markdown and HTML parse paths now use `|| undefined`, and `scoreApprovedSources` (exported from `scripts/mcp/runtime/roadmap-service.mjs` for testability) already zeroes the recency bonus for a non-finite date. `ReadinessControlView.tsx` now renders "unknown (no authored update date)" instead of a blank field. Added regression tests in `scripts/mcp/runtime/roadmap-service.test.mjs` and `src/roadmapParser.test.ts` (new fixture `BACKLOG-parser-fixture-no-updated.md`) pinning the fix. SPR-PRD-00 and PHASE-PRD-00 closed to done (all constituent tasks complete); SPR-PRD-03/PHASE-PRD-03 progress moved 10 → 20 (TASK-PRD-007/008 remain open). Evidence: full suite 74 files / 618 passed / 1 skipped plus 65 security tests, `npm run lint` clean, `npm run docs:validate` PASS. | pending | Claude Sonnet 5 |
| 0.2.0 | 2026-08-09 | approved | Ratified draft → approved by owner decision (Boss). All Task Containers were authored to complete-container standard before ratification, so the roadmap Definition-of-Ready gate reports zero errors for this source with hard enforcement now active. Closes TASK-PRD-001 (its exit criterion is exactly this change: status flip and registry synchronization together) and completes its Boss handoff. Registry updated to the same version/status in this change. | pending | Claude Fable 5 |
| 0.1.15+draft | 2026-08-09 | draft | Closed SPR-PRD-06 and PHASE-PRD-06 to done on an owner-directed audit pass (Boss instruction on PR #128, following the WP-16/17 owner-directed-closure precedent — recorded as such, not as an independent ARCHON/ATHER reproduction). Audit evidence: every baseline gate re-run green in the closing session (env:validate, docs:validate, roadmap:validate, tsc, vitest 74 files / 614 passed / 1 skipped, security 65, vite build), plus PR #128 CI green on the authoritative baseline-check run 31274759680 with E2E and verify passing; the single local baseline:check failure reproduced only as the known MSP stdio spawn-timeout flake and passed on re-run. Verification table set to passed/passed for TASK-PRD-013..017. | pending | Claude Fable 5 |
| 0.1.14+draft | 2026-08-09 | draft | Executed TASK-PRD-017 to review: the RBAC enforcement boundary validates employee_/staff_ actors as active personnel identities when .govibe/personnel.json is materialized — unknown_personnel_identity and retired_personnel_identity deny with audit before the handler body. TASK-PRD-014's exit criterion ticked and the spec §3.3 open item removed in the same change (spec 0.2.4+draft). Enforcement suite 16 green; full suite and mcp:smoke pass. All SPR-PRD-06 tasks now at review with every DoD criterion ticked, pending QA/audit and owner approval. | pending | Claude Fable 5 |
| 0.1.13+draft | 2026-08-09 | draft | Opened TASK-PRD-017 (validate active personnel identity at the RBAC enforcement boundary, SPR-PRD-06, depends on TASK-PRD-016) from the review finding recorded in the spec §3.3 note: enforcement attributes calls under employee_/staff_ actors but does not yet verify the ID is the person's active identity. Complete Task Container authored doc-first per §11.2; closing it also closes TASK-PRD-014's open exit criterion. | pending | Claude Fable 5 |
| 0.1.12+draft | 2026-08-09 | draft | Executed TASK-PRD-016 to review: scripts/mcp/runtime/rbac-enforcement.mjs runs the RBAC decision point in handleToolCall before any handler body, activated per workspace by .govibe/rbac.json with allow/deny audit in .govibe/rbac-audit.jsonl; workspaces without RBAC state keep the pre-RBAC posture. Enforcement suite 11 tests green; mcp:smoke and the full suite pass with enforcement active; spec bumped to 0.2.3+draft. All three DoD criteria ticked. SPR-PRD-06 execution complete pending QA/audit on all four tasks. | pending | Claude Fable 5 |
| 0.1.11+draft | 2026-08-09 | draft | Executed TASK-PRD-015 to review: packages/govibe-core/src/rbac.mjs implements the §6 RBAC core (deny-by-default scoped assignments, §6.2 matrix, §6.3 staff ceiling with recorded owner approval plus separation of duties, §6.1 H-ceiling intersection, §6.4 allow/deny audit). 16-test suite green including the full matrix sweep; spec bumped to 0.2.2+draft. All three DoD criteria ticked at registry level; live enforcement on tool dispatch remains TASK-PRD-016. QA and ATHER audit pending. | pending | Claude Fable 5 |
| 0.1.10+draft | 2026-08-09 | draft | Executed TASK-PRD-014 to review: packages/govibe-core/src/personnel.mjs implements the §3.3 personnel identity model (single active identity, never-reuse, cross-type conversion via supersedes, append-only audit, snapshot round-trip) and vaults.mjs now rejects employee_/staff_ values as agent identifiers (rule 4). 15-test suite green; spec bumped to 0.2.1+draft recording implemented status. Acceptance and success criteria ticked; the exit criterion stays open until tool dispatch consumes personnel attribution (TASK-PRD-016). QA and ATHER audit pending. | pending | Claude Fable 5 |
| 0.1.9+draft | 2026-08-09 | draft | Executed TASK-PRD-013 to review: added packages/govibe-core/src/workspace-spec-conformance.test.mjs pinning SPEC-Workspace-System AC-01..AC-06 (9 tests: §4 schemas and §3 identity derivation with an independent recipe replica, clone-path workspace_id divergence, byte-identical idempotent re-init with reused MSP idempotency_key, schema/identity tamper rejection without rewrite, MSP-required fail-before-side-effects, §5.4 impact explainability including unresolved links, and a legacy-H source scan with a vacuous-pass guard). Evidence: targeted run 9 passed; full suite 71 files / 567 passed / 1 skipped plus 65 security tests. All three DoD criteria ticked; QA and ARCHON audit remain pending, so the task holds at review, not done. | pending | Claude Fable 5 |
| 0.1.8+draft | 2026-08-09 | draft | Opened PHASE-PRD-06 / SPR-PRD-06 to bind SPEC-Workspace-System (0.2.0+draft) to the plan of record: TASK-PRD-013 pins spec acceptance criteria AC-01..AC-06 with conformance tests, TASK-PRD-014 implements the personnel identity model (§3.3), TASK-PRD-015 implements the RBAC core (§6), TASK-PRD-016 enforces RBAC on the govibe.workspace.* tool surface. All four containers authored complete per §11.2 before implementation starts; code/test symbol links for the two not-yet-implemented modules are recorded unavailable until the skeletons land. | pending | Claude Fable 5 |
| 0.1.7+draft | 2026-08-08 | draft | Recorded GAP-10 (validation fixture held the active board via the parse-time freshness fallback) and opened TASK-PRD-012 for source hygiene and honest recency scoring. The fixture demotion to draft with an authored data-updated date lands in the same change; the scorer fix stays open under the task. | pending | Claude Fable 5 |
| 0.1.6+draft | 2026-08-08 | draft | Closed TASK-PRD-003 and marked GATE-CI met on command evidence: green baseline-check run 31226249238 on PR #122 (70 vitest files, 65 security tests, docs/roadmap/typecheck/build), red baseline-check on the deliberately-failing PR #123 proving the gate blocks a broken suite, and baseline-check set as a required status check on main. Recorded per the WP-16/17 precedent as owner-directed closure of single-session-verified evidence, not an independent audit reproduction. | pending | Claude Fable 5 |
| 0.1.5+draft | 2026-08-06 | draft | Started TASK-PRD-003: added the unfiltered Baseline Check workflow (.github/workflows/baseline-check.yml) running docs, roadmap, typecheck, unit, security, and build gates on every pull request with no path filter. PHASE-PRD-01 and SPR-PRD-01 moved to in-progress. Marking GATE-CI met still requires the check to be made required in branch protection (owner action). | pending | Claude Fable 5 |
| 0.1.4+draft | 2026-08-06 | draft | Corrected GAP-05 against live evidence gathered while verifying TASK-PRD-011: masterPlanPreview does have an on-demand producer (the masterplan.preview command); only heatmap remains producerless. Recorded that the board rejects draft sources by promotion contract, surfaced in the readiness view. | pending | Claude Fable 5 |
| 0.1.3+draft | 2026-08-06 | draft | Added TASK-PRD-011 (Mission Control readiness tracking and command view, SPR-PRD-00) with a complete Task Container, following the §11.2 order: this row and container precede the implementation. | pending | Claude Fable 5 |
| 0.1.2+draft | 2026-08-06 | draft | Codified §11.2 per-task document-driven execution order (doc first, symbol links before code via the machine-enforced DoR gate, code with L0 evidence, impact before completion) and declared phases dependency-ordered so PHASE-PRD-04 doc remediation starts before or alongside code phases. Renumbered the promotion rule to §11.3 and fixed its stale reference in the risk table. | pending | Claude Fable 5 |
| 0.1.1+draft | 2026-08-06 | draft | Linked the local-packet execution backlog (§11.1): TASK-PRD-005 and TASK-PRD-008 decompose into micro/atomic packets gated by the canonical L0/L1/L2 tiered review, with T-ctx worker context. Extended GAP-08 evidence with the legacy Context-Scaling-Tier wording found in the approved quota-aware decomposition feature doc. | pending | Claude Fable 5 |
| 0.1.0+draft | 2026-08-06 | draft | Initial production-readiness masterplan derived from a direct evidence sweep on commit 87c313d. Records nine verified gaps, six readiness gates, six phases, and ten task containers. | pending | Claude Opus 5 |
