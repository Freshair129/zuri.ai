---
version: "0.2.1b"
created_at: "2026-08-14T09:20:00+07:00,ATHER"
last_update: "2026-08-14T09:24:00+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "architecture-decision"
  scope: "FR-055 operator-controlled binding activation, rollback and canary receipt"
---

# ADR-020 — Controlled LINE binding activation and receipt

**Status:** Accepted for local implementation; production mutation remains separately gated

## Context

ADR-019 deliberately stops at `DRY_RUN`/`EVIDENCE_VERIFIED`. The W1 audit confirmed that Zuri has
no reviewed path to install destination and credential hashes, activate exactly one binding,
disable it deterministically, or retain a redacted post-LINE receipt. Reusing test SQL or issuing an
ad-hoc privileged update would bypass evidence hashes, concurrency control, audit and rollback.

## Decision

1. Activation is an operator-only command, never a webhook, browser API, agent tool or automatic
   consequence of preflight.
2. A dedicated operator database role may update exactly one `zuri_core.line_channel_binding` row
   and append activation events. It is distinct from the runtime login, policy role, Data API roles
   and `service_role`.
3. Raw destination, binding bearer and HMAC pepper enter only through the approved process
   environment/secret store. They are never accepted in argv, JSON input, logs or Git. Hashes use
   the existing `hashBindingSecret` HMAC-SHA256 contract.
4. Activation is one transaction with `SELECT ... FOR UPDATE` plus compare-and-swap over exact
   project/Tenant/Business/binding/provider/code, expected version, `PENDING` status, null hashes
   and a still-valid approval window. It writes both hashes, `ACTIVE`, `valid_from`, bounded
   `expires_at`, increments `version`, and appends the activation event atomically. The binding
   expiry must be later than execution time and no later than the approved window expiry; no
   separate unapproved TTL is inferred.
5. The current status enum is retained. Canary limitation comes from one exact binding, bounded
   expiry and routing kill switch; no speculative `CANARY` status is added.
6. Rollback disables routing first with an `ACTIVE -> INACTIVE` versioned compare-and-swap and an
   append-only event. Imported knowledge and source evidence are preserved. Credential rotation is
   a separate event when exposure is suspected.
7. Receipt evidence is append-only and correlation-idempotent. `GENERATED`,
   `EVIDENCE_VERIFIED` and `ACCEPTED_BY_LINE` are distinct observations;
   `DISPLAYED_UNKNOWN` and `READ_UNKNOWN` remain explicit and can never be promoted to success.
8. `zuri-cli` remains the sole signature/reply transport owner. It returns a redacted transport
   artifact containing correlation ID, pinned source/config hashes, HTTP acceptance class and
   timestamps—never reply token, destination, authorization header, message body or PII.
9. Any stale/mismatched evidence, duplicate correlation, version conflict, missing recovery gate or
   non-`PENDING` row fails before mutation. Any post-activation failure invokes routing-first
   rollback and records the last truthful receipt state.

## Receipt event minimum fields

```text
eventId, correlationId, eventType, receiptState
projectRef, tenantId, businessId, bindingId
bindingVersionBefore, bindingVersionAfter
canaryPlanSha256, goldenReportSha256, isolationReportSha256
providerId, modelId, approvalRef
transportArtifactSha256?, lineAcceptanceClass?
occurredAt, actorFingerprint
```

All hashes are lowercase SHA-256/HMAC hex. No raw authorization or customer content is allowed.

## Alternatives rejected

- Reuse rollback-scoped test SQL — it has no production authority, CAS or durable receipt.
- Use `service_role`/`postgres` in the runtime — violates least privilege and bypasses RLS.
- Auto-activate after a passing plan — collapses readiness into mutation and removes operator gate.
- Treat HTTP 2xx as delivered/read — LINE acceptance proves neither display nor human read.
- Add a new binding status for the canary — unnecessary while exact binding, expiry and routing
  controls already bound the slice.

## Consequences

- Requires an additive migration for a narrowly granted operator role and append-only activation
  event table.
- Requires a versioned activation/receipt JSON contract shared with `zuri-cli`.
- Adds no public API and no general traffic capability.
- Production execution remains blocked until FR-055 implementation, recovery evidence, exact
  destination/provider inputs and a fresh A1/A2 hard join are approved.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | candidate | Proposed least-privilege CAS activation, routing-first rollback and truthful receipt boundary | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | Owner-approved local FR-055 implementation boundary; production execution remains gated | working-tree | ATHER |
| 0.2.1b | 2026-08-14 | beta | Clarified binding expiry uses the approved window as its upper bound | working-tree | ATHER |
