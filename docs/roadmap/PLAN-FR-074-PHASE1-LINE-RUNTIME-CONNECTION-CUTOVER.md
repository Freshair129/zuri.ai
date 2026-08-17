---
version: "0.2.0b"
created_at: "2026-08-18T03:02:18+07:00,ATHER"
last_update: "2026-08-18T12:00:00+07:00,ATHER"
status: "beta"
attributes:
  domain: "line-ai"
  doc_type: "implementation-plan"
  scope: "FR-074"
---

# Implementation plan — FR-074 Phase 1 LINE runtime connection cut-over

## Work order

| Work | Deliverable | Exit |
|---|---|---|
| W0 | ADR/PRD/feature/runbook contract and non-overlapping IDs | governance pass |
| W1 | Provider-neutral SecretManagerPort, explicit runtime source and error taxonomy | unit/security tests |
| W2 | Connection purpose/primary selection, DB uniqueness and CAS promotion | tenant/RLS/integration tests |
| W3 | Async Phase 1 runtime composition and bounded versioned secret cache | runtime/failure tests |
| W4 | Local Ollama provider with loopback-only and production rejection guards | provider/SSRF tests |
| W5 | Real-path golden evaluation, build, governance and Opus review | all local gates pass |
| W6 | Production manager wiring, fresh isolation/backup evidence and one signed canary | owner/operator external gates |

W6 is blocked until the owner provides the production secret-manager vendor,
service identity, secret path convention and rotation/version policy. No local
success promotes this phase to production readiness.

FR-075 is the separate Platform management surface for connection metadata and
secret-manager readiness. It does not shorten W6 or become an activation path.

## Current implementation status

- W0: complete — ADR/PRD/feature/runbook and non-overlapping IDs are registered.
- W1–W4: local implementation complete — explicit runtime source, fail-closed
  SecretManagerPort, binding-scoped selector/CAS path, production Supabase RLS
  migration, encrypted local vault adapter and loopback-only Ollama are covered
  by focused tests.
- W5: local gates complete — focused/full tests, build, governance, diff hygiene
  and final Opus review passed; real-provider golden evaluation remains external
  `NOT_RUN` evidence and therefore does not promote production readiness.
- W6: blocked — no production secret-manager adapter, production credential
  provisioning, real provider evaluation or signed LINE canary is claimed.

## Stop conditions

- FR-073 or NFR-014 semantics are changed or reused;
- current work is overwritten or the integration branch removes FR-072
  authorization code/tests;
- production runtime can construct a local vault, raw env credential or Ollama;
- connection scope is client-selected, ambiguous or not DB-enforced;
- secret-manager errors are not redacted/fail-closed;
- real provider, isolation, recovery or canary evidence is missing/stale.

## Rollback

Disable routing first, demote the primary connection, revoke/rotate the affected
secret, preserve source/imported data, and append a redacted idempotent receipt.

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-08-18 | beta | Initial Phase 1 runtime connection cut-over plan | working-tree | ATHER |
| 0.2.0b | 2026-08-18 | beta | Truth-sync local Opus/gates and record FR-075 UI as a separate non-activation workstream | working-tree | ATHER |
