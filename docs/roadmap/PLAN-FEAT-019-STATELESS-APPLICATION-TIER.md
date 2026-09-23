---
id: ZAI:PLAN-FEAT-019-STATELESS-APPLICATION-TIER
version: "0.2.1b"
status: active
created_at: "2026-09-23T20:57:41+07:00,RWANG"
last_update: "2026-09-23T23:48:00+07:00,RWANG"
domain: line-oa-studio
bundle: FEAT-019
attributes:
  doc_type: implementation-plan
  scope: "Stateless LINE OA Studio application tier and recoverable LINE runtime workers"
relations:
  - type: relates_to
    target: ZAI:ADR-105
  - type: relates_to
    target: ZAI:ADR-060
  - type: relates_to
    target: ZAI:ADR-089
  - type: relates_to
    target: ZAI:ADR-095
  - type: relates_to
    target: ZAI:ADR-100
  - type: relates_to
    target: ZAI:PLAN-FEAT-019-PHASES
---

# Implementation plan — FEAT-019 stateless LINE OA Studio application tier

## Purpose

Make the LINE OA Studio Web/API tier and the LINE runtime workers disposable and
restart-safe while keeping authoritative Business state in the existing Zuri
domain ownership boundary.

This plan does **not** make the Studio domain data-free. It does not split the
Studio repository or create a second database authority. It does not authorize
production deployment, secret rotation or a live LINE cutover.

**Complexity:** C-3 — architecture-driven implementation.

**Risk:** HIGH — credential, asynchronous execution, audit and deployment-boundary
changes.

**Implementation gate:** W0 was approved by the owner on 2026-09-23. Local
implementation is in progress; migration application, staging and production
activation remain separate gates.

## Target boundary

```text
Stateless API replicas
        │
        ├── Zuri DB: Identity, Studio state, jobs, journals
        ├── Integration SecretStore: secret material only
        └── authenticated runtime contract
                    │
             Stateless line-runtime workers
                    │
             LINE Messaging API
```

## Work order

| Work | Deliverable | Depends on | Exit evidence |
|---|---|---|---|
| W0 | Approve ADR-105, SRS amendment and this plan; reconcile ADR-100's server-only LINE execution | Owner approval | `govern`, docs graph/check/preflight green |
| W1 | Inventory current Studio routes, workers, timers, caches, local files, secret reads, job leases and journal writers | W0 | source inventory with no unclassified process-local authority |
| W2 | Freeze ownership and contracts for Identity, Integration, Studio, CRM/Agent and journals; reserve only necessary global IDs | W1 | contract review and no direct cross-domain table writes in the target path |
| W3 | Make API instances restart-safe: resolve session/scope from durable state, remove local authority, make request handling correlation-safe | W2 | multi-instance API integration tests and restart test |
| W4 | Make LINE admission and worker execution durable: transaction boundary, lease, retry, idempotency, graceful shutdown and reconciliation | W2 | duplicate webhook, kill-during-claim, retry and completion tests |
| W5 | Enforce secret/file boundary: Integration-only Vault resolution, no raw material in Studio/worker/log/audit, shared durable FileAsset path | W2 | secret-canary scan, scope tests and storage/restart tests |
| W6 | Complete journal linkage: AuditEvent, UsageEvent, credential versions, jobs, AgentTraceEvent, ingestion lineage and correlation fields | W3,W4 | activity projection fixture links action → mutation → job → trace without redaction failures |
| W7 | Run full verification: focused unit/integration, concurrency, build, E2E and governance | W3-W6 | non-zero tests, build, E2E with no flaky pass, `npm run govern` green |
| W8 | Staging canary with two API instances and two workers, controlled restart and rollback rehearsal | W7 | immutable image, health, job/receipt evidence and rollback artifact |
| W9 | Production activation only by owner/operator gate | W8 | exact SHA/image/digest, migration/backup/rollback evidence and real LINE canary |

## W1 inventory result — 2026-09-23

The source inventory covered the LINE worker route, the supervised worker script,
conversation admission/reconciliation, conversation jobs, rich-menu jobs, the
transport-health reader and the Integration secret boundary.

- Conversation and rich-menu execution already use durable rows, compare-and-set
  versions, leases, idempotency/receipt fields and truthful `UNKNOWN` outcomes.
- `serverLinePorts()` resolves credentials and transports per request; no
  reusable provider secret is held by the Studio domain.
- `probeCache` and the supervised script's cadence variables are disposable
  performance/wake-up hints; losing them changes latency or probe frequency, not
  authorization or business state.
- The non-compliant authority was the worker route's module-level
  `lastHealthSweepAt`. It made the hourly schedule replica-local and vanished on
  restart. RCA: `.brain/rca/2026-09-23-line-oa-process-local-health-schedule.md`.

The first implementation slice adds `LineOaWorkerCheckpoint` and a durable
compare-and-set lease for `TRANSPORT_HEALTH`. The route remains a wake-up hint;
the database checkpoint owns due-time and recovery.

## Implementation constraints

1. Preserve `LineOaAccount` and Studio-owned models as the domain authority.
2. Do not let `line-runtime` write Identity, Integration or CRM tables directly;
   use the approved contract for each write.
3. Do not put Channel ID/Secret, model key, bearer header or Vault plaintext in
   `LineOaTransportJob`, `AgentTraceEvent`, `AuditEvent`, logs or API responses.
4. Keep job payloads data-only and scope-bound. Client, prompt, model and flow
   input may attenuate scope but never widen it.
5. Use a durable database lease for work ownership. A process id is evidence of
   the claimant, not the source of truth.
6. Make shutdown and retry states visible. `UNKNOWN`, `SENDING`, expired and
   failed work must not be silently treated as delivered.
7. Treat a cache as disposable. A cache loss may add latency, never change the
   selected Business, credential version or authorization result.
8. Do not rewrite historical rows when changing worker topology.

## Required test matrix

| Area | Required proof |
|---|---|
| API restart | request can resume or returns a durable, truthful state after instance replacement |
| Worker restart | leased job becomes reclaimable without a second external send |
| Concurrency | two workers cannot own one live lease; duplicate completion is idempotent |
| Webhook | duplicate/retry event has one durable admission and one reply intent |
| Scope | tenant/business/account mismatch fails closed at the database/application boundary |
| Credential | wrong/revoked/expired credential never falls through to another credential or store |
| Secret hygiene | test secret absent from Prisma, response, log, audit, backup and error output |
| Journals | action/session/mutation/job/trace correlation is queryable and redacted |
| File assets | worker restart does not depend on a container-local file |
| UI | Studio can reload from DB after API replacement with no client-held authority |
| Regression | CRM, Integration, Identity and current server-only LINE behavior remain green |

## Rollout and rollback

Roll out in this order:

1. deploy contract-compatible code while the existing worker is still the only
   claimant;
2. enable the stateless worker with bounded concurrency and observe lease/receipt
   metrics;
3. run a controlled restart canary on one Business/account;
4. expand only after no duplicate send, lost job or scope/secret violation is
   observed;
5. retain the previous immutable image and worker configuration for rollback.

Rollback disables new claims first, preserves or reconciles `SENDING`/`UNKNOWN`
work, then restores the prior worker/API image. It does not delete durable jobs,
audit rows, credential versions or raw evidence.

## Stop conditions

Stop and return to design review if:

- a route or worker needs direct access to another domain's tables;
- any secret material appears in a persistent row, response, log or journal;
- a retry can create a second LINE send without an idempotency proof;
- lease expiry can cause two active claimants;
- local disk or in-memory state is required for correctness;
- production evidence is inferred from local, CI or fixture evidence;
- the change requires changing ADR-100's server-only LINE execution without a
  separate approved decision.

## Out of scope

- splitting the entire LINE OA Studio into a separate repository;
- moving Studio tables into a new database in this phase;
- changing MSP/GKS ownership or contracts;
- changing LINE channel onboarding or model-provider validation semantics;
- replacing CRM's conversation authority;
- deleting legacy Edge extraction/pairing capabilities unrelated to LINE
  conversation execution;
- production deployment without a separate owner/operator gate.

## Current status

| Gate | Status | Evidence |
|---|---|---|
| Architecture proposal | APPROVED | ADR-105 v0.2.0b; owner instruction `approve` |
| SRS amendment | APPROVED | SRS v0.6.0b |
| W1 inventory | COMPLETE | source inventory + RCA + focused scheduler tests |
| Code implementation | IN PROGRESS | W1 durable health-sweep checkpoint slice complete; W2-W6 remain |
| Focused tests | PASS | 7/7 focused tests; 10 LINE regression files / 109 tests |
| Full Vitest | PARTIAL | Direct run: 795 suites passed, 4 unrelated suites failed (7 tests); 6,689 passed, 32 skipped |
| Build | PASS | `npm run build` from `apps/server` |
| E2E | NOT RUN | separate W7 gate |
| Governance | PASS | `npm run govern`: critical 0, warning 2 |
| Staging canary | NOT RUN | external gate |
| Production activation | NOT RUN | owner/operator gate |

## CHANGELOG

| Version | Date | Status | Summary | Commit Hash | Agent |
|---|---|---|---|---|---|
| 0.1.0b | 2026-09-23 | candidate | Initial C-3 implementation plan for stateless API/worker execution over durable LINE OA Studio state | uncommitted | RWANG |
| 0.2.1b | 2026-09-23 | in-progress | Approved W1 implementation: durable transport-health checkpoint, focused/regression evidence, build and governance status recorded; W2-W9 remain gated | uncommitted | RWANG |
