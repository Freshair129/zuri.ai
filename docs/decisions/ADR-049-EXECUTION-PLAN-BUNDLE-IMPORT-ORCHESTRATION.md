---
version: "1.0.0"
created_at: "2026-08-26T19:54:00+07:00,ChatGPT"
last_update: "2026-08-26T19:54:00+07:00,ChatGPT"
status: "accepted"
superseded_by: null
attributes:
  domain: "project-manager"
  doc_type: "architecture-decision"
  scope: "self-contained multi-project planning package and import orchestration"
---

# ADR-049 — ExecutionPlanBundle is the package above PlanEnvelope

**Status:** Accepted by Boss on 2026-08-26 for the contract/documentation boundary. Runtime implementation remains a separate delivery slice.

**Relates to:** ADR-025, ADR-028, ADR-029, ADR-039, FR-069, FR-070, BR-007, BR-009, SEC-001, SEC-002, SDD-009, SDD-037, `contracts/plan-envelope.schema.json`, `docs/domains/project-manager/EXECUTION-PLAN-BUNDLE.md`.

## Context

The Project Manager already has one canonical per-Project intake contract: `PlanEnvelope`. Human form, pasted JSON, Excel conversion and Agent/API/MCP surfaces converge on that envelope and then share validation, dry-run, authorization, transactional commit and audit.

That boundary is correct for one Project, but it is not sufficient for a self-contained programme plan that must carry a Business Roadmap, horizons, Business Goals, multiple Projects and dependencies between those Projects in one artifact. Calling that artifact a `container` would collide with the existing `WorkContainer` domain model, where container means an Epic/Sprint/Stage/Batch/Wave/Period/Process/Initiative/Site inside a Workstream.

A second direct write path would also violate BR-009 and the project-manager charter. The missing abstraction therefore belongs above, not beside, `PlanEnvelope`.

## Decision

### D1 — Introduce `ExecutionPlanBundle` as a transport/package contract

`ExecutionPlanBundle` is a self-contained import package. It is not a Prisma model, not a new execution entity and not an alias for `WorkContainer`.

A bundle may carry:

- manifest and source/trace metadata;
- one authorized Business scope and an optional default Workspace;
- one Business Roadmap and ordered horizons;
- zero or more Business Goals;
- one or more Project entries, each containing one canonical `PlanEnvelope`;
- bundle-local symbolic references such as `goalRefs[]`;
- cross-Project dependencies; and
- an idempotency/correlation identity for replay-safe import.

The normative schema is `contracts/execution-plan-bundle.schema.json`.

### D2 — `PlanEnvelope` remains the canonical per-Project import unit

The bundle does not replace, fork or extend the persistence semantics of `PlanEnvelope`.

```text
ExecutionPlanBundle
  ├── Business strategy section
  │   ├── BusinessRoadmap
  │   ├── BusinessRoadmapHorizon[]
  │   └── BusinessGoal[]
  ├── Project entry A ──> PlanEnvelope A
  ├── Project entry B ──> PlanEnvelope B
  └── Cross-project dependency refs
```

Every Project entry must validate as a normal PlanEnvelope before the bundle can be confirmed. Existing PlanEnvelope versions remain independently valid outside a bundle.

### D3 — One Bundle Import Orchestrator coordinates existing services

The implementation boundary is a `Bundle Import Orchestrator` inside the project-manager intake lane. It orchestrates existing application/domain services; it does not write tables directly and does not create a second PlanEnvelope writer.

Required flow:

```text
receive bundle
  → resolve trusted viewer and target Business/Workspace scope
  → validate bundle schema
  → validate bundle-level semantics and unique refs
  → dry-run Roadmap/Horizons/Goals
  → resolve bundle-local symbols to canonical IDs
  → materialize per-Project PlanEnvelope inputs
  → call the existing PlanEnvelope dry-run for every Project
  → validate cross-Project dependencies against the combined preview
  → present one combined Human-readable preview
  → explicit Human confirmation
  → coordinated commit through existing application/import services
  → bundle receipt + AuditEvent lineage
```

A route, UI uploader, Agent or MCP adapter is only a transport surface. All of them must converge on this orchestrator when the input kind is `EXECUTION_PLAN_BUNDLE`.

### D4 — Bundle-local references are symbols, never database authority

Agents generating a self-contained artifact cannot know server UUIDs that do not exist yet. The bundle may therefore use symbolic references such as `GOAL-KNOWLEDGE` or `PROJECT-GKS` inside the package.

The orchestrator must resolve them in the authorized scope before commit. For example:

```text
bundle goalRef "GOAL-KNOWLEDGE"
  → create/update/resolve authorized BusinessGoal
  → obtain BusinessGoal.id
  → inject that UUID into PlanEnvelope.project.goalIds[]
  → run the existing PlanEnvelope import path
```

A symbolic ref grants no authority. Unknown, ambiguous, cross-Business, cross-Workspace or type-mismatched references fail closed.

### D5 — Authorization happens before sensitive parsing or preview

The target Business/Workspace is resolved from trusted request/session context plus allowed bundle scope fields. The same scope ceiling applies to dry-run and commit. Previewing another tenant's plan is a data leak and is therefore forbidden exactly as a write would be.

Bundle scope metadata is routing input, not proof of authority. Client-provided Tenant/Business/Workspace codes must never override the trusted viewer's Membership/Role/Scope.

### D6 — Imported bundles are data only

BR-007 and SEC-002 apply to the whole package and every nested PlanEnvelope. No command, script, shell fragment, prompt, tool call, URL or embedded instruction arriving in a bundle is executed merely because it is present in the artifact.

The importer may interpret only fields defined by the contract and may invoke only allow-listed application services required to materialize those fields.

### D7 — Dry-run is bundle-wide and confirmation is singular

A bundle is not confirmed Project by Project. The user receives one preview containing at least:

- target Business and Workspace decisions;
- Roadmap/Horizon/Goal inserts, updates and conflicts;
- per-Project PlanEnvelope inserts, updates and conflicts;
- symbolic-reference resolution results;
- cross-Project dependency edges;
- counts by entity kind; and
- any authorization or semantic conflict.

Any unresolved conflict keeps the whole bundle non-committable.

### D8 — Commit semantics are atomic where one database transaction can own all writes; otherwise coordinated and receipt-driven

For the current Project Manager models in one database, the target implementation should prefer one database transaction covering Business Roadmap/Horizons/Goals, Projects and cross-Project dependency materialization.

If a future bundle coordinates an external owning service that cannot participate in the same transaction, the system must not pretend distributed atomicity. It must use an explicit coordinated state machine with idempotent steps, append-only receipts, compensating actions where safe and a terminal status such as `COMMITTED`, `PARTIAL_FAILURE` or `ROLLED_BACK`.

The first implementation must document which mode it uses. "Best effort" with no receipt is rejected.

### D9 — Bundle idempotency and audit are first-class

A normalized bundle payload has a stable hash. `trace.idempotencyKey` must not be accepted with two different payload hashes. Replaying the same accepted key returns the prior receipt instead of creating duplicate Roadmaps, Goals, Projects or dependency edges.

Bundle audit lineage must connect the package occurrence to the individual PlanEnvelope import receipts/runs it caused. Existing Project-level receipts remain intact; bundle traceability is additive.

### D10 — `container` keeps its existing Project Manager meaning

`container` continues to mean `WorkContainer` inside a Workstream. Documentation, UI and APIs must use `ExecutionPlanBundle` or `PlanBundle` for the outer package and must not call the outer artifact a container.

## Consequences

- An Agent can produce one portable, self-contained planning artifact for a Business programme.
- A Human can upload one artifact, inspect one combined dry-run and confirm once.
- Existing PlanEnvelope callers and import semantics remain backward compatible.
- Roadmap/Goal creation becomes an orchestration concern without being smuggled into the PlanEnvelope schema.
- Cross-Project references can be expressed before server UUIDs exist, but must resolve before commit.
- The implementation needs a bundle receipt/orchestration boundary; no new business persistence model is implied by the package itself.

## Alternatives rejected

**Put all Projects inside one larger PlanEnvelope.** Rejected: PlanEnvelope is intentionally Project-scoped and its existing import service resolves one Project and its Workstreams.

**Use `container` as the outer package.** Rejected: `WorkContainer` is already a first-class Project Manager concept and the overload would make both API and Human language ambiguous.

**Create a second importer that writes Roadmap, Goal and Project tables directly.** Rejected: it violates BR-009, duplicates authorization/identity logic and makes dry-run disagree with the canonical Project import path.

**Import each Project independently and ask the user to repeat confirmation.** Rejected as the only bundle behavior: it breaks self-contained programme import and cannot validate cross-Project dependencies before the first write occurs.

## Implementation boundary

This ADR approves the architecture and contract only. The runtime slice should separately declare its FR/SDD/SEC identities under ADR-039 before adding routes or code. The implementation must reuse the existing `project-manager/import/` PlanEnvelope path rather than reinterpret this ADR as permission for a new writer.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-08-26 | accepted | Added ExecutionPlanBundle above PlanEnvelope, bundle-local reference resolution, combined dry-run, fail-closed authorization, idempotency/audit and atomic/coordinated commit rules | working-tree | ChatGPT |
