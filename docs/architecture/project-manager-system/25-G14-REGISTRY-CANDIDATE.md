---
id: ZAI:PM-G14-REGISTRY-CANDIDATE
title: G14 Workforce graph and registry candidate
version: "0.2.0b"
status: candidate
created_at: "2026-09-18T00:00:00+07:00,RWANG,worker packet"
last_update: "2026-09-18T04:48:00+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: architecture-specification
  domain: project-manager
  scope: G14 human workforce capacity, schedule and performance
relations:
  - type: references
    target: ZAI:PM-WORKFORCE-DESIGN
  - type: references
    target: ZAI:PM-SPEC-READINESS
  - type: references
    target: ZAI:PM-SYSTEM-DESIGN
  - type: references
    target: ZAI:PM-G14-REGISTRY-CANDIDATE
---

# G14 Workforce graph and registry candidate

## 1. Purpose and status

This packet turns the owner-approved contract baseline into a machine-readable
G14 extension and implementation handoff. It is a documentation/contract packet;
it does not change the primary repository, allocate a canonical FR/FEAT/ADR/SDD
ID, create a route, add a Prisma model, run a migration, or claim production
readiness.

The machine source is [g14-registry.candidate.json](contracts/g14-registry.candidate.json).
It keeps **PM-G01** as the architecture authority and defines **PM-G14** as a
typed extension to be reconciled into that authority. G14 is also the design
label used by document 15; it is not a new canonical registry family.

## 2. Baseline pins

| Item | Pinned value | Meaning |
|---|---|---|
| Current source snapshot | `0c7fd88418b8be40a78f1fb8bc743b34c5a52c39` | Source read for this worker packet |
| Final Gate packet | `PM-20260916-D00-01` | `PASS_DOCUMENT_REVIEW`, first document closure wave |
| Final Gate source baseline | `eddd3dd8d884a0b19a65f9a3019758c05c815b48` | Historical reviewed baseline; current snapshot is called out separately |
| Registry reference | `fd9a505240f15bcc10f8359f54259516abb1cbca` | Historical registry refresh referenced by Final Gate |
| Composed document commit | `3f36668fbe70bc447a0f0da4fd7dfcdfbae66617` | Historical composed packet evidence |
| Existing graph | `PM-G01` base within the composed model | Existing candidate semantic graph; retained as the base authority |
| G14 extension | `PM-G14` / 13 nodes / 15 edges | Composed into the model as a candidate extension; codegen remains disabled |
| Canonical IDs | `PENDING_ROOT_REGISTRATION` | PMR/PMF/PMD/PMT IDs remain proposal-local |

The untracked `apps/server/docker-compose.pricing-release.yml` is excluded from
this source claim. It was not used to derive the registry.

## 3. What is registered in this packet

The JSON contains explicit field definitions and entries for:

- **Requirements and control IDs:** `PMR-033`, `PMF-11`, `PMR-033-P1..P5`,
  `PMD-14`, `PMT-033`, and the affected `SPEC-G01..G09` gates. These are
  proposal-local until the root reconciles `docs/.id-ledger.json`.
- **Screens:** `WF-R01` through `WF-R06`, including scope, view, operations,
  capabilities, active-route state, and evidence references.
- **API operations:** all eight workforce operations from
  `workforce.openapi.candidate.yaml`, including request/response schemas,
  effect class, owner, capability and `PROPOSED_NOT_IMPLEMENTED` evidence.
- **Logical records:** `WorkEstimate`, `WorkingCalendar`,
  `AvailabilityException`, `TeamCapacityShare`, `WorkAssignment`,
  `WorkAllocation`, `WorkforcePlan`, `WorkLogRevision`, `DeliveryEvent`,
  `MetricPolicyRevision`, `MetricReview`, `MetricResultSnapshot`, and
  `PerformanceCorrection` with lifecycle, identity, scope and invariants.
- **Capabilities:** eleven Identity-owned workforce permissions. Membership,
  Team labels, Employment titles, agent inventory and graph edges do not grant
  access.
- **Metrics:** `WF-M01..WF-M12` with formula, population, required evidence
  and quality states. Missing evidence is `UNKNOWN`/`PARTIAL`, never zero.
- **Acceptance:** `PMT-033-A..P`, all sixteen cases from document 15.
- **Evidence:** ten source files with SHA-256, current source commit and
  limitations. Hashes are evidence of the source snapshot, not runtime proof.

## 4. G14 directed graph

The extension preserves the flow in document 15:

```text
Identity authorizer
  -> scoped PM Work and People calendar read ports
  -> capacity calculator / workforce projection / performance calculator
  -> Workload + Schedule views / Performance scorecard
  -> typed plan preview
  -> exact versioned commit
  -> People calendar owner writer + PM allocation writer
  -> immutable audit/outbox append
```

Every edge has a stable ID, source/target, direction, type, contract reference,
owner, auth policy, timeout, failure policy and data classification. The graph
is separate from the Work Dependency DAG and Data Pipeline Map. A graph edge is
not a permission grant; only owner ports persist mutations.

## 5. Status rules

The packet uses distinct vocabularies for design, data quality and delivery:

- Design: `CANDIDATE`, `APPROVED_DESIGN_BASELINE`, `REGISTERED`,
  `IMPLEMENTATION_READY`, `IN_IMPLEMENTATION`, `PROPOSED_NOT_IMPLEMENTED`.
- Verification: `LOCALLY_VERIFIED`, `HOSTED_VERIFIED`, `PRODUCTION_ACTIVE`,
  `NOT_RUN`.
- Data: `COMPLETE`, `PARTIAL`, `UNKNOWN`, `UNAVAILABLE`, `PROVISIONAL`,
  `INSUFFICIENT_SAMPLE`, `STALE`, `CONFLICT`, `FORBIDDEN`.
- Delivery: `PLANNED`, `BLOCKED`, `NOT_REPORTED`, `SUPERSEDED`, `REJECTED`.

`PRODUCTION_ACTIVE` requires evidence for the exact deployed revision. A
candidate OpenAPI file, Swagger rendering, synthetic example, or local browser
artifact does not satisfy that state.

## 6. Implementation handoff

| Phase | Work | Entry dependency | Exit evidence |
|---|---|---|---|
| P1 | Identity capabilities, status mapping, typed estimate/calendar/history ports and canonical registration | Final Gate packet; root ID reconciliation | Registry rows, owner sign-off, negative scope fixtures |
| P2 | Integer-minute capacity calculator, preview/commit, allocation/calendar owner adapters | P1; G01 allocation authority; G02/G05 | Transaction/concurrency/idempotency proof and migration packet |
| P3 | WF-R01/R02/R03 projections and navigation bindings | P2; G06 | Route/field parity, component/browser evidence, accessible table/agenda |
| P4 | WF-R04/R06 metrics, policy/review/correction lifecycle | P1 + P3; G03/G04 | Metric result fixtures, permission tests, cohort/formula evidence |
| P5 | PMT-033 A–P execution, representative-data pilot, independent review and release packet | P4; G07/G08 | Test/build/governance pass, exact revision receipt, separate deployment evidence |

The target contract files to reconcile are `architecture.model.json`, the
workforce OpenAPI and examples, `traceability.json`, `data-model.candidate.json`,
documents 16/18, `docs/PRD-SDD-v1.0.md`, `docs/FEATURES.md`, and
`docs/.id-ledger.json`. Reconciliation must happen once in the root composed
tree; generated graphs are not hand-merged.

### Ownership boundary

- Project Manager owns work estimates, assignments, allocations, projections,
  delivery events, metric projections and PM views.
- The `people` module owns employment-linked calendar and availability ports.
- Identity owns capability issuance, scope, reviewer authority and session/CSRF/
  Origin policy.
- CRM supplies Person identity reads.
- Integration may later adapt external calendars; it is not a second WorkItem
  writer.
- TaskUsageLedger is a separate implementation telemetry packet. It may attach
  measured taskCode/report evidence to delivery work, but it cannot grant G14
  access, alter a workforce result, or mark a screen/API `PRODUCTION_ACTIVE`.

### No-go conditions

- Do not guess a canonical FR/FEAT/ADR/SDD number or reuse `FR-042`, `FR-036`,
  `FR-064`, `FR-086` or `FR-193` for PMR-033.
- Do not expose active routes or UI buttons while screens remain candidate.
- Do not create a migration from the logical record list without SPEC-G07
  adapter/RLS/backfill/rollback approval.
- Do not infer hours, acceptance, performance or tokens from missing evidence,
  `updatedAt`, worker exit status or predicted values.
- Do not infer permission from a Team label, Employment title, inventory entry,
  fleet membership or graph edge.

## 7. Verification performed by this worker

| Check | Result |
|---|---|
| JSON parse | PASS |
| G14 node count | 13 |
| G14 edge count | 15 |
| Screen entries | 6 |
| Operation entries | 8 |
| Logical record entries | 13 |
| Capability entries | 11 |
| Metric entries | 12 |
| Acceptance cases | 16 |
| Source evidence entries | 10 |
| Primary repository changes | NONE |

The packet is ready for root review and composition. It remains `CANDIDATE` and
`codegenReady: false` until canonical registry allocation, graph reconciliation,
affected SPEC gates and implementation verification close.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-18 | candidate | Add source-backed G14 graph extension, registries, status vocabulary, acceptance and implementation handoff | worker-local; uncommitted | RWANG |
| 0.2.0b | 2026-09-18 | candidate | Record root graph composition and reconcile candidate evidence counts | pending | RWANG |
