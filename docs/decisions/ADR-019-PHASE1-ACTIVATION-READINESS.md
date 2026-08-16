---
version: "0.2.0b"
created_at: "2026-08-14T07:58:02+07:00,ATHER"
last_update: "2026-08-14T08:20:18+07:00,ATHER"
status: "beta"
superseded_by: null
attributes:
  domain: "line-ai"
  doc_type: "architecture-decision"
  scope: "Phase 1 evaluation, isolation proof and controlled LINE canary"
---

# ADR-019 — Phase 1 activation readiness

**Status:** Accepted for production-disabled implementation; activation remains gated

## Status

Accepted for implementation on 2026-08-14. This decision authorizes readiness tooling and
production-disabled evidence generation only. It does not authorize credential creation, binding
activation, general LINE traffic or Phase 2.

## Context

FR-047..052 are merged and the production database slice is deployed, but Phase 1 is not accepted.
The remaining proof is fragmented across provider configuration, a live runtime-role isolation
probe, twenty approved business questions and one signed LINE canary. Running those steps manually
would make results difficult to reproduce and could expose credentials or accidentally broaden
traffic.

## Decision

1. Add a versioned golden-question contract and deterministic evaluator. Assertions operate on
   bounded evidence and normalized provider output; they never grant database or network authority.
2. Add a read-only runtime isolation probe that accepts the dedicated database URL from process
   environment, reports redacted assertions and always rolls back its mutation attempt.
3. Add a canary preflight and plan artifact. Default mode is dry-run; it cannot activate a binding
   or send LINE traffic.
4. Keep execution receipts distinct: `GENERATED`, `EVIDENCE_VERIFIED`, `ACCEPTED_BY_LINE`,
   `DISPLAYED_UNKNOWN` and `READ_UNKNOWN` must never be collapsed into “delivered”.
5. Evidence artifacts contain hashes, assertion results and timestamps, never secret material,
   raw authorization headers, full database URLs, reply tokens or customer PII.
6. A later operator-controlled activation requires external approval and all ADR-018 activation
   gates. Readiness tooling passing is necessary but not sufficient to enable production.

## Alternatives rejected

- Ad-hoc shell commands: not reproducible and too easy to leak connection material.
- Reusing unit tests as production evidence: tests prove code contracts, not the real runtime role
  or provider/channel acceptance.
- Starting Phase 2 first: Phase 2 explicitly depends on accepted Phase 1 canary evidence.
- Automatically enabling the binding after preflight: violates the two-step production gate.

## Consequences

- Phase 1 acceptance becomes repeatable and reviewable.
- W1, W2 and W3 can proceed independently after the shared contract is frozen.
- Real credentials and production mutation remain operator inputs outside Git.
- A failed probe or canary leaves the binding `PENDING` and the kill switch off.

## Implementation evidence

W0-W4 are implemented and pass the repository regression gates recorded in
`.agent/reports/PHASE-1-ACTIVATION-READINESS.md`. This advances merge readiness only. Real-provider
evaluation, the live dedicated-login probe, backup/rollback acceptance and the signed LINE canary
remain external gates with status `NOT_RUN`.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-14 | beta | Owner-approved production-disabled activation readiness boundary | working-tree | ATHER |
| 0.2.0b | 2026-08-14 | beta | W0-W4 merge evidence recorded without changing external activation authority | working-tree | ATHER |
