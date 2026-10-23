---
id: ZAI:GENESISRAG17-OPERATIONS
doc_type: runbook
status: active
version: "0.1.0"
date: "2026-10-23"
relations:
  - type: relates_to
    target: ZAI:GENESISRAG17-OWNERSHIP-RELIABILITY-DESIGN
  - type: relates_to
    target: ZAI:ADR-073
---

# GenesisRAG17 operations and qualification

## Ownership and authority

Knowledge owns Zuri's user-facing ingestion-to-serving capability. The user is
sole product owner, developer and operator; no additional team or staffed backup
is declared. Use the installation's existing release/operations record for its
reachable contact, access recovery and handoff. Keep credentials outside this
repository. A system/service can own a technical decision; it cannot replace
the operator responsible for resolving an incident.

GKS owns canonical knowledge and the quality gate. MSP owns trusted relay.
GenesisBlock worker owns physical writes and publication. Zuri owns admission,
current authorization, lineage, execution tracking and corpus membership. During
an unknown-boundary failure the capability owner coordinates investigation;
component authority does not move to whichever tier is easiest to access.

## Process-local status and infrastructure retries

The source worker and admission runtime expose `getStatus()` on the existing
in-process factory result. This is an internal diagnostic API, not a new public
route or authorization surface. Status contains `active`, `running`,
`consecutiveFailures`, `retryBudgetExhausted`, `nextRunAt`, `lastStartedAt`,
`lastFinishedAt` and `lastOutcome`. Timestamps are epoch milliseconds; unknown
timestamps are null. A successful pass does not certify publication or prove
every queued job succeeded: inspect durable run/stage/receipt evidence.

Default scheduling is a 1,000 ms normal interval and a 60,000 ms maximum retry
interval, with a five-failure burst budget. Before exhaustion the ceiling grows
exponentially from the normal interval. Equal jitter selects a delay between
half that ceiling and the ceiling. At/after exhaustion, retries continue at the
maximum interval's jittered cooldown frequency; durable work is not abandoned.
A successful pass resets the process failure count. Explicit factory options
can change the interval, ceiling and burst budget within valid timer bounds.

This budget applies to infrastructure failures escaping a process pass and
handled transient admission failures reported by its `retryableFailures`
count. Such a pass resolves normally for manual callers while status reports
`RETRY_PENDING`; the background loop still backs off. Permanent domain
rejections do not contribute to that count. Existing per-job classification
remains on the durable admission/attempt path; this is not a per-record retry limit.
It resets on restart. The wire, durable batch key, scope and current attempt
remain unchanged during a transport retry.

Background errors emit only a fixed safe diagnostic:
`KNOWLEDGE_WORKER_RETRY` or `KNOWLEDGE_WORKER_RETRY_BUDGET`, a generic message,
failure count, exhaustion flag and next delay. Do not attach raw documents,
external error messages or credentials in an observer. Observer throws and
rejected promises are contained; alert-delivery success is not implied.

`runOnce()` remains an authorized manual pass that returns its existing result
or original error. Concurrent callers share one in-flight pass. `start()` is
idempotent; `stop()` disables automatic scheduling and drains current work.
The installed service's normal restart procedure recreates the runtime and
resumes durable state. No new OS scheduler or production restart is authorized
by reading this procedure.

## Investigation and recovery

1. Identify the actual installation/app/database pair and current release.
   Read only its existing health/status and exact source/run/stage/attempt
   identities. Separate current observation from historical deployment records.
2. Check which boundary last made durable progress: admission/source derivation,
   MSP submission, GKS decision, worker physical receipt, quality verdict,
   publication receipt, evidence import or corpus generation.
3. For lost submit replies, retry the exact persisted batch/key/attempt through
   MSP. Never create a replay attempt merely because the acknowledgement was lost.
4. For a worker crash, reconcile its existing candidate generation, checkpoint
   and durable receipts through its accepted procedure. Continue serving the old
   valid generation until the new publication is verified.
5. For a lost publication acknowledgement, recover the same receipt and finish
   evidence/corpus reconciliation. Do not blindly republish or edit the pointer.
6. Treat scope/hash/identity/receipt mismatches as integrity incidents. Stop the
   affected promotion; preserve evidence and current valid serving state. Do not
   skip invalid evidence or advance its cursor by hand.
7. Recheck current source/citation ACL after revocation or deletion, including
   late query responses. A previously valid snapshot is not continuing access.

Infrastructure cooldown is not permission to retry permanent domain rejection.
Use the existing failure classification and authorized replay path. Physical
store access, grant changes and data mutation require their existing authority.

## Contract and release qualification

Use [the approved wire contract](../plans/GENESISRAG17-CONTRACT.md), current
provider schemas and the deployment's existing pin manifest. Record all four
source/artifact revisions, wire/profile/parser/chunker/ontology/model versions,
schema/migration compatibility and actual executed checks in normal release
evidence. A shared `genesisrag17.v1` string alone is not compatibility proof.
New external main heads are inspection facts, not automatic deployment upgrades.

Breaking semantics require a separately reviewed contract and explicit in-flight
drain or dual-version support. An additive field can still break strict parsers.
Check both provider and consumer behavior before promotion; do not reinterpret
old receipts under a new profile or roll back across incompatible persisted data.

Existing native qualification command, from repository root:

```powershell
npm run test:genesisrag17
```

It requires explicit isolated absolute `KI17_MSP_ROOT`, `KI17_GKS_ROOT`,
`KI17_GENESIS_ROOT` and `KI17_MODEL_DIR`. The runner clears ambient database/
service variables, provisions isolated test state and refuses missing
prerequisites rather than skipping them. Consult the existing runner and tests
for the exact profile. Never substitute production roots, databases or grants.
Mocks, source inspection, component checks and native acceptance are distinct.

## Indicators and solo-operator handoff

Use the approved design's definitions for ingestion completion, policy outcomes,
freshness, valid query availability/latency and integrity incidents. Measure an
admitted source version once for user success while retaining every attempt and
retry for diagnostics. Count overdue unfinished work and dependency failures;
do not inflate success with retries or hide service errors as policy rejection.

Collect profile/input-size/load baselines before setting numeric SLOs. Preserve
the existing publication-quality thresholds independently of later reliability
targets. Alerts need a reachable operator and an executable recovery procedure.
Until measured, numeric SLOs and live health remain unqualified.

For solo operation, document the current owner/contact, how to recover operator
access, where backup/restore evidence lives, compatible rollback steps and which
operations require a deliberate maintenance window. Explicitly record no staffed
backup; a recovery document or AI session is not an independent operator.

## Version diff

0.1.0: adopts approved capability accountability and documents bounded local
scheduling/recovery. No deployment, new wire, authority transfer or live SLO
acceptance is established by this runbook.
