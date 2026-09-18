---
id: ZAI:PM-SYSTEM-DELIVERY
title: Project Manager documentation diagram specification to code delivery
version: "0.6.0b"
status: candidate
created_at: "2026-09-15T23:49:58+07:00,RWANG,base 087f3025"
last_update: "2026-09-16T13:54:38+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: implementation-plan
  domain: project-manager
relations:
  - type: references
    target: ZAI:PM-SYSTEM-DESIGN
  - type: references
    target: ZAI:ADR-081
---

# DDD → Diagram → Spec → Code

**Version:** 0.6.0b · **Status:** Candidate
This is an ordered delivery plan. All new implementation tests and product features below are **PLANNED / NOT_RUN** in this documentation task.

**Navigation entry gate:** [Domain placement and navigation boundaries](13-DOMAIN-TAXONOMY-AND-NAVIGATION-BOUNDARIES.md) withdraws the earlier NAV-D1/D2 layout. Reconcile NAV-P0/P1, navigation JSON, 37 screen mappings and route/tab acceptance with Domain → module → local tabs before using this plan to generate navigation code. Earlier artifact PASS results apply to the old candidate only; the owner's clarification is not approval for application implementation.

**Semantic coverage gate:** [Existing Project tab audit](14-EXISTING-PROJECT-TAB-SEMANTICS.md) accounts for nine declared sections, fourteen routes and seven Work views. Preserve Inventory's operational read contract, named planned Risks/Resources and Team's Business Membership authority before regrouping. Route coverage alone does not prove capability preservation.

**Workforce requirement:** [15 Workforce planning & performance](15-WORKFORCE-CAPACITY-SCHEDULE-AND-PERFORMANCE.md) defines independent PMR-033-P1 → P5 and PMT-033 cases A–P. Human workload/capacity/performance does not depend on Agent/Fleet activation. Product tests remain PLANNED / NOT_RUN.

**Spec completeness gate:** [16 Spec readiness & API reference](16-SPEC-READINESS-AND-API-REFERENCE.md) records nine concrete gaps. Close the relevant allocation/input/history/review/metric/transport/DB/machine-mapping/registration contracts before using an affected phase as code-generation authority. Owner requirement intent, parsed OpenAPI and a functioning Swagger viewer do not close these semantic gaps.

**SRS/schema/blueprint handoff:** [17 SRS](17-SRS.md), [18 Tables & ERD](18-DATABASE-TABLES-AND-ERD.md) and [19 Blueprint](19-SYSTEM-BLUEPRINT.md) supply explicit behavior, data and component/transaction mappings. [SRS traceability](contracts/srs-traceability.candidate.json) links all 33 PMR families to existing operation IDs, table records and blueprint nodes. Review the affected table/owner/adapter binding before generating code; a parsed ERD is not a migration test.

**Execution workflow:** [20 Multi-agent delivery](20-MULTI-AGENT-DELIVERY-PLAN.md) allocates two Luna Max workers and a separate Luna Max verifier under the root final gate. Its planning JSON is non-executable. This supplements P0–P7 and the independent PMR-033 phases; each slice uses its own approved baseline, without waiting for unrelated gaps.

## 1. Authority chain

```text
User requirement
  → candidate PMR + capability/owner mapping
  → owner-approved design baseline
  → canonical ADR / FR / FEAT / SDD / SEC / NFR registration
  → approved typed architecture model and contracts
  → ordered phase spec + acceptance fixtures
  → code/interfaces/tests
  → governance + local validation + CI evidence
  → concrete release approval
  → exact-SHA deployment and separate runtime activation
```

Neither an approved drawing nor an accepted OpenAPI schema authorizes arbitrary infrastructure actions. Each implementation slice names the code scope, data migration, runtime effect and validation gate.

### Latest priority — refine existing navigation first

The owner requested menu refinement before full-system work. [Navigation refinement](09-NAVIGATION-REFINEMENT.md) defines NAV-P0 (approve/register the navigation amendment), NAV-P1 (existing menu implementation and verification), then NAV-P2 (add each full-design feature at its own gate).

Approval may be limited to NAV-P0/NAV-P1. It does not require or imply approval of the entire PM system. Preserve the existing 8 Business destinations and 14 project page templates; no feature placeholder, new API or database migration belongs to NAV-P1.

After NAV-P1, continue the full-system P0–P7 sequence below for the separately approved features. Navigation phase names are subordinate proposal labels, not new canonical FR IDs.

### UX/UI and wireframe handoff

Use [screen specs](12-WIREFRAMES-AND-SCREEN-SPECS.md) and [UI interactions](11-UI-SYSTEM-AND-INTERACTIONS.md) as the UI implementation baseline. Map WF/FORM/UI proposal references to canonical phase subjects, source components and tests after approval. UI-T01–T14 remain product tests PLANNED / NOT_RUN. Do not count static/browser prototype checks as backend, authorization, native-device or release evidence. Resolve the WF-37 Business policy contract binding before enabling its administrative actions.

## 2. P0 — Registration and baseline promotion

After documentation approval:

1. Refresh authoritative registry/main snapshot in an isolated worktree and check in-flight ID reservations
2. Preserve subjects of existing FR/FEAT/ADR IDs; map each PMR as REUSE_EXACT / EXTEND_WITH_NEW_REQUIREMENT / NEW
3. Assign new IDs only through the current ledger workflow; add one primary owner/use-case per feature
4. Promote PMD decisions into numbered candidate/accepted ADRs according to owner's decisions; record supersession/amendment explicitly where required
5. Register each precise new behavior in PRD-SDD and FEAT bundles; reuse existing FR only when its subject genuinely covers the acceptance
6. Create feature notes for rationale and phase slices under proper domains. Cross-domain requirements retain one parent FR with ordered -P1/-P2 slices when tooling/metadata supports explicit phase IDs
7. Reconcile charter ownership and route manifests for planned additions at the point of implementation; do not claim unbuilt models in current manifests
8. Pin approved architecture/workflow/OpenAPI hashes and keep PMR→canonical mapping as provenance
9. Run governance single-writer. Generated views are built, not hand-maintained or committed under ADR-081
10. No application code begins until the registered phase documentation has approval

The proposal is complete for review without guessing the next globally shared FR/ADR number. Registration is an implementation entry gate, not a hidden assertion that IDs are already reserved.

## 3. Ordered implementation slices

| Phase | User-visible result | Primary integration owner / contributors | Entry gate | Exit proof |
|---|---|---|---|---|
| P0 | Approved, registered design baseline | PM / all affected domain owners | Owner approves candidate | Canonical mapping, consistent charters/specs, govern |
| P1 | Existing project planning + separate Domain and Feature views | PM / Identity | P0 + NAV-P1 | Authorized counts, dedup, stable IDs, strategy progress, UX checks |
| P2 | Architecture graph, typed edges, evidence links and Visual API | PM / Integration | P1 | Schema/semantic graph checks, Swagger auth/redaction, operation parity |
| P3 | Provider/MCP registry and scoped self-host inference gateway | Integration / Identity | P0; contract dependencies from P2 | Credential rotation/revoke, private-network proof, quotas, MCP schema pin |
| P4 | Agent inventory and one durable single-domain run | PM + Integration / Identity | P1, P3 | Version pin, isolated executor, claim/lease/fence, artifacts, recovery |
| P5 | Fleet inventory and multi-domain Command Center | PM + Integration / all tool owners | P2, P4 | DAG/handoff, lane serialization, approval, cancellation and no duplicate effect |
| P6 | SCM/CI, release evidence, cost, collaboration and eval | PM / Integration, Knowledge, Identity | P2, P5 | Trace to exact SHA, reviews, authorized search/share, cost and eval gates; human workforce follows PMR-033 phases |
| P7 | Scoped pilot, operational acceptance and production rollout | Integration / PM, Identity, operator | P6 + release approval | RLS/grants, restore, load/SLO, real provider/host acceptance, release/activation receipt |

Phases are dependencies, not elapsed-time estimates. Sizing must follow implementation inventory and executor/provider selection; no fabricated schedule or completion percentage.

P1/P2 are useful without enabling autonomous writes. P3 network/credential rollout and P4/P5 execution activation require their own concrete review even if documentation is approved.

## 4. Contract-to-code map

| Contract | Planned code location / owner | Generated portion | Reviewed behavior |
|---|---|---|---|
| Navigation candidate | PM-owned layouts/config/project navigation components | One reviewed destination map for sidebar, Work views, search and selection | Authorized route resource, preserved URLs, planned states, mobile and history behavior |
| Domain/Feature read models | apps/server/src/modules/project-manager/application/ | DTOs/types where useful | scope-before-aggregate, dedup, authoritative state |
| Typed architecture model | PM design service + visualization consumer | validated graph/canvas data, interface stubs | edge semantics, ownership, approval/drift |
| OpenAPI candidate | PM api-docs/openapi + owning route modules | schemas/clients from approved source | auth, transactions, errors, idempotency |
| Workflow schema | PM definition validator → Integration compiler port | shape validation | cycles, references, budget, tool effects |
| Agent/Fleet definitions | PM inventory application services | input contracts | version immutability and readiness |
| Execution/lease/events | Integration-owned pipeline services/adapters | transport DTOs | claims, fencing, receipts, recovery |
| Provider/MCP/gateway | apps/server/src/platform/integrations/ and owning modules | profile contracts | vault, quotas, SSRF, capability/consent |
| Identity keys/approval grants | apps/server/src/modules/identity/ | schema declarations | audience, expiry, revocation, SoD |
| Executor adapter | apps/edge or dedicated approved runner package | protocol types | process/path/network confinement, no secrets export |

Paths above are proposed locations/patterns, not claims those new files exist. Preserve root/server-relative normalization in governance tools.

## 5. Acceptance scenarios

Machine-readable mapping: [traceability.json](contracts/traceability.json). These scenarios are implementation requirements, not test results from this turn.

| Test ID | Given / When | Required result |
|---|---|---|
| PMT-001 | Authorized project import with one invalid nested work item | Whole commit refused; dry-run shows exact issue; no partial business writes |
| PMT-002 | Domain label renamed at same stable ID | Work/feature links and authorized counts unchanged |
| PMT-003 | Same WorkItem linked to two features | Project total counts once; allocation view explains weights |
| PMT-004 | Keyboard user adds directed edge with missing contract | Blocked with specific field/edge reason; equivalent drag validation |
| PMT-005 | Observer opens Swagger then attempts mutation | Documentation readable if authorized; execution denied with no write |
| PMT-006 | Approved AgentVersion edited or tool schema changes | New revision required; existing version/run remains pinned |
| PMT-007 | Fleet DAG includes cross-domain write without handoff or a cycle | Validation fails before any dispatch |
| PMT-008 | Run accepted while browser disconnects | Durable queue survives; reconnect renders authoritative state |
| PMT-009 | Model name exists but required capability probe fails | Deployment cannot satisfy binding readiness |
| PMT-010 | MCP server changes tool schema/requests broader authority | Binding pauses; no widened tool call |
| PMT-011 | Consumer key allows model A, asks for B or hits raw model port | Gateway denies B; raw port unreachable; no upstream inference |
| PMT-012 | Foreign tenant/business/project IDs in URL/body/filter/cursor/stream | Equivalent not-found/denied; no identifiers, counts or payload leakage |
| PMT-013 | Approve hash H then dispatch modified hash H2 | INPUT_CHANGED; old approval cannot authorize new effect |
| PMT-014 | Graph WRITES edge crosses owner or has unknown endpoint/type | Semantic validation rejects; no scaffold generated |
| PMT-015 | Test evidence belongs to older commit or different environment | Cannot satisfy current acceptance/release gate |
| PMT-016 | Token usage rises with no new accepted business evidence | Project progress unchanged |
| PMT-017 | Concurrent allocations exceed resource capacity | Transaction rejects second allocation or requires authorized reasoned override |
| PMT-018 | CI green for A, deployment request targets B | Release refused; migration/deployment/activation remain distinct |
| PMT-019 | Sensitive mutation/privileged read occurs | Redacted append-only audit with scope/actor/reason/refs exists |
| PMT-020 | Provider omits usage/cost categories | UNKNOWN shown; no fabricated 0 or double counting |
| PMT-021 | Crash after external effect before acknowledgment; then stale worker reports | UNKNOWN/reconcile; no duplicate effect, stale epoch cannot promote |
| PMT-022 | Search query crosses project or GKS/MSP scope | Only authorized provenance-linked results; no direct foreign store access |
| PMT-023 | Two reviewers edit same draft version | Second write 412; approved revision comments stay pinned |
| PMT-024 | Subscriber loses grant before notification delivery | Delivery suppressed; reason recorded; no message leakage |
| PMT-025 | Import bundle has unsupported version/colliding ref/script field | Reject with preview diagnostics, no executable payload |
| PMT-026 | Artifact link expired/revoked or underlying access withdrawn | Immediate denial and no cached private bytes to new request |
| PMT-027 | Code/tests available but no deployment receipt | Readiness cannot claim DEPLOYED/ACTIVATED |
| PMT-028 | New agent/model version fails golden/adversarial suite | Approval/production binding blocked with evidence |
| PMT-029 | Declared scale/load and restore scenarios | Meets measured candidate targets below or explicit failed gate |
| PMT-030 | DST/timezone/missed trigger/duplicate webhook/self-generated event | Correct one scheduled window, dedup, bounded catch-up, no feedback loop |
| PMT-031 | Forged/stale CI webhook claims check passed | Verify signature + repository/commit/check mapping before readiness update |
| PMT-032 | Approved contract differs from generated API/code anchors | CI reports drift and blocks phase closure |
| PMT-033 | Person/team capacity, schedule and performance scenarios A–P in document 15 | Accurate counts/intervals/cohorts, scope-first reads, visible unknown data, concurrency and accessible workforce UI |

Each PMR-nnn has PMT-nnn coverage. Additional negative cases belong to the same test family; one row is not a claim of sufficient test count.

## 6. Proposed nonfunctional targets

| Concern | Initial acceptance target | How to prove |
|---|---|---|
| Scoped list API | p95 ≤ 500ms / p99 ≤ 1500ms at 50 requests/s | Seed 100 projects, 100k work items across 10 tenants; mixed authorized/denied requests |
| Domain/Feature aggregation | p95 ≤ 1s for a 10k-item project | Indexed/scoped query; explain plan and dedup correctness |
| Graph UX | 1k nodes/3k edges load ≤ 3s on declared reference device | Reproducible browser profile, accessible list and filtered rendering |
| Event visibility | p95 ≤ 2s from committed event to connected client | 200 streams, bounded buffer, reconnect/revocation test |
| Worker scale | 100 active runs, 20 executors within configured lane locks | Race/lease expiry/queue backpressure and recovery |
| Queue limits | max 1k queued runs per Business; 429 above cap | Admission atomicity; operator-controlled limit |
| Availability | target 99.5% monthly for control API | Synthetic probe and outage accounting; provider outage reported separately |
| Recovery | RPO ≤ 15m, RTO ≤ 4h for production operational data | Encrypted backup + isolated restore drill + key revalidation |
| Accessibility | WCAG 2.2 AA target for delivered flows | Keyboard/screen-reader/manual zoom checks plus automated scan |
| Security | zero cross-scope reads/writes in contract suite; no secret sentinel in artifacts/logs | Auth matrices and secret-leak tests |
| Evaluations | 100% scope/authorization cases; ≥ 95% task-specific golden acceptance | Fixed versioned dataset, output grading rubric, recorded model/config |
| Data loss | no accepted command without durable receipt | Kill/restart at transaction boundaries; outbox/inbox replay proof |

These targets require owner/product review and benchmark environment definition. They are not current performance claims.

## 7. Trigger and operations specification

- Manual trigger is default; schedule stores IANA timezone + normalized schedule + next occurrence
- Event trigger pins source/type/filter/version and idempotency expression; credentials bind publisher
- Misfire default SKIP; bounded catch-up max one run per missed window only when explicitly enabled
- Each event carries correlation/causation; trigger rejects its own output chain and caps chain depth at 5
- Pause trigger stops new admission; cancel run is a separate command
- Operational dashboards: queue age/depth, lease breaches, unknown outcomes, provider error/rate, budget exposure, outbox lag and artifact purge backlog
- Alert recipient bindings are current scoped identities; notification adapter needs explicit setup, test receipt and failure handling
- Runbooks: stuck queue, lost executor, provider key rotation, budget exhaustion, corrupted artifact, contract drift, backup restore, data erasure and unknown effect reconciliation

## 8. Release checklist and rollout

1. Review exact diff, owner mappings, ID/graph consistency and accepted spec hashes
2. Run `npm run govern` and relevant contract/unit/integration/e2e/build gates for touched apps; never count zero tests as pass
3. For executor changes, run host-specific Windows/Linux acceptance as applicable; local tests do not stand in for a paired host
4. For DB changes, migration dry-run, constraint checks, scoped RLS and grants verification, backup/restore proof
5. For self-host/provider path, real private connectivity, key revoke, quota, stream/cancel and raw-port exposure tests
6. Present exact SHA/image, scope, migrations, risk, rollback and separate activation flags for approval
7. Deploy approved tested revision; verify health and scoped smoke without broadening authority
8. Pilot one authorized Project/Business, read-only first, then constrained write tools with independent acceptance
9. Track gates separately: docs approved / code implemented / local verified / CI verified / deployed / activated
10. Rollback stops new claims/provider use and restores image/config while retaining additive data/evidence; reconcile in-flight effects before resuming

## 9. Definition of done

A phase closes only with accepted requirements, current traceability, relevant tests actually run, clean scope diff, documentation updated, no known unresolved regression in the phase and a phase report naming limitations. A failed security/recovery case cannot be waived by a successful UI demo.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-16 | candidate | Ordered phases, canonical registration, 32 acceptance families and measurable operational gates | base 087f3025 | RWANG |
| 0.2.0b | 2026-09-16 | candidate | Navigation-only approval and implementation precede full PM feature delivery | base 087f3025 | RWANG |
| 0.3.0b | 2026-09-16 | candidate | Add screen/form handoff and UI acceptance entry gates | base 087f3025 | RWANG |
| 0.3.1b | 2026-09-16 | candidate | Clarify that navigation inputs must reconcile with owner taxonomy before implementation | source 000b26f1 | RWANG |
| 0.3.2b | 2026-09-16 | candidate | Require source-based tab semantics and capability coverage before navigation implementation | source 96630462 | RWANG |
| 0.4.0b | 2026-09-16 | candidate | Add independent PMR-033 workforce phases and sixteen acceptance scenarios | source 0f5a47fc; uncommitted | RWANG |
| 0.4.1b | 2026-09-16 | candidate | Add explicit semantic completeness gate before any affected spec-to-code slice | design base 087f3025; uncommitted | RWANG |
| 0.5.0b | 2026-09-16 | candidate | Add SRS table and blueprint artifacts to per-phase implementation entry gates | design base 087f3025; uncommitted | RWANG |
| 0.6.0b | 2026-09-16 | candidate | Add per-slice multi-agent execution and independent/root verification reference | design base 087f3025; uncommitted | RWANG |
