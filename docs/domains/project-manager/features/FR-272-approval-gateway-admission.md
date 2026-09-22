---
id: ZAI:FR-272-NOTE
title: Project Manager approval gateway admission
feature: FR-272
domain: project-manager
source: v2-native
version: "0.1.0b"
status: beta
created_at: "2026-09-22T00:00:00+07:00,RWANG"
last_update: "2026-09-22T00:00:00+07:00,RWANG"
relations:
  - type: references
    target: ZAI:FR-272
  - type: references
    target: ZAI:ADR-103
---

# FR-272 — Project Manager approval gateway admission

FR-272 promotes PMR-013 into the canonical requirement registry. The Project
Manager owns the exact approval intent for an effectful Agent/Fleet execution
step; Identity remains the authority for current reviewer capability, scope and
revocation; the executor remains responsible for its own lease and effect
receipt. This is a gate before an effect, not a replacement for domain writers,
human CRUD authorization or provider-specific approval records.

The implementation stores one PM-owned `ProjectApprovalRequest` projection with
immutable request content and compare-and-set lifecycle state. The request
digest covers the exact scope, run/step, action/effect, evidence hashes,
expected effects, reviewer capability, policy version and expiry. Payloads are
bounded and redacted; transcript, audio, credentials and executable imported
code are not approval evidence. Every request, decision, supersession,
revocation and admission is linked to the PM trace and appended to
`AuditEvent`.

The reviewer API is scoped to one Project and execution run. Decision and
executor admission re-read the PM run/step, recompute the current input
identity, check expiry and current Identity capability, and refuse requester
self-approval or a stale lease. A replay receives a new run/step identity and
must request a new approval.

## Acceptance evidence

- A-01/A-02: requester self-approval and an H → H2 input mutation are refused.
- A-03/A-04: revoked capability and expired request cannot be admitted.
- A-05/A-06: foreign scope and replay-source approval are not accepted.
- A-07/A-08: state transition and request/decision races are CAS-safe and
  idempotent.
- A-09/A-10: UNKNOWN requires reconciliation and summaries contain no secret.
- A-11/A-12: read-only steps create no row and DEPLOY retains exact evidence.

The implementation is local/isolated evidence only. Production migration,
deployment and activation remain separate release gates.
