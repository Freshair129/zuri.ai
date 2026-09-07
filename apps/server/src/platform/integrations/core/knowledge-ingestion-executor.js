import prisma from '@/lib/db'
import { isInstallationOperator, isSotDataPlaneFor } from '@/modules/identity/viewer-authority'
import {
  knowledgeIngestionRunInput,
  knowledgeJobState,
  knowledgeRunOutcome,
} from '@/modules/knowledge/ingestion-job'
import {
  parseKnowledgeRunFinish,
  parseKnowledgeStage17Decision,
  parseKnowledgeStageReport,
  toKnowledgeStage17Evidence,
} from '@/modules/knowledge/published-snapshot-contract'
import { runKnowledgeIngestionStagesWithTrace } from '@/modules/knowledge/stage-runner'
import { buildQuarantineEnvelope } from '@/modules/knowledge/quarantine'
import { ingestionIdentity } from '@/modules/knowledge/dedup'
import {
  IDENTITY_REFS_EMPTY,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
  KNOWLEDGE_QUALITY_GATE_STAGE_ID,
  hashContractPayload,
} from './pipeline-tracking-contract'
import { createPipelineRun, getPipelineMonitor, recordPipelineEvent } from './pipeline-tracking-service'

// @req FR-109 — the ledger-writing wiring: something calls FR-118's stage
// composition and writes its result onto the FR-071 ledger, bound through docId;
// and the monitor half — one `pipeline_job_id` resolves the run, its seventeen
// step identities and its §5 job state (AC-109.11).
// @req FR-110 — the receiver for the stages ADR-050 assigns elsewhere: Stage
// 9–16 aggregate reports, the Stage 17 decision recorded as gate evidence
// (AC-110.4), and the close of a run derived from what was reported.
// @req NFR-020 — real per-stage counts, read from what each stage actually
// produced rather than a uniform placeholder.
// @req FR-119 — a document that fails partway is quarantined with BR-022's
// envelope, not reported as nothing having happened.
// @spec SDD-069, SDD-070, SDD-072, SDD-066, SDD-057, BR-021, BR-022, ADR-050 D4, ADR-067 D1-D5
// @tested tests/integration/fr109-knowledge-ingestion-executor.test.js
// @tested tests/integration/fr119-knowledge-ingestion-quarantine.test.js
// @tested tests/integration/fr110-knowledge-reporter-receiver.test.js

const SHA256_HEX = /^[a-f0-9]{64}$/i

/**
 * The seven Tier 1 stages, in ADR-050 D2 order — the same order FR-118 runs
 * them in — mapped to the envelope field each stage's evidence lives at.
 */
const TIER1_STAGES = [
  ['DPS-KI-PARSE', 'parsed'],
  ['DPS-KI-PROVENANCE', 'provenance'],
  ['DPS-KI-NORMALIZE', 'normalized_fields'],
  ['DPS-KI-CLASSIFY', 'classification'],
  ['DPS-KI-DEDUPE', 'dedup'],
  ['DPS-KI-CHUNK', 'chunks'],
  ['DPS-KI-ENTITY-EXTRACT', 'entity_candidates'],
]

/**
 * NFR-020's per-stage counts (SDD-070) for a stage that SUCCEEDED, read from
 * what it actually produced rather than a uniform "1 in, 1 out".
 *
 * Normalization is the one stage where `records_out` is not equal to
 * `records_in`: FR-114 declines to normalize a value it cannot decide,
 * returning `canonical: null` rather than guessing (SDD-061). That decline is
 * not a failure — it is normalization working exactly as designed — so it
 * counts against `records_out`, never against `records_failed`. It is also
 * the reason `DPS-KI-NORMALIZE` never appears as a *failing* stage below:
 * `normalizeValue` never throws.
 */
function succeededCounts(pipelineStageId, envelope, input) {
  const structuredFields = input.structuredFields || []
  const structuredRecords = input.structuredRecords || []
  switch (pipelineStageId) {
    case 'DPS-KI-NORMALIZE':
      return {
        actualCount: structuredFields.length,
        insertedCount: envelope.normalized_fields.filter((f) => f.canonical !== null).length,
        failedCount: 0,
      }
    case 'DPS-KI-CHUNK':
      return { actualCount: 1, insertedCount: envelope.chunks.length, failedCount: 0 }
    case 'DPS-KI-ENTITY-EXTRACT':
      return {
        actualCount: envelope.chunks.length + structuredRecords.length,
        insertedCount: envelope.entity_candidates.length,
        failedCount: 0,
      }
    default:
      // Parse, provenance, classify and dedupe each transform exactly one
      // document-level object into one document-level result.
      return { actualCount: 1, insertedCount: 1, failedCount: 0 }
  }
}

/**
 * NFR-020's counts for the stage that FAILED (BR-022). The function threw
 * before producing output, so nothing richer than "one attempt, it failed"
 * is knowable — reporting a guessed `records_out` for an operation that
 * never completed would be inventing evidence, not reading it.
 */
const FAILED_COUNTS = Object.freeze({ actualCount: 1, insertedCount: 0, failedCount: 1 })

/**
 * BR-022's `retryable` boolean, derived from `classifyStageFailure`'s
 * three-way classification. A boolean cannot represent three values, so this
 * is a mapping decision (SDD-072): only `RETRYABLE` maps to `true`.
 * `REVIEW_REQUIRED` maps to `false` alongside `NON_RETRYABLE` because
 * `retryable=false` is the accurate half of what it means — a human must act,
 * retrying alone will not — even though the ledger's boolean cannot also
 * carry "needs a human". The full three-way classification is not lost: it
 * travels in the quarantine envelope this function returns, which is a
 * richer channel than the boolean the shared ledger schema offers every
 * pipeline.
 */
function toRetryableFlag(classification) {
  return classification === 'RETRYABLE'
}

/**
 * Registers a knowledge ingestion run and writes the seven Tier 1 stages'
 * evidence onto the FR-071 ledger, using FR-118's composition as the source
 * of what happened.
 *
 * **What this closes.** `docId` — FR-109's identity table calls it "the
 * `PipelineRecordEvent` column that nothing writes today" — is now written,
 * bound to `documentId` on a `RECORD_STARTED`/`RECORD_SUCCEEDED` (or
 * `RECORD_FAILED`) pair spanning the Tier 1 pass. Each stage that runs gets a
 * real `STEP_STARTED`/`STEP_SUCCEEDED` or `STEP_STARTED`/`STEP_FAILED`
 * transition on the `PipelineStep` rows `createPipelineRun` already
 * materializes from `KNOWLEDGE_INGESTION_STAGE_CATALOG`.
 *
 * **A document that fails partway is quarantined, not silently dropped**
 * (FR-119, BR-022). `runKnowledgeIngestionStagesWithTrace` reports exactly
 * which stages succeeded before the failure; this function writes real
 * `STEP_SUCCEEDED` evidence for every one of them — no longer "nothing
 * recorded" the moment anything fails — then `STEP_FAILED` for the stage
 * that threw, carrying BR-022's envelope: a stable `failureCode`, a
 * `retryable` flag, and a redacted `errorRef` (see `buildQuarantineEnvelope`
 * for why the raw message is not there). The full envelope, including the
 * raw `error_message`, is returned to this function's own caller — never
 * written onto the ledger's redacted fields.
 *
 * **What it still does not close.** The run is never marked finished. Nine
 * of the seventeen catalog steps (Stages 9-17) belong to GKS and
 * GenesisBlockDB (ADR-050 D3) and this repository does not execute them —
 * sending `RUN_FINISHED` here would claim a run is done that is, from what
 * this repository can see, at most seven-seventeenths done. The run stays
 * `RUNNING` and that is accurate, not incomplete.
 *
 * **Resumable by construction, not by a retry branch.** Every event's
 * `idempotencyKey` is derived from the BR-021 identity plus a fixed suffix,
 * so calling this function twice with the same artifact replays already
 * -written events as `UNCHANGED` (FR-071's own idempotency) and only
 * advances whatever did not yet happen. No special-casing for "already
 * ingested" is needed here because FR-071 already provides it.
 */
export async function ingestKnowledgeDocument(input, {
  db = prisma,
  viewer,
  now = () => new Date(),
  idFactory,
} = {}) {
  const { documentId, artifact } = input
  if (!documentId) throw new Error('ingestKnowledgeDocument requires documentId')

  // Throws on an incomplete artifact before any write — the same refusal
  // FR-117's own identity computation makes, reached here first on purpose.
  const identity = ingestionIdentity(artifact)
  const correlationId = `ki:${identity}`

  const runInput = knowledgeIngestionRunInput(artifact)
  const runOptions = { db, viewer, now, ...(idFactory ? { idFactory } : {}) }
  const runResult = await createPipelineRun(runInput, runOptions)

  const runRow = await db.pipelineRun.findUnique({
    where: { executionRunId: runResult.run.executionRunId },
    select: { id: true },
  })
  const steps = await db.pipelineStep.findMany({ where: { runId: runRow.id } })
  const stepByStage = Object.fromEntries(steps.map((step) => [step.pipelineStageId, step]))

  // Computed once, pure. Never throws itself — a stage's error is reported
  // in `trace.error`, not propagated, exactly so this function can go on to
  // write what DID succeed before writing the quarantine envelope for what
  // did not.
  const trace = runKnowledgeIngestionStagesWithTrace(input)

  const sourceSha256 = SHA256_HEX.test(String(artifact.content_hash)) ? String(artifact.content_hash) : null
  const firstStage = stepByStage[TIER1_STAGES[0][0]]

  const eventBase = {
    dataPipelineDefinitionId: runInput.dataPipelineDefinitionId,
    executionContractId: runInput.executionContractId,
    executionRunId: runResult.run.executionRunId,
    correlationId,
    sourceSha256,
    tagIds: [],
    identityRefs: { ...IDENTITY_REFS_EMPTY },
    failureCode: null,
    errorRef: null,
    retryable: null,
    reconciliation: null,
    gate: null,
  }

  await recordPipelineEvent({
    ...eventBase,
    eventType: 'RECORD_STARTED',
    pipelineStageId: null,
    executionStepId: null,
    attemptId: firstStage.attemptId,
    pipelineRecordId: documentId,
    sourceRecordKey: null,
    sourceRowNumber: null,
    docId: documentId,
    picId: null,
    factId: null,
    sourceDocIds: [],
    sourcePicIds: [],
    destinationRecordId: null,
    sequence: null,
    status: 'RUNNING',
    idempotencyKey: `${identity}:record:started`,
    inputHash: null,
    outputHash: null,
  }, runOptions)

  const envelopeForCounts = trace.success ? trace.envelope : trace.partialEnvelope
  const succeededIds = new Set(trace.stages.filter((s) => s.status === 'SUCCEEDED').map((s) => s.id))

  const stageEvents = []
  let lastStep = firstStage
  for (const [pipelineStageId, resultKey] of TIER1_STAGES) {
    if (!succeededIds.has(pipelineStageId) && pipelineStageId !== trace.failedStage) break // never attempted

    const step = stepByStage[pipelineStageId]
    lastStep = step
    const succeeded = succeededIds.has(pipelineStageId)

    await recordPipelineEvent({
      ...eventBase,
      eventType: 'STEP_STARTED',
      pipelineStageId,
      executionStepId: step.executionStepId,
      attemptId: step.attemptId,
      pipelineRecordId: null,
      sourceRecordKey: null,
      sourceRowNumber: null,
      docId: null,
      picId: null,
      factId: null,
      sourceDocIds: [],
      sourcePicIds: [],
      destinationRecordId: null,
      sequence: step.sequence,
      status: 'RUNNING',
      idempotencyKey: `${identity}:${pipelineStageId}:started`,
      inputHash: null,
      outputHash: null,
    }, runOptions)

    if (succeeded) {
      const stageOutputHash = hashContractPayload(envelopeForCounts[resultKey])
      const stepResult = await recordPipelineEvent({
        ...eventBase,
        eventType: 'STEP_SUCCEEDED',
        pipelineStageId,
        executionStepId: step.executionStepId,
        attemptId: step.attemptId,
        pipelineRecordId: null,
        sourceRecordKey: null,
        sourceRowNumber: null,
        docId: null,
        picId: null,
        factId: null,
        sourceDocIds: [],
        sourcePicIds: [],
        destinationRecordId: null,
        sequence: step.sequence,
        status: 'SUCCEEDED',
        idempotencyKey: `${identity}:${pipelineStageId}:succeeded`,
        inputHash: null,
        outputHash: stageOutputHash,
        ...succeededCounts(pipelineStageId, envelopeForCounts, input),
      }, runOptions)
      stageEvents.push({ pipelineStageId, status: 'SUCCEEDED', ...stepResult })
    } else {
      // The failing stage (FR-119, BR-022). `errorRef` stays redacted per
      // FR-071's own convention (see buildQuarantineEnvelope) — the real
      // message travels only in `quarantine.error_message`, returned below.
      const quarantine = buildQuarantineEnvelope({
        jobId: runResult.run.executionRunId,
        artifactId: artifact.artifact_id,
        pipelineVersion: artifact.pipeline_version,
        traceResult: trace,
        now,
      })
      const stepResult = await recordPipelineEvent({
        ...eventBase,
        eventType: 'STEP_FAILED',
        pipelineStageId,
        executionStepId: step.executionStepId,
        attemptId: step.attemptId,
        pipelineRecordId: null,
        sourceRecordKey: null,
        sourceRowNumber: null,
        docId: null,
        picId: null,
        factId: null,
        sourceDocIds: [],
        sourcePicIds: [],
        destinationRecordId: null,
        sequence: step.sequence,
        status: 'FAILED',
        idempotencyKey: `${identity}:${pipelineStageId}:failed`,
        inputHash: null,
        outputHash: null,
        failureCode: quarantine.error_code,
        errorRef: `ki-quarantine://${identity}/${pipelineStageId}`,
        retryable: toRetryableFlag(quarantine.classification),
        ...FAILED_COUNTS,
      }, runOptions)
      stageEvents.push({ pipelineStageId, status: 'FAILED', ...stepResult })

      const recordFailed = await recordPipelineEvent({
        ...eventBase,
        eventType: 'RECORD_FAILED',
        pipelineStageId: null,
        executionStepId: null,
        attemptId: lastStep.attemptId,
        pipelineRecordId: documentId,
        sourceRecordKey: null,
        sourceRowNumber: null,
        docId: documentId,
        picId: null,
        factId: null,
        sourceDocIds: [],
        sourcePicIds: [],
        destinationRecordId: null,
        sequence: null,
        status: 'FAILED',
        idempotencyKey: `${identity}:record:failed`,
        inputHash: null,
        outputHash: null,
        failureCode: quarantine.error_code,
        errorRef: `ki-quarantine://${identity}/record`,
        retryable: toRetryableFlag(quarantine.classification),
      }, runOptions)

      return {
        run: runResult.run,
        identity,
        stages: stageEvents,
        record: recordFailed,
        quarantine,
        warnings: trace.partialEnvelope.warnings,
      }
    }
  }

  const recordSucceeded = await recordPipelineEvent({
    ...eventBase,
    eventType: 'RECORD_SUCCEEDED',
    pipelineStageId: null,
    executionStepId: null,
    attemptId: lastStep.attemptId,
    pipelineRecordId: documentId,
    sourceRecordKey: null,
    sourceRowNumber: null,
    docId: documentId,
    picId: null,
    factId: null,
    sourceDocIds: [],
    sourcePicIds: [],
    destinationRecordId: null,
    sequence: null,
    status: 'SUCCEEDED',
    idempotencyKey: `${identity}:record:succeeded`,
    inputHash: null,
    outputHash: hashContractPayload({
      chunks: trace.envelope.chunks.length,
      entity_candidates: trace.envelope.entity_candidates.length,
      dedup: trace.envelope.dedup.relationship,
    }),
  }, runOptions)

  return {
    run: runResult.run,
    identity,
    stages: stageEvents,
    record: recordSucceeded,
    quarantine: null,
    warnings: trace.envelope.warnings,
  }
}

// ---------------------------------------------------------------------------
// The receiver — the half of KNO-02 this repository owns (ADR-067).
//
// GKS and GenesisBlockDB execute Stages 9–17 (ADR-050 D2) and owe this ledger
// their evidence (ADR-050 D3). Until this section existed the ledger could
// validate that evidence (FR-110's KNO-01 envelopes) and nothing could receive
// it: `recordPipelineEvent` admitted operators only, and an external tier has
// no Person. Three functions below take a report, a decision and a close; each
// validates the strict FR-110 envelope, resolves the run and the materialised
// step the report names, and writes through `recordPipelineEvent` — the same
// single writer the Tier 1 path uses. Nothing here opens a second write path.
// ---------------------------------------------------------------------------

/**
 * NFR-020's six per-stage metrics against the ledger's columns: four land
 * (`records_in` → `actualCount`, `records_out` → `insertedCount`,
 * `records_failed` → `failedCount`, `processing_time` → the step's own
 * `startedAt`/`finishedAt`, written from the report's times). Two do not —
 * `PipelineStep` has no column for them and ADR-050 D4 declines a new one —
 * so they are validated, hashed into `outputHash`, returned to the reporter,
 * and named here rather than silently dropped (ADR-067 D5).
 */
export const KNOWLEDGE_METRICS_NOT_ON_LEDGER = Object.freeze(['records_quarantined', 'retry_count'])

/** The one gate id every knowledge Stage 17 decision is recorded under. */
export const KNOWLEDGE_QUALITY_GATE_ID = 'GATE-KNOWLEDGE-QUALITY'

function serviceError(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

async function loadKnowledgeRun(db, executionRunId) {
  const run = await db.pipelineRun.findUnique({ where: { executionRunId } })
  if (!run) throw serviceError(404, 'Pipeline run not found')
  if (run.dataPipelineDefinitionId !== KNOWLEDGE_INGESTION_DEFINITION_ID) {
    throw serviceError(409, 'Pipeline run is not a knowledge ingestion run')
  }
  return run
}

// ADR-067 D1 — who may report: an installation operator, or the FR-102
// data-plane key bound to the run's Tenant. The same rule is held by the
// writer (`recordPipelineEvent`); it is repeated here so the refusal names
// this surface and happens before any step lookup leaks a step's existence.
function requireReporter(viewer, run) {
  if (isInstallationOperator(viewer) || isSotDataPlaneFor(viewer, run.tenantId)) return
  throw serviceError(403, 'Knowledge stage reporting requires an installation operator or the data-plane key of this run’s Tenant (ADR-067 D1)')
}

function assertReportScope(scope, run) {
  if (scope.tenantId !== run.tenantId || scope.businessId !== run.businessId) {
    throw serviceError(409, 'Report scope does not match the pipeline run')
  }
}

/**
 * A reporter names the step `createPipelineRun` materialised for its stage,
 * never one of its own: the step id, the stage id and the attempt id must all
 * agree with the row. The writer checks the same three things; checking them
 * here first turns "step belongs to another run" into the one answer a
 * reporter can act on — read the run, use its identities.
 */
async function resolveReportedStep(db, run, { pipelineStageId, executionStepId, attemptId }) {
  const step = await db.pipelineStep.findUnique({ where: { executionStepId } })
  if (!step || step.runId !== run.id || step.pipelineStageId !== pipelineStageId || step.attemptId !== attemptId) {
    throw serviceError(409, `Report does not name the materialised ${pipelineStageId} step and attempt of this run; read the run first`)
  }
  return step
}

function reporterEventBase(run) {
  return {
    dataPipelineDefinitionId: run.dataPipelineDefinitionId,
    executionContractId: run.executionContractId,
    executionRunId: run.executionRunId,
    correlationId: run.correlationId,
    sourceSha256: null,
    pipelineRecordId: null,
    sourceRecordKey: null,
    sourceRowNumber: null,
    docId: null,
    picId: null,
    factId: null,
    sourceDocIds: [],
    sourcePicIds: [],
    destinationRecordId: null,
    inputHash: null,
    outputHash: null,
    tagIds: [],
    identityRefs: { ...IDENTITY_REFS_EMPTY },
    failureCode: null,
    errorRef: null,
    retryable: null,
    reconciliation: null,
    gate: null,
  }
}

// ADR-067 D2 — the event happens when the stage ran, not when it was
// reported: every write is timed from the report's own `startedAt` /
// `finishedAt`, so the step's timestamps (and the duration the monitor
// derives from them) describe the execution rather than the network.
function reporterOptions({ db, viewer, idFactory }, at) {
  return { db, viewer, now: () => new Date(at), ...(idFactory ? { idFactory } : {}) }
}

/**
 * Records one Stage 9–16 occurrence reported by GKS or GenesisBlockDB.
 *
 * Idempotent by construction (ADR-067 D2): the event keys are derived from
 * run + stage + attempt + outcome, so the same report replays as `UNCHANGED`
 * and a *different* report under the same attempt — other counters, the
 * other outcome — is refused by the ledger's receipt-hash check (409). A
 * reporter that genuinely re-ran a stage has a new attempt, and a new attempt
 * is an FR-071 replay an operator requests, not something a reporter mints.
 *
 * The tier boundary needs no check of its own here: `zKnowledgeStageReport`
 * admits the eight external stage ids and nothing else, so a Tier 1 stage id
 * fails validation before this function reads the run, and the writer
 * refuses it again should any caller reach it another way.
 */
export async function recordKnowledgeStageReport(input, { db = prisma, viewer, idFactory } = {}) {
  const report = parseKnowledgeStageReport(input)
  const run = await loadKnowledgeRun(db, report.executionRunId)
  requireReporter(viewer, run)
  assertReportScope(report.scope, run)
  const step = await resolveReportedStep(db, run, report)

  const key = `${run.executionRunId}:${report.pipelineStageId}:${report.attemptId}`
  const base = reporterEventBase(run)
  const identity = {
    pipelineStageId: report.pipelineStageId,
    executionStepId: report.executionStepId,
    attemptId: report.attemptId,
    sequence: step.sequence,
  }
  const counts = {
    actualCount: report.metrics.records_in,
    insertedCount: report.metrics.records_out,
    failedCount: report.metrics.records_failed,
  }

  await recordPipelineEvent({
    ...base,
    ...identity,
    eventType: 'STEP_STARTED',
    status: 'RUNNING',
    idempotencyKey: `${key}:started`,
  }, reporterOptions({ db, viewer, idFactory }, report.startedAt))

  const outputHash = hashContractPayload(report.metrics)
  const result = report.outcome === 'SUCCEEDED'
    ? await recordPipelineEvent({
        ...base,
        ...identity,
        eventType: 'STEP_SUCCEEDED',
        status: 'SUCCEEDED',
        idempotencyKey: `${key}:succeeded`,
        outputHash,
        ...counts,
      }, reporterOptions({ db, viewer, idFactory }, report.finishedAt))
    : await recordPipelineEvent({
        ...base,
        ...identity,
        eventType: 'STEP_FAILED',
        status: 'FAILED',
        idempotencyKey: `${key}:failed`,
        outputHash,
        failureCode: report.failure.failureCode,
        errorRef: report.failure.errorRef,
        retryable: report.failure.retryable,
        ...counts,
      }, reporterOptions({ db, viewer, idFactory }, report.finishedAt))

  return {
    status: result.status,
    run: result.run,
    step: result.step,
    outcome: report.outcome,
    metrics: report.metrics,
    declined: [...KNOWLEDGE_METRICS_NOT_ON_LEDGER],
  }
}

/**
 * Records the Stage 17 decision (FR-110 AC-110.4): the gate row carries the
 * §23 verdict, the snapshot and the five dimensions as evidence, its `status`
 * stays FR-071's vocabulary, and the Stage 17 step itself is closed
 * `SUCCEEDED` — the gate *ran*; whether the corpus passed is the decision,
 * not the step status. Consistency between `ledgerStatus` and `verdict` is
 * enforced by the shared envelope, not trusted from the reporter.
 */
export async function recordKnowledgeStage17Decision(input, { db = prisma, viewer, idFactory } = {}) {
  const decision = parseKnowledgeStage17Decision(input)
  const run = await loadKnowledgeRun(db, decision.executionRunId)
  requireReporter(viewer, run)
  assertReportScope(decision.scope, run)
  const step = await resolveReportedStep(db, run, decision)

  const key = `${run.executionRunId}:${KNOWLEDGE_QUALITY_GATE_STAGE_ID}:${decision.attemptId}`
  const base = reporterEventBase(run)
  const identity = {
    pipelineStageId: KNOWLEDGE_QUALITY_GATE_STAGE_ID,
    executionStepId: decision.executionStepId,
    attemptId: decision.attemptId,
    sequence: step.sequence,
  }
  const evidence = toKnowledgeStage17Evidence(decision)

  await recordPipelineEvent({
    ...base,
    ...identity,
    eventType: 'STEP_STARTED',
    status: 'RUNNING',
    idempotencyKey: `${key}:started`,
  }, reporterOptions({ db, viewer, idFactory }, decision.startedAt))

  const gateResult = await recordPipelineEvent({
    ...base,
    ...identity,
    eventType: 'GATE_UPDATED',
    tenantId: run.tenantId,
    businessId: run.businessId,
    status: decision.ledgerStatus,
    idempotencyKey: `${key}:gate`,
    gate: {
      gateId: KNOWLEDGE_QUALITY_GATE_ID,
      status: decision.ledgerStatus,
      required: true,
      decidedByPersonId: null,
      reason: `Stage 17 verdict ${decision.verdict}`,
      evidence,
    },
  }, reporterOptions({ db, viewer, idFactory }, decision.finishedAt))

  const stepResult = await recordPipelineEvent({
    ...base,
    ...identity,
    eventType: 'STEP_SUCCEEDED',
    status: 'SUCCEEDED',
    idempotencyKey: `${key}:succeeded`,
    outputHash: hashContractPayload(evidence),
  }, reporterOptions({ db, viewer, idFactory }, decision.finishedAt))

  return {
    status: gateResult.status,
    run: stepResult.run,
    step: stepResult.step,
    gate: gateResult.gate,
    verdict: decision.verdict,
    ledgerStatus: decision.ledgerStatus,
  }
}

/**
 * Closes a knowledge ingestion run — the `RUN_FINISHED` no Tier 1 caller was
 * entitled to write (ADR-067 D3).
 *
 * The terminal status is derived from the ledger by `knowledgeRunOutcome` and
 * never taken from the request: `SUCCEEDED` needs every executed stage
 * (2–17) `SUCCEEDED` behind an `APPROVED`, publishable Stage 17 gate;
 * `FAILED` follows any failed stage or a rejected gate; anything else is
 * refused with the list of what is still owed, so "the run is not finished"
 * is a checkable statement rather than a timeout. A run that is already
 * terminal returns `UNCHANGED` without writing.
 */
export async function finishKnowledgeIngestionRun(input, { db = prisma, viewer, idFactory } = {}) {
  const finish = parseKnowledgeRunFinish(input)
  const run = await loadKnowledgeRun(db, finish.executionRunId)
  requireReporter(viewer, run)
  assertReportScope(finish.scope, run)

  if (!['QUEUED', 'RUNNING'].includes(run.status)) {
    return { status: 'UNCHANGED', terminal: run.status, run: null, outcome: null }
  }

  const monitor = await getPipelineMonitor(run.executionRunId, { db, viewer })
  const outcome = knowledgeRunOutcome({ stages: monitor.stageTimeline, gates: monitor.gates })
  if (!outcome.status) {
    const error = serviceError(409, `Knowledge ingestion run cannot be closed yet: ${outcome.blocking.join(', ')}`)
    error.details = outcome.blocking
    throw error
  }

  const result = await recordPipelineEvent({
    ...reporterEventBase(run),
    eventType: 'RUN_FINISHED',
    pipelineStageId: null,
    executionStepId: null,
    attemptId: null,
    sequence: null,
    status: outcome.status,
    idempotencyKey: `${run.executionRunId}:run:finished`,
    ...(outcome.status === 'FAILED'
      ? {
          failureCode: outcome.failureCode,
          errorRef: `ki-run://${run.executionRunId}/${outcome.failedStage || 'gate'}`,
          retryable: false,
        }
      : {}),
  }, reporterOptions({ db, viewer, idFactory }, finish.finishedAt))

  return { status: result.status, terminal: outcome.status, run: result.run, outcome }
}

/**
 * The monitor half of FR-109: one `pipeline_job_id` (the run id) resolves the
 * run, every materialised step with the identities a reporter must echo, the
 * gate decisions, and the §5 job state (AC-109.11) — derived by
 * `knowledgeJobState` from the run's *stored* status and the step board, never
 * from the monitor's freshness verdict, which is reported beside it unchanged.
 * Readable by whoever may read the run, and by the run's own Tenant's
 * data-plane key (ADR-067 D1): a reporter must be able to read what it is
 * asked to write onto.
 */
export async function readKnowledgeIngestionJob(executionRunId, { db = prisma, viewer, now } = {}) {
  const run = await loadKnowledgeRun(db, executionRunId)
  const monitor = await getPipelineMonitor(executionRunId, { db, viewer, ...(now ? { now } : {}) })
  const job = knowledgeJobState({
    ledgerStatus: run.status,
    stages: monitor.stageTimeline,
    gates: monitor.gates,
  })
  return {
    pipelineJobId: run.executionRunId,
    job,
    run: monitor.run,
    stages: monitor.stageTimeline.map((stage) => ({
      pipelineStageId: stage.pipelineStageId,
      label: stage.label,
      sequence: stage.sequence,
      executionStepId: stage.executionStepId,
      attemptId: stage.attemptId,
      status: stage.status,
      startedAt: stage.startedAt,
      finishedAt: stage.finishedAt,
      durationMs: stage.durationMs,
      actualCount: stage.actualCount,
      insertedCount: stage.insertedCount,
      failedCount: stage.failedCount,
      failureCode: stage.failureCode,
      retryable: stage.retryable,
    })),
    gates: monitor.gates,
    freshness: monitor.freshness,
  }
}
