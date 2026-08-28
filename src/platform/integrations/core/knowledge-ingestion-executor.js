import prisma from '@/lib/db'
import { knowledgeIngestionRunInput } from '@/modules/knowledge/ingestion-job'
import { runKnowledgeIngestionStagesWithTrace } from '@/modules/knowledge/stage-runner'
import { buildQuarantineEnvelope } from '@/modules/knowledge/quarantine'
import { ingestionIdentity } from '@/modules/knowledge/dedup'
import { IDENTITY_REFS_EMPTY, hashContractPayload } from './pipeline-tracking-contract'
import { createPipelineRun, recordPipelineEvent } from './pipeline-tracking-service'

// @req FR-109 — the ledger-writing wiring: something calls FR-118's stage
// composition and writes its result onto the FR-071 ledger, bound through docId.
// @req NFR-020 — real per-stage counts, read from what each stage actually
// produced rather than a uniform placeholder.
// @req FR-119 — a document that fails partway is quarantined with BR-022's
// envelope, not reported as nothing having happened.
// @spec SDD-069, SDD-070, SDD-072, SDD-066, SDD-057, BR-021, BR-022, ADR-050 D4
// @tested tests/integration/fr109-knowledge-ingestion-executor.test.js
// @tested tests/integration/fr119-knowledge-ingestion-quarantine.test.js

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
