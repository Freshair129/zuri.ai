---
doc_type: contract
task_id: TASK-ZAI-010
version: "1.0.0"
status: adopted
updated_at: "2026-10-16"
---

# Agent Approval Gateway v1

**Lifecycle: adopted for implementation.** Decision `TASK-ZAI-010-L1-L4-DISPOSITION-20261016-01` fixes the approval policy for selected FR-026 writes. This is an Agent-owned prerequisite to Gate F execution. It does not grant Identity permission, replace step-up, execute a write itself, or authorize production deployment or migration application.

## Ownership and boundary

- Agent owns `AgentApprovalRequest`, `AgentApprovalDecision`, the action-tier metadata, and the authenticated approval queue/decision API.
- Identity continues to resolve the requester and reviewer Persons and current Membership authority. An approver must have an active, unexpired, Business-scoped `OWNER` Membership for the exact Tenant and Business on the request. Tenant-wide Membership, RoleBinding, persona metadata, and owner status in another Business do not qualify.
- The original requester must still pass FR-026 Gate F when executing. The approval is an additional prerequisite, never a substitute for Gate F, resource ownership, Identity scope checks, or the action's canonical writer.
- HIGH sensitivity remains a separate control. A HIGH write requires fresh single-use step-up when the requester executes it, and that token is consumed in the same transaction as approval consumption, the canonical writer, and its audit event.
- The PM approval gateway (FR-272 / ADR-103 / `ProjectApprovalRequest`) remains separate and unchanged. Approval decisions are not stored in `AgentTraceEvent` or used as a replacement for `AuditEvent`.
- AI persona `approvalTier` is not an action classification and does not confer reviewer authority.

## Action policy

The tier is explicit server-owned metadata on each write descriptor, independent of LOW/HIGH sensitivity.

| FR-026 action | Tier | Behavior |
|---|---:|---|
| `close_conversation` | L1 | Require one distinct active same-Tenant+Business OWNER approval. |
| `set_customer_lifecycle` | L2 | Require two distinct active same-Tenant+Business OWNER approvals. |
| `deactivate_customer` | L4 | Require four distinct active same-Tenant+Business OWNER approvals and a fresh HIGH step-up at execution. |
| `update_own_display_name` | NONE | Continue through Gate F without an approval request. |
| `refund_order` | Unavailable | No executor exists; never create, decide, or execute an approval request for it. |

The reusable quorum engine supports L3 (three distinct owners), but no production action is assigned L3 in v1. L3 is exercised only with an isolated engine fixture.

The requester cannot vote. One Person can record at most one decision per request. Any rejection makes the request terminal. The approval queue and API derive the acting Person from the authenticated Identity session, never from a request body or Agent persona.

## Request lifecycle and effect binding

An initial call for an approval-gated action passes the existing Gate F authorization checks, then records a `PENDING` request. It performs no business write and consumes no step-up token. The fixed expiry is 24 hours from creation; there is no renewal.

Each request binds:

- original requester Person;
- Tenant and Business resolved from the target resource;
- server-registered action and tier;
- the action-specific concrete target foreign key;
- the target's current version stamp; and
- a SHA-256 digest of the canonical request input, including requester, scope, action, target and exact payload.

The gateway stores no input payload in its audit records. The requester must resubmit the same request ID and exact action, target and payload. A different requester, scope, action, target, target version, or digest cannot reuse the approvals. Target version changes make the request stale.

Before executing, the service re-resolves the requester's LINE identity and current Identity authorization, verifies target ownership and version, and recounts approvals from currently active same-Business OWNER Persons. Ineligible or revoked owners do not count. An expired, rejected, stale, unavailable, changed, cross-scope, duplicate, revoked, or under-quorum request fails closed with no business mutation. It is audited with a bounded reason code and no secrets or payload.

For an eligible request, one database transaction conditionally consumes the still-pending request, consumes the HIGH step-up token when required, invokes the existing canonical writer, and appends the execution audit. Any failure rolls back all four effects. Duplicate execution cannot run a second writer.

## Persistence and API

`AgentApprovalRequest` owns immutable request binding plus its lifecycle state and action-specific target foreign keys. `AgentApprovalDecision` owns immutable APPROVE/REJECT decisions, scoped by Tenant/Business and unique by request/Person. Decisions are not inferred from audit rows or execution traces.

- `GET /api/agent/approval-requests?businessId=...` returns the live queue for an authenticated OWNER of that exact Business. It includes request binding needed to review the action and a current eligible approval count, but no raw input payload or digest.
- `POST /api/agent/approval-requests/{requestId}/decision` accepts only `{ "decision": "APPROVE" | "REJECT" }`. The authenticated Identity Person is the actor. The service rechecks the request scope and current OWNER Membership before writing one decision.

The API never accepts a Person, role, Tenant, Business, approval tier, quorum, request payload, or execution permission from the caller. Every route fails closed when authentication, Identity, persistence, scope, or the request state is unavailable.

## Verification and release limits

SQLite tests cover the action gate, quorum/lifecycle, exact binding, no-write-before-quorum, requester separation, duplicate decisions, terminal rejection, expiry, staleness, revocation, step-up, atomic rollback, audit redaction, and authenticated route behavior. PostgreSQL tests use only the repository's disposable embedded loopback cluster. Migration sources are authored in the repository but are not applied to UAT, production, or Supabase. Passing local checks does not claim hosted CI, deployment, or production acceptance.

## Version diff

- 1.0.0 - Adopts the fixed L1-L4 quorum, selected action mapping, same-Business OWNER reviewer rule, 24-hour expiry, exact request binding, Agent persistence/API ownership, fail-closed execution lifecycle, and separation from PM FR-272.
