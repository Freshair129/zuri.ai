---
id: ZAI:FR-272-NOTE
title: Project Manager approval gateway admission
feature: FR-272
domain: project-manager
source: v2-native
version: "0.2.0b"
status: beta
created_at: "2026-09-22T00:00:00+07:00,RWANG"
last_update: "2026-10-23,Codex"
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

## A1 acceptance evidence — 2026-10-23

**Scope/source:** owner-approved [A1 plan](../../../plans/PM-APPROVAL-VERIFICATION-20261023.md),
base `c291afcd601a9036a0f188656b96a233c20d4979`, implementation/test commit
`6888ecc629cca769866d8cc2f715cb5414746c5f`. The canonical FR-272 source-preserved row and its lifecycle
are unchanged. This is local acceptance of A1, not full PM acceptance or a release.

### Reproduced defect and correction

The initial real-engine run passed five proofs but admitted a request after the
reviewer's persisted Membership was revoked during its row-lock wait. A focused
rerun reproduced both revoked and expired Membership admitting incorrectly
(two failures; five deselected tests were not counted as passes). The cause was
trusting the pre-wait viewer permission snapshot and sampling the clock at entry.

The gateway now takes a portable, parameterized no-op row write lock in the same
transaction, rereads the request, then samples the default clock and resolves live
Identity authority through `resolveAuthorizationContext`. Decision checks the
current reviewer; admission checks the original recorded reviewer and, if different,
the executor. An explicit caller-supplied time retains its deterministic meaning.
CAS, audit and trace writes remain atomic; public service signatures, action/digest
policy and owning effect writers are unchanged. No schema or Identity-policy change
was needed.

### Real-engine proof matrix

The new suite uses the generated PostgreSQL Prisma adapter and the existing
`global-setup-postgres.js` disposable embedded PostgreSQL fixture. Its URL comes
only from Vitest `inject('testDatabaseUrl')`; no external environment URL is read.
Person, Membership and RoleBinding are persisted; viewers pass the shared factory.
The fixture selects an existing `PRODUCT_OWNER` permission, not a new PM grant.

| Cases | Observed result |
|---|---|
| A-07 opposing APPROVE/REJECT | Distinct backend sessions and an observed `pg_blocking_pids` row-lock wait; one terminal winner, typed `APPROVAL_ALREADY_DECIDED`/409 loser, one matching actor/action audit, no admission |
| A-08 identical decision retry | Same controlled overlap; canonical projection/idempotent response and one transition audit |
| Concurrent admission | One short-lived receipt, one consumed refusal, one linked CONSUMED audit; run/step link to that audit, receipt lifetime equals `APPROVAL_ADMISSION_TTL_MS`, raw token is not persisted |
| Atomic decision and admission failure (two cases) | Fault at real transaction's audit create after successful CAS; approval, run, step and audit snapshot exactly match pre-call values after rollback |
| Original reviewer revoked/expired while decision/admission waits (four cases) | Owner-service revoke or arranged Membership expiry with a deterministic post-wait clock; typed refusal, no admission; still-active distinct executor cannot substitute for reviewer |
| Distinct executor revoked/expired (two cases) | Original reviewer stays active; withdrawn executor is independently refused |
| Request expiry during decision/admission waits (two cases) | Post-wait expiry is exclusive; typed `APPROVAL_EXPIRED` refusal |
| REVOKED/EXPIRED transitions | Exactly one matching audit linked by request `auditEventId` and `entityId`, with correct after-state/digest; no CONSUMED audit |

The 13 tests contain no skips or retry-only acceptance. Barrier deadlines fail
rather than skip. Held transactions are released, promises settled and independent
clients disconnected in `finally`; global teardown completed without a stop or
leftover-directory warning. Expiry uses a controlled clock; it is not a wall-clock
latency measurement. No external effect executor/provider is called.

### Commands and results

Commands ran against the application/test source composed into `6888ecc629cca769866d8cc2f715cb5414746c5f`.
The final focused run also includes the review's comment-only clarification; the
full-profile executable code is identical. Counts overlap and are not additive.

| Command | Result |
|---|---|
| `npm --prefix apps/server run test:postgres -- tests/postgres/project-approval-gateway-races.test.js` | Final focused run: 13/13, zero skipped |
| `npm --prefix apps/server run test:postgres` | Complete configured PG profile: 10 files, 114/114, zero skipped |
| `npm --prefix apps/server test -- tests/integration/project-approval-gateway.test.js tests/integration/project-execution-trace.test.js` | Original PM 5 + trace/replay 4: 9/9 on isolated SQLite |
| `npm --prefix apps/server test -- tests/integration/project-approval-gateway.test.js tests/integration/project-execution-trace.test.js tests/integration/iam-authorization.test.js tests/integration/fr191-access-grant-lifecycle.test.js tests/unit/authorization-context.test.js tests/integration/agent-approval-gateway.test.js` | Expanded SQLite regression: 6 files, 39/39, zero skipped |
| `npm --prefix apps/server run build` | PASS; compilation and Next validity phase completed. Existing multiple-lockfile root warning remains; no standalone lint/typecheck claim |

A first setup attempt collected zero tests because the worktree lacked the generated
SQLite Prisma client. Running the existing `scripts/generate-prisma-clients.mjs`
restored local generated clients, then all reported proof runs executed tests.
The zero-test setup error was not a product RED or a pass. Vite's CJS deprecation
notice is also present in test output.

### Review and remaining boundaries

Independent GPT-6 Luna Max review found two P2 proof gaps: independent executor
withdrawal and REVOKED/EXPIRED audit linkage. Both were added, tested and accepted
in re-review; no P1/P2 remained. The helper is explicitly constrained to the suite's
injected database, while independent clients are only for contested operations.

A-07/A-08, concurrent admission and atomic-audit proofs are closed locally for
this source. The original five PM cases retain their bounded scope/SoD/hash/expiry/
lease/replay checks. This increment does not assert fresh acceptance of every
A-01–A-12 clause or transfer Agent quorum evidence to FR-272. Actual runtime-role
qualification (Track B2), exact-head hosted CI/merge, external/live acceptance,
production migration, deployment and activation remain open/separate. No DDC
record, G0 workflow or replacement admission ledger is required under ADR-113.

## Version history

0.1.0b → 0.2.0b (2026-10-23): replace broad acceptance bullets with source-bound
A1 evidence, defect/fix chronology, actual engine-specific commands, independent
review findings/resolution and explicit release limits. No canonical record change.
