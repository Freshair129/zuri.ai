---
id: ZAI:PM-APPROVAL-GATEWAY-ADMISSION-DESIGN
title: Project Manager Approval Gateway admission design
version: "0.1.0b"
status: candidate
created_at: "2026-09-22T00:00:00+07:00,RWANG"
last_update: "2026-09-22T00:00:00+07:00,RWANG"
superseded_by: null
attributes:
  doc_type: implementation-plan
  domain: project-manager
  scope: "PMR-013 / PMT-013 approval admission after ADR-102"
relations:
  - type: references
    target: ZAI:ADR-103
  - type: references
    target: ZAI:ADR-102
  - type: references
    target: ZAI:PM-SYSTEM-DELIVERY
---

# Approval Gateway admission — design and delivery packet

**Status:** Candidate / design only
**Complexity:** C-3 architecture-driven
**Risk:** HIGH
**Requirement source:** PMR-013, acceptance PMT-013
**Parent handoff:** ADR-102 PM execution trace and replay
**Implementation state:** NOT_STARTED / NOT_RUN

This packet is the phase-level companion to [ADR-103](../../decisions/ADR-103-PM-APPROVAL-GATEWAY-ADMISSION.md). It freezes the proposed boundary and
acceptance before any code, schema or production action. PMR-013 remains a
proposal-local key until canonical registration; it must not be used as a
source annotation.

## 1. Problem and outcome

The PM trace can now record a run, step, attempt, hash and replay lineage. The
next capability is to stop an effectful Agent/Fleet step at a durable approval
boundary and release it only when the same exact scope, action, input and
evidence are still approved by an eligible reviewer.

The outcome is not "everything needs a button." The outcome is:

```text
planned step
  → exact PM approval request
  → two-party decision under current Identity authority
  → last-moment executor admission recheck
  → owning writer / provider effect
  → receipt, failure or UNKNOWN reconciliation
```

Read-only work stays available under existing read authorization. Existing
human PM CRUD and domain-specific approvals retain their current owners unless
they explicitly enter this execution-run path.

## 2. Ownership and boundary matrix

| Surface | Owns | Must not own |
|---|---|---|
| PM Approval Gateway | request digest, PM run/step linkage, pending/decision projection, typed refusal, audit linkage | Identity grants, provider secrets, external effect implementation |
| ProjectExecutionRun/Step | execution lifecycle, attempt IDs, replay lineage, current step state | reviewer eligibility or generic capability registry |
| Identity | effective scope, reviewer capability, revocation, SoD and optional step-up/AAL | PM effect payload or execution receipt |
| Executor/Integration | lease, epoch, process boundary, effect call and external receipt | minting or approving its own request |
| Owning domain | idempotent writer and domain-specific validation | bypassing approval by calling a second PM writer |

The boundary is deliberately narrower than a general authorization rewrite.
The new service is an admission control for PM execution runs, not a second
RBAC system.

## 3. Proposed state and data contract

### 3.1 Approval request envelope

The request content is immutable after creation. The lifecycle state is a CAS
projection backed by AuditEvent history.

| Group | Fields |
|---|---|
| Scope | `tenantId`, `businessId`, `workspaceId`, `projectId` |
| Trace | `executionRunId`, `executionStepId`, `effectKey` |
| Action | `actionClass`, `expectedEffects`, `eligibleReviewerCapability`, `policyVersion` |
| Evidence | `manifestHash`, `inputHash`, bounded `artifactHashes[]`, optional `commitSha` |
| Review | `requestedByPersonId`, `requestedAt`, `expiresAt`, bounded redacted `payloadSummary` |
| Integrity | `requestDigest`, `state`, `auditEventId` / decision audit references |

The request digest is SHA-256 over canonical JSON of all authority-bearing
fields. Display labels, transport ids, UI ordering and free-form prompt text
are excluded. Secrets, transcript/audio content, provider credentials,
arbitrary code and unbounded imported payloads are rejected before persistence.

### 3.2 State vocabulary

| State | Meaning | Effect permission |
|---|---|---|
| `PENDING` | Request exists and awaits a current eligible reviewer | none |
| `APPROVED` | Reviewer approved the exact digest before expiry | not sufficient without executor recheck |
| `REJECTED` | Reviewer refused the request | none; draft/trace is retained |
| `EXPIRED` | Server time reached `expiresAt` | none |
| `REVOKED` | Grant, policy or explicit revocation invalidated it | none |
| `SUPERSEDED` | A material input/hash/scope revision replaced it | none |
| `CONSUMED` | Admission receipt was issued for the exact effect key | duplicate effect is refused/idempotent |

The PM step remains `WAITING_APPROVAL` until `admitApprovedStep` succeeds. An
approved request does not directly change business state.

### 3.3 Action classes for the first policy revision

```text
READ_ONLY
PROJECT_WRITE
EXTERNAL_MESSAGE
SPEND
CREDENTIAL_CHANGE
MERGE
DEPLOY
DESTRUCTIVE
```

The list is an allowlist. A new class or a change to digest inputs is a policy
revision and cannot arrive through an imported plan, prompt, MCP schema or
browser label.

## 4. Admission algorithm

1. Resolve the requested PM run/step and derive scope from server-owned rows.
2. Confirm the step is effectful and currently eligible for approval; read-only
   steps do not create an approval request.
3. Reject a step with an unresolved prior external effect as
   `RECONCILIATION_REQUIRED`.
4. Normalize the action, expected effects and bounded review summary.
5. Compute the canonical request digest and apply scoped idempotency.
6. Resolve the eligible reviewer capability through Identity; do not infer it
   from a role label or the requester's claimed Business.
7. Create the request and PM trace/audit linkage in one transaction.
8. On decision, lock/CAS the pending request, re-resolve scope and capability,
   check expiry and enforce requester/reviewer SoD.
9. Recompute the current digest immediately before recording `APPROVED`.
10. On executor claim, recheck request state, digest, expiry, grant revocation,
    run/step identity and lease epoch.
11. Issue a short-lived admission receipt bound to
    `(approvalRequestId, requestDigest, executionRunId, executionStepId,
    effectKey, leaseEpoch)`.
12. Let only the owning writer/provider use the receipt; record success, failure
    or `UNKNOWN`. An unknown result stops automatic retry.

## 5. Candidate API and service surface

The first implementation should expose application services rather than let
routes and executors duplicate policy:

```text
requestApproval(input, viewer)
decideApproval(approvalRequestId, decision, viewer)
admitApprovedStep(approvalRequestId, requestDigest, leaseEpoch, executor)
revokeOrSupersede(approvalRequestId, reason, cause)
```

Candidate reviewer routes, subject to canonical OpenAPI registration:

```text
GET  /api/projects/:projectId/execution-runs/:executionRunId/approvals
POST /api/projects/:projectId/execution-runs/:executionRunId/approvals/:approvalRequestId/decision
```

The executor does not receive a public route that creates or approves a
request. Its admission call is a service/worker boundary authenticated by the
existing executor identity and lease contract.

### Typed refusal vocabulary

```text
APPROVAL_REQUIRED
APPROVAL_NOT_FOUND
APPROVAL_EXPIRED
APPROVAL_REVOKED
APPROVAL_SUPERSEDED
INPUT_CHANGED
REVIEWER_NOT_ELIGIBLE
REVIEWER_CONFLICT
APPROVAL_ALREADY_DECIDED
SCOPE_NOT_ALLOWED
RECONCILIATION_REQUIRED
APPROVAL_LEASE_MISMATCH
```

Every refusal is scope-safe and carries no foreign identifier or payload.

## 6. Acceptance matrix

| Case | Given | Required result | Evidence class |
|---|---|---|---|
| A-01 | Requester tries to approve own protected step | `REVIEWER_CONFLICT`, no admission | unit + integration |
| A-02 | Approve digest H, current step presents H2 | `INPUT_CHANGED`, no owning writer call | integration + race |
| A-03 | Reviewer grant revoked after approval | executor recheck refuses `APPROVAL_REVOKED` | integration |
| A-04 | Request expires before claim | `APPROVAL_EXPIRED`, no claim/effect | unit + integration |
| A-05 | Foreign scope in URL/body/cursor | typed not-found/denied with no leak | authorization matrix |
| A-06 | Source run approved, replay run claims it | replay requires a new request | replay integration |
| A-07 | Two decisions race on one pending request | one CAS winner; one typed conflict; one audit trail | PostgreSQL/race |
| A-08 | Same request/digest is retried | same receipt/projection; no duplicate effect | idempotency |
| A-09 | Provider/domain effect outcome is unknown | `UNKNOWN` plus reconciliation; no blind retry | failure/recovery |
| A-10 | Audit/payload contains secret sentinel or transcript | persistence and response refuse/redact it | privacy/security |
| A-11 | `READ_ONLY` step is admitted | no approval row; existing read path remains usable | unit |
| A-12 | `DEPLOY` request names image/migration/rollback | all exact release fields are in digest; changed target invalidates | contract |

PMT-013 is the mandatory cross-check for A-02. The phase must also retain the
existing PM trace/replay, audit and authorization suites as regression gates.

## 7. Delivery sequence

| Gate | Deliverable | Exit condition |
|---|---|---|
| G0 | Canonical registration and owner mapping | PMR-013 is mapped without repurposing FR-196; exact IDs are recorded |
| G1 | Frozen request/error/OpenAPI contract | hash inputs, action allowlist, scope and reviewer port reviewed |
| G2 | Schema/adapter packet | SQLite/Postgres/backup/RLS/erasure impact and rollback are reviewed |
| G3 | PM service and trace linkage | focused negative/race/idempotency tests pass; no second business writer |
| G4 | Reviewer API/console slice | scoped pending list and decision path pass auth/SoD/privacy tests |
| G5 | Executor admission integration | lease/epoch/hash/expiry/revocation rechecks pass; unknown stops retry |
| G6 | Composed governance/build/CI | `npm run govern`, tests and build pass on exact revision |
| G7 | Separate release decision | migration, Docker image, rollback and runtime activation are separately approved |

No gate above claims production deployment, migration application or FUNG/Lalin
activation.

## 8. Out of scope

- FUNG or Lalin recording/meeting adapters;
- transcript, audio, contact/person identity or provider credential handling;
- Approval Gateway for Integration pipeline catalog publication;
- changing existing direct PM CRUD authorization;
- autonomous approval, self-approval, owner-name bypass or imported executable code;
- production Docker migration/deploy in this documentation phase.

## 9. Version diff

| Area | Before | Candidate after this packet |
|---|---|---|
| PM execution | Trace records what a run did | Trace can be paired with an exact approval intent before admission |
| Authorization | Existing route/role checks only | Current scope + reviewer capability + SoD + digest recheck at admission |
| Replay | New run/step lineage | Source approval is not inherited; replay requests a fresh decision |
| External effects | Owning writer/receipt boundary | Gateway issues a short-lived, exact effect admission receipt |
| Production state | No change | No migration, deployment or activation claimed |

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-22 | candidate | Candidate phase packet for PMR-013 Approval Gateway admission; no implementation | uncommitted | RWANG |
