---
id: ZAI:ADR-106
title: "Conversation Runtime service extraction"
version: "1.0.0"
status: approved
created_at: "2026-09-24T00:00:00+07:00,Codex"
last_update: "2026-09-24T00:00:00+07:00,Codex"
author: Codex (implementation owner)
approved_on: "2026-09-24"
approved_by: "User instruction in Session 1"
attributes:
  doc_type: architecture-decision
  domain: agent
  scope: conversation-runtime-process-extraction
relations:
  - type: relates_to
    target: ZAI:ADR-061
  - type: relates_to
    target: ZAI:ADR-100
  - type: relates_to
    target: ZAI:ADR-105
  - type: relates_to
    target: ZAI:FR-149
  - type: relates_to
    target: ZAI:FR-171
  - type: relates_to
    target: ZAI:SDD-108
---

# ADR-106 — Conversation Runtime service extraction

**Status:** Approved for local implementation on 2026-09-24. Production cutover,
database migrations and live LINE/model calls remain separately gated.

**Risk:** HIGH. This boundary affects job ownership, private model credentials,
account revocation fences, delivery ambiguity, context policy and deployment
topology.

## Context

ADR-105 establishes stateless LINE application processes and keeps durable state in
the existing Zuri database with logical model ownership. The user has authorized an
independently buildable and runnable Conversation Runtime as the first service
extraction, before Work Management. That is the operational trigger for the narrow
runtime split. The extraction does not split CRM, Identity, Work Management, MSP or
GKS and does not create a new repository or database.

The current implementation puts webhook admission, job claiming, turn/context
assembly, model calls, Project/Work commands, LINE sending and receipt recovery in
Next.js modules. Moving only the worker folder or container would not move runtime
ownership.

## Decision

### D1 — Runtime ownership

`services/conversation-runtime/` is the independently buildable/runnable process
that claims eligible conversation work through the versioned core contract, checks
current authority, composes turn context, routes bounded tools, invokes the model,
coordinates channel delivery, and reports completion/trace outcomes. It has no
Next.js dependency, Prisma client, global database credential, foreign-repository
source, or direct table access.

The Zuri web process remains the UI/control plane and a private transport adapter.
It retains authentication, webhook signature validation, account binding, Identity
and consent authority, Integration secret storage and provider transport, CRM
conversation records, LINE job/admission persistence, canonical Work writers, and
MSP/GKS adapters. Existing public routes remain available. The internal API is not
public and never accepts an LLM-supplied viewer or scope.

### D2 — Versioned ports and ownership

The first contract is `conversation-runtime.v1` with strict bounded requests and
responses, correlation id, deadline, idempotency key, typed errors and contract
version. Its port operations are:

| Port | v1 operations | Authority / durable owner |
|---|---|---|
| Job / Admission | `claim`, `renew`, `complete`, `fail`, `status` | Core owns the existing LINE job and durable ingress outbox |
| Authority / Context | `resolve`, `prepare` | Core derives account, tenant, business, actor, binding, epoch, consent and memory policy from authoritative records |
| WorkTool | `read`, `propose`, `confirm-execute`, `status` | Core façade revalidates authority; confirmation, canonical mutation and receipt remain in the existing transaction |
| Model | `credential`, `invoke` | Integration SecretStore remains credential authority; a credential grant is claim-bound, short-lived, memory-only and excluded from logs/traces |
| Memory / Knowledge | `read`, `append`, `receipt` | Existing MSP/GKS service boundaries and policy remain authoritative; no implementation is copied into this service |
| Delivery | `send`, `receipt` | Integration keeps LINE credentials and provider transport; CR coordinates calls and recovery |
| Trace / Audit | `append`, `status` | Core-owned scoped journals and audit models remain authoritative |

The exact wire schemas live beside the service implementation. Raw Prisma rows,
transaction handles, reusable provider/channel credentials, unverified viewer data,
unbounded payloads and arbitrary tool names do not cross the boundary. A timed-out
provider operation is `UNKNOWN` when acceptance cannot be established. Reply-token
fallback remains limited to the existing confirmed-dead-token rule; ambiguous Reply
outcomes are never retried as Push. No exactly-once provider delivery claim is made.

### D3 — Ingress and one consumer

The signed webhook URL stays in the core. Before 2xx, each durably captured event is
marked `ADMITTING` as the single outbox handoff. If that durable marker fails, ingress
returns non-2xx for LINE retry. The existing reconciler is the restart mechanism and
core admission remains idempotent; a process-local post-ack continuation is only a
wake-up hint, never the sole handoff.

Core remains the only owner of `LineConversationJob` writes. For each job cohort,
exactly one executor is active: either the Conversation Runtime or the legacy core
worker. Cutover is gated by an authoritative routing state and a quiescence check,
not conflicting local environment flags. The legacy `/api/line-oa/worker` route
remains as a bounded maintenance/compatibility route and no longer executes turns
when CR owns the cohort.

### D4 — Leases, fencing and side effects

Claims are atomic and include claimant, execution id, lease, version and transport
epoch. The runtime renews the lease while work remains within the job deadline.
Every complete, tool, model-grant and delivery operation revalidates the expected
claim and current account/consent authority. Stale or revoked claims cannot complete
or start a new side effect. Work mutations use stable operation ids and canonical
receipt lookup. Existing Reply/Push ambiguity and erasure semantics remain unchanged.

Graceful shutdown stops new claims, drains bounded operations, and releases or leaves
leases to expire for core reconciliation. Restart uses durable job/outbox state; it
does not replay an uncertain Reply or duplicate a confirmed Work mutation.

### D5 — Build and deployment boundary

The service has its own ESM package, lock strategy, test configuration, health and
readiness endpoints, graceful shutdown, and Docker image. Build and test do not run
Next.js or Edge. Its production artifact contains only the service and declared
contracts; Compose does not bind-mount `apps/server` into the runtime. The service
uses only authenticated core ports for shared authority. Production deployment is
outside this ADR's implementation scope.

## Migration and rollback

1. Keep current schemas and data; this extraction does not require a production
   migration.
2. Before cutover, disable the legacy turn executor, wait for active claims to
   finish or expire, and reconcile `SENDING`, `ACCEPTED`, `UNKNOWN` and stale
   `ADMITTING` records.
3. Enable the CR cohort through core-owned routing, then verify claim, completion,
   receipt and trace behavior with fake providers before any live canary.
4. For rollback, stop new CR claims first, reconcile its leases and all ambiguous
   delivery states, then restore the legacy executor for the cohort. Do not let both
   executors claim the same jobs. No automatic rollback retries an `UNKNOWN` Reply.

## Alternatives and consequences

- A worker folder or container that still calls the Next worker to answer is not an
  extraction and is rejected.
- Direct Prisma access from CR would duplicate Identity/CRM/Work ownership and is
  rejected.
- A new broker or second database would add unsupported infrastructure and a second
  durable handoff, so neither is introduced.
- Core retains temporary state and side-effect adapters. This keeps transactions and
  credentials in their owners while allowing runtime execution to move first.

## Verification

Acceptance covers pure unit execution, isolated component execution with owned test
state, strict contract tests, signed-ingress workflow, failure/restart recovery,
service-only image isolation and affected legacy consumers. Each evidence level is
reported separately. Production cutover is not inferred from local proof.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 1.0.0 | 2026-09-24 | approved | Approve first independent Conversation Runtime extraction ahead of Work Management; keep existing domain data owners behind conversation-runtime.v1 ports | uncommitted | Codex |
