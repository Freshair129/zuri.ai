---
id: ZAI:ADR-067
version: "1.0.0"
status: accepted
created_at: "2026-09-07T00:00:00+07:00,Claude Fable 5.1"
last_update: "2026-09-07T00:00:00+07:00,Claude Fable 5.1"
attributes:
  domain: knowledge
  doc_type: architecture-decision
  scope: "who may report Stages 9–17 onto the FR-071 ledger, how a report is identified and timed, how a knowledge ingestion run closes, and how its §5 job state is derived"
relations:
  - type: relates_to
    target: ZAI:ADR-043
  - type: relates_to
    target: ZAI:ADR-046
  - type: relates_to
    target: ZAI:ADR-047
  - type: relates_to
    target: ZAI:ADR-050
  - type: relates_to
    target: ZAI:ADR-063
---

# ADR-067 — The knowledge ingestion reporter: the SoT data-plane key authenticates Stages 9–17 onto the FR-071 ledger, and a run closes only from what was reported

**Status:** Accepted by owner decision, 2026-09-07 (D1 chosen from three options put to the owner: reuse `SotDataPlaneKey`, a new key type, or defer the route).
**Date:** 2026-09-07
**Decided by:** Boss (D1), Claude Fable 5.1 (D2–D5, design)
**Relates to:** [ADR-043](ADR-043-FOUR-TIER-COGNITIVE-ARCHITECTURE.md), [ADR-046](ADR-046-SOT-PIPELINE-INTERIM-SERVING-AND-PULLED-DECISIONS.md), [ADR-047](ADR-047-SOT-DATA-PLANE-SERVICE-ACCOUNT-KEY.md), [ADR-050](ADR-050-KNOWLEDGE-INGESTION-TIER-BOUNDARY.md), [ADR-063](ADR-063-RETIRE-TIER1-GENESISBLOCKDB-DIRECT-CLIENTS.md)
**Touches:** FR-109 (AC-109.11, AC-109.12), FR-110 (AC-110.4), FR-102, NFR-020, BR-022, `docs/domains/knowledge/CHARTER.md`, `docs/domains/integration/CHARTER.md`.

**Numbering.** ADR-065 and ADR-066 are claimed by the Commerce and Procurement lanes (PRs #268 and #272, not yet on `main`). This decision takes 067 rather than the next free number on `main` so that neither lane renumbers on merge — the same rule ids follow everywhere else here: never reuse, never move.

## Context

ADR-050 D2 assigns Stages 9–17 of the knowledge ingestion pipeline to GKS (Tier 3) and GenesisBlockDB (Tier 4), and D3 obliges them to report their evidence onto this repository's FR-071 ledger. FR-110's KNO-01 slice (2026-08-31) gave that evidence a strict shape — `zKnowledgeStageReport`, the Stage 17 decision, the snapshot allow-list — and `recordPipelineEvent` learned to bind a Stage 17 gate to its run. What nothing built was a way for the evidence to *arrive*:

- `recordPipelineEvent` and `createPipelineRun` admitted an installation operator and no one else. GKS and GenesisBlockDB have no Person, no session and no operator grant, and giving them one was the exact thing ADR-047 refused for the SoT connector ("a leaked connector credential with that grant could do far more … the blast radius would be the entire installation").
- Every knowledge run stayed `RUNNING` forever. `ingestKnowledgeDocument` writes seven of seventeen stages and, correctly, never sends `RUN_FINISHED` for a run it cannot see the end of; no caller was entitled to send it later.
- FR-109's §5 job lifecycle (AC-109.11) had no derivation — nine states declared, none computable.

Meanwhile the external side had moved (verified 2026-09-07 against the three repositories named in ADR-063 D3): GKS shipped Stage 9 with a completion report addressed to this ledger, accepted its own `ADR-GKS-LEDGER-REPORTING` "before any code exists", and then went quiet; MSP recorded that it owns no stage; GenesisBlockDB is packaging SDKs. Two sides were waiting on each other. This decision removes the half of the wait that belongs here, and it resolves the one item `docs/roadmap/PLAN-PENDING-KNOWLEDGE-20260831.md` marked as needing security approval — its D2, "external reporter auth".

## Decision

### D1 — The reporter authenticates with the FR-102 `SotDataPlaneKey`, Tenant-bound, on a knowledge run of its own Tenant only

The owner chose reuse over a new credential type. The key already has the properties the reporter needs and ADR-047 already argued for: high-entropy secret stored only as a SHA-256 lookup hash, bound to exactly one Tenant, revoked with no grace period, minted by an operator command, and — decisively — **not** an installation operator. `isSotDataPlaneFor(viewer, tenantId)` stays its own predicate; `isInstallationOperator` is untouched.

This widens ADR-047 D3 by pointer rather than rewrite. That decision said the key "authenticates only the two verbs FR-100 actually names as the data plane's"; it now also authenticates the four verbs of the knowledge reporter surface, and ADR-047 carries a one-line pointer here. What the key may write is stated in the writer, `recordPipelineEvent`, not only in the receiver that calls it:

| A data-plane key may | A data-plane key may not |
|---|---|
| write `STEP_STARTED` / `STEP_HEARTBEAT` / `STEP_SUCCEEDED` / `STEP_FAILED` for one of the eight external stage ids (`DPS-KI-ENTITY-RESOLVE` … `DPS-KI-INDEX`) or `DPS-KI-QUALITY-GATE` | write any event naming a Tier 1 stage id (`DPS-KI-INGEST` … `DPS-KI-ENTITY-EXTRACT`) — refused 403, ADR-050 D3 |
| write `GATE_UPDATED` for Stage 17 and `RUN_FINISHED` | write a record event (`RECORD_*`) — Tier 1's `docId`-bound disposition is not a reporter verb |
| read the knowledge run it reports onto (`getPipelineMonitor`), because the step and attempt identities it must echo exist nowhere else | `createPipelineRun`, `requestPipelineReplay`, or any event onto a run of another definition (`DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1`, `DPL-ASSET-REGISTER-IMPORT-V1`) — refused 403 |
| — | reach a run of another Tenant: 403 on write, 404 on read, the same refusal shapes every other Tenant boundary here uses |

Audit rows written under a key carry `actorType: 'PIPELINE_REPORTER'` and the key's `serviceAccountId`; an operator's rows keep `PIPELINE_OPERATOR` and the principal id. The distinction is recorded, not inferred later from the absence of a person.

The generic `POST /api/pipelines/runs/{id}/events` route never resolves a bearer key (it resolves the session only), so the widened writer rule is reachable solely through the receiver functions below and the four routes that front them.

### D2 — A report is identified by run + stage + attempt + outcome, timed by when the stage ran, and names the materialised step

- **Identity.** The receiver derives every event's `idempotencyKey` from `executionRunId`, `pipelineStageId`, `attemptId` and the outcome (`started` / `succeeded` / `failed` / `gate`). The same report replays as `UNCHANGED`; a *different* report under the same attempt — other counters, the other outcome — is refused by the ledger's own receipt-hash check (409, "reused with different input"). This is KNO-02's "conflicting retry detection" as an existing constraint rather than new code. A reporter that genuinely re-ran a stage has a new attempt, and a new attempt is an FR-071 replay an operator requests; a reporter mints neither steps nor attempts.
- **Step identity.** A report names the step `createPipelineRun` materialised for its stage — `executionStepId`, `pipelineStageId` and `attemptId` must all agree with the row (409 otherwise). The writer gained the one check it lacked: a step looked up by id must belong to the stage the event names. Before this, an event could name Stage 9's step id under Stage 15's stage id and pass the envelope, the attempt check and the run check.
- **Time.** `startedAt` and `finishedAt` are required on every report and on the Stage 17 decision, `finishedAt ≥ startedAt`. Each ledger write is timed from them, so `PipelineStep.startedAt/finishedAt` and the monitor's `durationMs` describe the execution, not the network. The cost is stated: the run's `updatedAt`/`lastHeartbeatAt` follow the same clock, so a late report of an old execution does not refresh the run's liveness — which is accurate, and which is exactly why D4 does not read liveness.
- **Outcome.** `outcome: SUCCEEDED | FAILED` with `failure: { failureCode, errorRef, retryable } | null`, refined together: a failed stage carries BR-022's envelope and a succeeded one carries none. The raw error message is not a member — the ledger is redacted (SDD-073) — and a reporter that wants it kept keeps it in its own tier.

### D3 — A run closes only from the ledger; the close request carries no status

`finishKnowledgeIngestionRun` takes the run and its scope and derives the terminal status from the step board and the gate decisions (`knowledgeRunOutcome`, a pure function in the knowledge lane):

- any failed stage among 2–17, or a `REJECTED` gate → `FAILED`, with `failureCode` naming the stage or the verdict; other stages may be unreported — nothing after a failure changes the outcome;
- every executed stage 2–17 `SUCCEEDED` and an `APPROVED` gate whose verdict is `PASS` or `PASS_WITH_WARNINGS` → `SUCCEEDED`;
- anything else → refused, 409, with the list of what is still owed (`STAGE_NOT_SUCCEEDED:<id>`, `GATE_MISSING`, `GATE_PENDING`, `GATE_WAIVED_IS_NOT_A_VERDICT`).

Three consequences the rule fixes rather than leaves to interpretation. **Stage 1 is out of band**: its step row stays `NOT_STARTED` on every run this repository has written, because FR-081 delivered the artifact before the run existed and the run's own `artifactRef` is its evidence; a finalizer that read that row as "Stage 1 never ran" would block every close for a stage that cannot fail. **`WAIVED` is not a verdict**: FR-110 §23 names four results and a waiver is none of them, so a waived gate does not close a knowledge run — an operator who wants a run closed without publication can reject the gate. **A quarantined document's run can finally close**: FR-119 left it `RUNNING` forever; an operator may now close it `FAILED` with the failing stage named. A run already terminal returns `UNCHANGED` without writing.

### D4 — The §5 job state is a projection over ledger facts with no clock

`knowledgeJobState({ ledgerStatus, stages, gates })` derives FR-109's nine states from the run's *stored* status, the step board and the newest Stage 17 decision. It takes no `now`, no freshness and no heartbeat: the monitor's `UNKNOWN` (a stale-heartbeat verdict, ADR-030) is reported beside it and never feeds it. `PUBLISHED` therefore has exactly one derivation — run `SUCCEEDED` behind an `APPROVED` gate with a publishable verdict — which is what AC-109.11 asks. Precedence is the more specific fact first: a failed stage over the gate, the gate over the run status, the run status over the stage board; a Tier 1 failure is `QUARANTINED` (BR-022), an external failure is `RETRYABLE_FAILED` or `QUARANTINED` by its own `retryable` flag, a `QUARANTINE` verdict is `QUARANTINED` and a `FAIL` verdict is `REJECTED`. A run an operator closed `SUCCEEDED` with no approved gate reads `VALIDATING` with the reason named — the corpus was never gated, so it was never published, whatever the run row says. `SUPERSEDED` is declared and never emitted: nothing yet acts on a `REVISION_OF` result (AC-109.13), and a state the function cannot derive is not one it invents.

### D5 — Four of NFR-020's six per-stage metrics land on the ledger; the two that do not are named, not dropped

`records_in` → `actualCount`, `records_out` → `insertedCount`, `records_failed` → `failedCount`, and `processing_time` is recoverable from the step's own timestamps (D2). `records_quarantined` and `retry_count` have no `PipelineStep` column and ADR-050 D4 declines a new model or column for this work; both are validated, hashed into the step's `outputHash` with the rest of the metrics, returned to the reporter, and listed under `declined` on every response. This is the same standing the Tier 1 path has had since SDD-070, now stated in one place. Adding the two columns is a schema change with a Supabase migration and is not decided here.

## Consequences

- The zuri-ai side of `PLAN-PENDING-KNOWLEDGE-20260831.md` KNO-02 (reporter contract, finalization) is delivered, and KNO-01's envelopes gained `outcome`, `failure`, `startedAt`, `finishedAt`. KNO-03 (atomic publication) remains GKS/GenesisBlockDB's, unchanged.
- FR-109 AC-109.11 closes; AC-109.12 has its zuri-ai half — the receiver exists and Tier 1 stages are refused from outside — and still waits on GKS and GenesisBlockDB actually reporting, which is ADR-050 D3 and not a gap here. AC-109.6 is unchanged: the seven Tier 1 stages and, once reported, the nine external ones carry four of six metrics.
- FR-110 AC-110.4 closes. AC-110.1–.3 and .5–.10 remain external or later (publication, retrieval, GraphRAG readiness).
- The routes are `GET /api/pipelines/knowledge/{executionRunId}` and `POST …/stages`, `…/gate`, `…/finish`, each trying the bearer key first and falling through to the session exactly as ADR-047 D3 describes. Handing GKS a key is `scripts/mint-sot-data-plane-key.mjs`, an operator command, and is not performed by this change.
- ADR-047's "two routes" consequence is widened to six; its text is a dated record and gains one pointer line rather than a rewrite (the ADR-063 precedent).
- A reviewer can read the writer's rule in one place (`requireLedgerWriterForRun`) and expect the receiver tests to fail if it loosens: a Tier 1 stage id, a record event, a run of another definition and a run of another Tenant are each refused under a real key resolved through the real bearer resolver.

## CHANGELOG

| Version | Date | Status | Summary | Agent |
|---|---|---|---|---|
| 1.0.0 | 2026-09-07 | accepted | Reporter credential (owner-chosen: reuse `SotDataPlaneKey`), report identity/time/outcome, derived run close, clockless job-state projection, four-of-six metrics named | Claude Fable 5.1 |
