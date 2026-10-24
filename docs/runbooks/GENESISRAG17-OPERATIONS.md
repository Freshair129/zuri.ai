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

## Nightly MSP session-content retention

The [retention implementation plan](../plans/MSP-RETENTION-SCHEDULER-20261024.md)
closes the API-011 invocation gap under ZAI:FR-230 and ZAI:SEC-031. MSP owns
tombstones and its journal; Agent owns the signed maintenance caller. This is
separate from CRM's existing retention task and from enabling conversational
memory. A successful nightly session sweep does not establish legacy API-009
vault/passport TTL, raw LINE or execution-trace retention.

Use a qualified KI17 overlay built by
`apps/server/scripts/build-ki17-overlay-release.mjs`; it carries
`org.opencontainers.image.revision`. An unlabeled ordinary Docker build is
deliberately refused by this scheduler. Qualify the exact candidate before
changing a target file or replacing an image.

1. In protected, untracked deployment configuration, provide a separate
   `ZURI_MSP_RETENTION_SWEEP_TOKEN` (at least 32 random characters),
   `ZURI_MSP_RETENTION_TENANTS` (JSON object mapping exactly one Tenant UUID to
   its Workspace UUID), and positive `MSP_THREAD_RETENTION_DAYS`. This must match
   the normal LINE singleton Workspace/service key; multiple Tenants are refused.
   The web already needs the matching Tenant entry in
   `MSP_THREAD_SERVICE_KEYRING`, identity keys and persistent MSP state. Bind
   maintenance configuration to web only. Never copy keys to the host task,
   LINE poller or Genesis worker. Memory flags may remain OFF.
2. Validate Workspace and Business ancestry, keyring and database scope. The
   effective horizon is the shortest of 90 days, the deployment setting and
   the Tenant's `MSP_SESSION_CONTENT` override. The child receives that setting
   per Tenant; no wire-schema change or caller-supplied clock is accepted.
3. On the qualified artifact, run `node scripts/server-msp-retention-worker.mjs
   --dry-run` inside the web container. Dry-run writes audit/journal counts but
   no content tombstones. Verify the response and actual audit. Then run once
   without the switch against approved data. Never use production as a fixture.
4. Store a protected target JSON with `SchemaVersion: 1`, `Project`,
   `ContainerName`, full `AppRevision`, exact `StateVolume`, `DatabaseName`,
   `DatabasePoolMode`, `DatabaseIdentityHash`, `TenantScopeHash`, and `ScriptSha256`. The three
   hashes are SHA-256 of the exact raw selected PostgreSQL environment value,
   exact `ZURI_MSP_RETENTION_TENANTS` value, and reviewed host action bytes.
   Compute in memory without printing connection strings or tokens. The DB
   digest binds configured host, port, database, options and credential identity;
   the revision binds `resolvePostgresUrl` normalization (including pooler mode).
   A value with different bytes is refused even if it would normalize equally. Rotation
   requires requalification and a target update. Volume is the named
   `<Project>_ki17-state` mounted at `/var/lib/zuri-ki17/state`.
5. Copy the reviewed `invoke-msp-retention-task.ps1` and registration script
   to a protected stable release location. Use the installed PowerShell 7
   (`pwsh`); Windows PowerShell's default policy can refuse script files. No
   machine-wide execution policy change is needed. Run registration with `-WhatIf`,
   then register using `-TargetFile`, `-ActionScript`, and a unique `-TaskName`.
   The script refuses replacing an existing task. No credential is placed in
   the scheduled command. Check timezone before retaining the 03:00 default;
   this machine uses SE Asia Standard Time (Asia/Bangkok).
6. Invoke the task once, check `LastTaskResult`, actual `MSP_RETENTION_*`
   audits, provider counts and `NextRunTime`. The task uses Interactive logon:
   the operator must be logged in and Docker available. `StartWhenAvailable`
   catches a missed run; `IgnoreNew` avoids overlapping host instances. This
   is not a claim that an offline/logged-out machine runs maintenance.

The normal database fence blocks new LINE admissions and updates during each bounded
Tenant pass. Any nonterminal/unknown LINE status or unsettled memory delivery
defers the whole Tenant. The PostgreSQL fence also prevents a Tenant retention
override changing mid-pass. Windows retries once after five minutes; persistent
DEFERRED, PARTIAL or UNKNOWN results require operator attention, never a green
retention assertion. Each provider batch is bounded to 200 rows per table,
up to ten calls and a 75-second run budget. UNKNOWN means external effects may
have committed; STARTED audit survives rollback and counts are acknowledgements,
not proof of reversal. Inspect persisted receipts before retrying with fresh
nonces. No customer content or raw provider errors belong in task logs.
Validated per-Tenant outcome labels and run IDs are appended to
`msp-retention-runs.jsonl` beside the protected target file. Actual counts remain
in the correlated immutable audit events. DB session loss can release its lock;
the separately committed STARTED gate then denies affected MSP thread calls,
including on a new process or a failed gate lookup. CRM ingress need not stop.

The production fence uses its own PostgreSQL connection; an HTTP timeout never
releases it while an MSP PID's exit remains unconfirmed. A one-second SIGTERM
grace escalates to SIGKILL and waits for actual exit. If that exceptional wait
does not settle, stop the affected web container and its dependent workers in a
deliberate maintenance window, confirming all contained PIDs have ended before
recovery. Do not terminate just the fence's database session to unblock traffic.
FAILED means no provider call was attempted; UNKNOWN requires reconciliation.

### Recover an unsettled STARTED

A later sweep never clears an unrelated STARTED. In a deliberate maintenance
window, stop the exact old web container and its dependent workers and retain
the stopped container for inspection. Prepare a qualified replacement web with
memory still OFF. Generate an Ed25519 recovery keypair in protected host storage;
only the base64 SPKI public PEM goes to web as
`ZURI_MSP_RETENTION_RECOVERY_PUBLIC_KEY`, alongside
`ZURI_MSP_RETENTION_PROJECT` and full `ZURI_MSP_RETENTION_APP_REVISION`.
Never mount the private key or host signing helper into web.

The protected target also records `ReconcileScriptSha256`,
`RecoverySignerScript`, `RecoverySignerScriptSha256` and
`RecoveryPrivateKeyFile`. Keep the private-key ACL limited to the operator,
SYSTEM and Administrators. Invoke the reviewed host
`scripts/reconcile-msp-retention-task.ps1` with `-TargetFile`, `-ActionScript`,
the exact audit `-RunId` and full `-StoppedContainerId`; use `-WhatIf` first.
It validates the current target and inspects the old exact container ID,
project/service, volume, `Running=false` and `Pid=0` before signing a 60-second
proof with issue/expiry time and nonce. Only proof bytes reach the replacement.
Web verifies the public signature, current/old container identity, environment,
Tenant/run and persisted STARTED origin, then uses `recordAudit` to append an
idempotent RECONCILED event. The ordinary sweep bearer cannot forge this proof.
Inspect that audit and rerun maintenance before enabling memory; recovery does
not invent counts for the interrupted provider operation. No manual SQL update
or deletion of audit history is part of this procedure.

For rollback, disable this exact task and restore the qualified image/config
with memory OFF. Do not reverse provider tombstones or replace the state volume.
Backup recovery must reapply due retention before making recovered content
available. Keep task registration, artifact checks and actual runtime results
separate from source/test evidence.

## Version diff (retention follow-up)

2026-10-24: documents the owner-requested signed maintenance caller, strict
deployment target and scheduler qualification. Production memory activation and
real LINE UAT remain separate gates.

0.1.0: adopts approved capability accountability and documents bounded local
scheduling/recovery. No deployment, new wire, authority transfer or live SLO
acceptance is established by this runbook.
