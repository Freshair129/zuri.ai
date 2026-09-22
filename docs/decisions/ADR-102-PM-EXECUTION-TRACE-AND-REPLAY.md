---
id: ZAI:ADR-102
title: Project Manager execution trace and append-only replay
version: "0.1.0b"
status: candidate
created_at: "2026-09-22T00:00:00+07:00,RWANG"
last_update: "2026-09-22T00:00:00+07:00,RWANG"
author: RWANG
attributes:
  doc_type: architecture-decision
  domain: project-manager
relations:
  - type: relates_to
    target: ZAI:FR-069
  - type: relates_to
    target: ZAI:FR-070
  - type: relates_to
    target: ZAI:FR-108
  - type: relates_to
    target: ZAI:SDD-041
  - type: relates_to
    target: ZAI:ADR-029
  - type: relates_to
    target: ZAI:ADR-049
---

# ADR-102 — Project Manager execution trace and append-only replay

**Status:** Candidate

## Context

The Project Manager currently emits random execution identifiers for plan
import and stores one compatibility receipt plus a generic `AuditEvent`. That
is enough to prove that a Project import happened, but it cannot answer which
step failed, which attempt was retried, what downstream work was skipped, or
which new run came from a replay. `AgentTraceEvent` and `PipelineRun` already
have owners in other domains and must not become a second Project Manager
execution authority.

The existing PlanEnvelope and ExecutionPlanBundle contracts remain the intake
boundary. Meeting/action producers will continue to adapt into that boundary;
this decision does not change FUNG, Lalin or any producer application.

## Decision

### D1 — Project Manager owns two durable trace records

Add `ProjectExecutionRun` and `ProjectExecutionStep` in the Project Manager
domain. A run is the immutable execution context for one authorized intake or
replay. A step is an ordered lifecycle/evidence operation within that run. Each
step owns one `attemptId` for the current attempt; a retry appends a new step
attempt record rather than mutating a completed attempt.

The identity graph is:

```text
executionContractId
  -> executionRunId
    -> executionStepId + stepKey
      -> attemptId
        -> auditEventId
```

The records carry scalar business references (`tenantId`, `businessId`,
`workspaceId`, `projectId`, `planId`, `containerId`, `workItemId`, goal/risk
and supporting identity references) and tag IDs as canonical IDs. They do not
create a second business-work graph or invent Risk, Tag, Verify or supporting
registries that do not already exist.

### D2 — Trace the shared intake lifecycle with stable step keys

The first implementation uses these stable step keys:

```text
plan.validate
plan.dry_run
plan.authorize
plan.commit
bundle.strategy
bundle.project.commit
bundle.dependencies
meeting.normalize
meeting.assignment.resolve
```

The plan importer must persist a terminal record for each reached step and an
explicit `FAILED`, `SKIPPED` or `NOT_STARTED` state for the remainder when a
step stops the run. A failed step includes `failureCode`, bounded `errorRef`,
`retryable` and `auditEventId`. Error messages, transcripts, audio, provider
credentials and arbitrary imported payloads are never stored in the trace.

### D3 — Keep snapshots bounded and auditable

Each run stores a canonical, bounded PM input snapshot and its SHA-256
`inputHash`. The snapshot is limited to the fields needed to revalidate the
intake and replay lineage; it is not a transcript or an audio artifact. Step
input/output hashes are optional and contain digests only. Oversized or
non-canonical snapshots fail closed before persistence.

### D4 — Preserve the existing receipt and transaction boundary

`PlanImportReceipt` remains the compatibility/idempotency projection for a
committed Project import. It links to the terminal `executionRunId`,
`executionStepId` and `attemptId`; it is not the new trace authority.

Run/step rows and the business mutation are committed in the same transaction
for a successful import. An idempotency replay with the same scoped key and
payload hash returns the original receipt without a second business effect.
A conflicting hash fails closed. A failed transaction records a failed trace
after rollback without leaving partial Project work behind.

### D5 — Replay is append-only and revalidated

Replay is requested as `full` or `partial` against an authorized source run.
The replay receives new run, step and attempt IDs and records
`replayOfExecutionRunId` / `replayOfExecutionStepId` lineage. The source run and
source steps are never updated or reused. Before any business mutation, the
replay revalidates scope, authorization, source input hash and the current
PlanEnvelope/Bundle contract. A partial replay names the selected step keys;
unselected source work is represented as `SKIPPED` with a reason.

### D6 — Expose a read contract and one replay command

The Project Manager exposes:

```text
GET  /api/projects/:projectId/execution-runs/:executionRunId
POST /api/projects/:projectId/execution-runs/:executionRunId/replay
```

The read is scope-authorized and returns the run, ordered steps, failure
details, business/supporting identity references, hashes and replay lineage.
The replay body accepts `mode: "full" | "partial"` and, for partial mode,
`stepKeys: string[]`; it returns the new run/receipt identity or a typed
conflict/refusal. Route handlers stay thin and call the application service.

### D7 — Explicit non-goals

This slice does not add Approval Gateway policy, change the seven execution
modes, move AgentTraceEvent/PipelineRun ownership, implement network sync, or
modify FUNG/Lalin. The meeting/action adapter may consume the shared trace
contract later; producer-specific work is a separate approved slice.

## Alternatives and consequences

Using `PlanImportReceipt` as the full ledger was rejected because it has one
receipt per import and no step/attempt or replay history. Reusing
`AgentTraceEvent` or `PipelineRun` was rejected because it violates domain
ownership and their lifecycle contracts. A separate `ExecutionAttempt` model
was rejected for this slice because one step row with a stable attempt identity
is sufficient; a later decision may split attempts if a real provider requires
independent attempt payloads.

The additive schema and compatibility projection increase storage and require
scope indexes, but they make failure localization, safe replay and Docker
rollback inspection possible without changing existing import callers.

## Verification

- Schema and migration parity are checked for Prisma and the repository's
  Postgres migration tree.
- Unit/service tests prove bounded snapshots, ID uniqueness, scoped reads,
  idempotent imports, failed-step details, partial replay and immutable source
  lineage.
- Existing plan-import, bundle, audit and authorization suites remain green.
- `npm run govern`, `npm run verify` and the Docker compose health/API smoke
  gates are run before release claims. Local, CI, Docker and production proof
  remain separate evidence classes.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-22 | candidate | Approved design for the Project Manager execution trace and append-only replay slice | uncommitted | RWANG |
