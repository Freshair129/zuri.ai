# ADR-040 — Codex-mediated SmartGift pipeline evidence bridge

**Status:** Approved for local `EVIDENCE_ONLY` implementation — production apply remains gated  
**Date:** 2026-08-21  
**Decided by:** Boss approved the bridge for local `EVIDENCE_ONLY` implementation  
**Relates to:** [ADR-029](ADR-029-STABLE-IDENTITY-BINDINGS-FOR-EXECUTION-PLANS.md), [ADR-030](ADR-030-SUPABASE-DATA-PIPELINE-OBSERVABILITY-AND-REPLAY.md), [FR-071](../domains/knowledge/features/FR-071-supabase-data-pipeline-monitor-and-replay.md)

## Context

The SmartGift `ProductIngestAgent`, `CustomerIngestAgent` and migration agent
already produce evidence-bearing local staging contracts. Zuri now has a
server-owned pipeline ledger and monitor API, but the local agents do not yet
have a safe worker transport into that ledger.

The local agents must not receive a Supabase `service_role` key, a browser
credential or an unrestricted Zuri write token. Direct local-agent writes would
also blur the boundary between evidence collection, staging and canonical
Product/Customer promotion.

## Decision

### D1 — Codex is the execution coordinator

The next bridge uses the following boundary:

```text
SmartGift local agent
  → redacted append-only evidence outbox
  → Codex worker
  → authenticated Zuri MCP adapter
  → existing Pipeline tracking service
  → Zuri Data Migration monitor
```

Zuri remains the display and server-owned ledger surface. Codex is the worker
that selects the run, invokes the local agent, submits lifecycle evidence and
handles retries. SmartGift does not call Supabase directly.

### D2 — MCP is an adapter, not a second persistence path

Add a separate `data_pipeline.*` MCP namespace rather than expanding the
existing `project_manager.*` PlanEnvelope tools. The adapter must call the
existing application services:

| Tool | Role | Write mode |
|---|---|---|
| `data_pipeline.run_create` | create an idempotent run after server-side Business resolution | mutation |
| `data_pipeline.document_stage` | submit the restricted document contract to the existing staging receiver | mutation |
| `data_pipeline.event_record` | record stage, heartbeat, record, reconciliation or gate evidence | mutation |
| `data_pipeline.monitor_read` | read the scoped monitor model | read-only |
| `data_pipeline.replay_request` | request an immutable queued replay | explicit mutation |

The MCP adapter must not write Prisma/Supabase tables itself. The HTTP routes
remain available for the same service layer and tests.

### D3 — Scope is resolved by Zuri

The local outbox carries the source business namespace (`smartgift`) and
provenance, never a caller-selected `tenantId` or destination override. The
authenticated Zuri server resolves the internal Business, Tenant and active
document-intake connection. A contract cannot widen its destination scope.

### D4 — Evidence and document payloads stay separate

Pipeline events contain identities, hashes, counts, status, failure references
and redacted provenance only. They must not contain raw document bytes, OCR
text, customer names, phone numbers, email addresses, Tax IDs or secrets.

The restricted document contract may be submitted only through the existing
server-side staging boundary. It must not be copied into the pipeline event,
AuditEvent payload or monitor read model.

### D5 — Shadow mode is the first rollout

The bridge starts in `EVIDENCE_ONLY` mode:

```text
local extraction → staging contract + lifecycle evidence → monitor
```

It does not execute Supabase canonical apply, Product/Customer promotion,
publish or rollback. Those remain separate gates after non-production RLS,
isolation and failed-stage replay proofs.

### D6 — Authentication and failure handling

MCP uses the existing authenticated viewer/session boundary. A session ID is a
protocol continuation token, never an authorization grant. Every mutation is
idempotent, retries the same request key, emits a safe error reference and
leaves the original run immutable. A missing or stale heartbeat remains
`UNKNOWN`; it is not converted to success by the worker.

## Acceptance criteria for the approved local slice

1. A local Product or Customer intake can produce a redacted outbox event with
   the canonical run/stage/attempt identity and artifact hash.
2. Codex can create a run and submit events through `data_pipeline.*` MCP while
   the same existing tracking service stores the result.
3. Duplicate run/event delivery returns the existing receipt; retries never
   create a second record outcome.
4. Tenant/Business/connection scope is server-resolved and caller overrides are
   rejected.
5. No pipeline event, audit row or monitor response contains raw PII, OCR text,
   image bytes, database URLs or credentials.
6. A failed local extraction is visible as a failed stage/record with a safe
   error reference and can be replay-requested without overwriting the source
   run.
7. Shadow-mode verification proves the bridge never performs canonical
   Supabase apply.

## Explicit non-goals

- No direct SmartGift → Supabase connection.
- No `service_role` or long-lived browser/API credential in the local agent.
- No automatic canonical Product/Customer promotion.
- No remote Supabase migration apply or production deployment in this slice.

## Approval gate

The owner approved the Codex-mediated MCP boundary and the `EVIDENCE_ONLY`
rollout mode. This approval authorizes local implementation and verification
only; canonical Supabase apply, Product/Customer promotion, publish, rollback,
remote migration apply and production deployment remain separately gated.
