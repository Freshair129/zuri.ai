import prisma from '@/lib/db'
import { knowledgeIngestionRunInput } from '@/modules/knowledge/ingestion-job'
import { runKnowledgeIngestionStages } from '@/modules/knowledge/stage-runner'
import { ingestionIdentity } from '@/modules/knowledge/dedup'
import { IDENTITY_REFS_EMPTY, hashContractPayload } from './pipeline-tracking-contract'
import { createPipelineRun, recordPipelineEvent } from './pipeline-tracking-service'

// @req FR-109 — the ledger-writing wiring: something calls FR-118's stage
// composition and writes its result onto the FR-071 ledger, bound through docId.
// @req NFR-020 — real per-stage counts, read from what each stage actually
// produced rather than a uniform placeholder.
// @spec SDD-069, SDD-070, SDD-066, SDD-057, BR-021, ADR-050 D4
// @tested tests/integration/fr109-knowledge-ingestion-executor.test.js

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
 * NFR-020's per-stage counts (SDD-070) for each of the seven Tier 1 stages,
 * read from FR-118's actual output rather than reported as a uniform "1 in, 1
 * out" for every stage. `records_failed` is always 0 here: this executor only
 * reaches this loop after `runKnowledgeIngestionStages` has already returned
 * successfully (see the docstring below on what an exception does instead),
 * so nothing in this pass has failed.
 *
 * Normalization is the one stage where `records_out` is not equal to
 * `records_in`: FR-114 declines to normalize a value it cannot decide,
 * returning `canonical: null` rather than guessing (SDD-061). That decline is
 * not a failure — it is normalization working exactly as designed — so it
 * counts against `records_out`, never against `records_failed`.
 */
function stageCounts(pipelineStageId, stageResult, input) {
  const structuredFields = input.structuredFields || []
  const structuredRecords = input.structuredRecords || []
  switch (pipelineStageId) {
    case 'DPS-KI-NORMALIZE':
      return {
        actualCount: structuredFields.length,
        insertedCount: stageResult.normalized_fields.filter((f) => f.canonical !== null).length,
        failedCount: 0,
      }
    case 'DPS-KI-CHUNK':
      return { actualCount: 1, insertedCount: stageResult.chunks.length, failedCount: 0 }
    case 'DPS-KI-ENTITY-EXTRACT':
      return {
        actualCount: stageResult.chunks.length + structuredRecords.length,
        insertedCount: stageResult.entity_candidates.length,
        failedCount: 0,
      }
    default:
      // Parse, provenance, classify and dedupe each transform exactly one
      // document-level object into one document-level result.
      return { actualCount: 1, insertedCount: 1, failedCount: 0 }
  }
}

/**
 * Registers a knowledge ingestion run and writes the seven Tier 1 stages'
 * evidence onto the FR-071 ledger, using FR-118's composition as the source
 * of what happened.
 *
 * **What this closes.** `docId` — FR-109's identity table calls it "the
 * `PipelineRecordEvent` column that nothing writes today" — is now written,
 * bound to `documentId` on a `RECORD_STARTED`/`RECORD_SUCCEEDED` pair
 * spanning the Tier 1 pass. Each of the seven stages gets a real
 * `STEP_STARTED`/`STEP_SUCCEEDED` transition on the `PipelineStep` rows
 * `createPipelineRun` already materializes from `KNOWLEDGE_INGESTION_STAGE_CATALOG`.
 *
 * **What it does not close.** The run is never marked finished. Nine of the
 * seventeen catalog steps (Stages 9-17) belong to GKS and GenesisBlockDB
 * (ADR-050 D3) and this repository does not execute them — sending
 * `RUN_FINISHED` here would claim a run is done that is, from what this
 * repository can see, seven-seventeenths done. The run stays `RUNNING` and
 * that is accurate, not incomplete.
 *
 * A stage failure inside FR-118 is not caught, not classified, and not
 * written as `STEP_FAILED`. FR-118's composition is one synchronous call —
 * it throws on the first bad stage with no partial result — so this function
 * cannot know *which* of the seven stages failed without restructuring
 * FR-118's contract, which this slice does not do. The run this function
 * already created stays at `QUEUED`/`NOT_STARTED` on every step, an honest
 * "attempted, nothing recorded" rather than a guess dressed as evidence.
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

  // Computed once, pure, no partial result on failure (see the docstring
  // above) — an exception here propagates unchanged, and nothing further in
  // this function runs.
  const stageResult = runKnowledgeIngestionStages(input)

  const sourceSha256 = SHA256_HEX.test(String(artifact.content_hash)) ? String(artifact.content_hash) : null
  const firstStage = stepByStage[TIER1_STAGES[0][0]]
  const lastStage = stepByStage[TIER1_STAGES[TIER1_STAGES.length - 1][0]]

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

  const stageEvents = []
  for (const [pipelineStageId, resultKey] of TIER1_STAGES) {
    const step = stepByStage[pipelineStageId]
    const stageOutputHash = hashContractPayload(stageResult[resultKey])
    const counts = stageCounts(pipelineStageId, stageResult, input)

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

    const succeeded = await recordPipelineEvent({
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
      ...counts,
    }, runOptions)

    stageEvents.push({ pipelineStageId, ...succeeded })
  }

  const recordSucceeded = await recordPipelineEvent({
    ...eventBase,
    eventType: 'RECORD_SUCCEEDED',
    pipelineStageId: null,
    executionStepId: null,
    attemptId: lastStage.attemptId,
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
      chunks: stageResult.chunks.length,
      entity_candidates: stageResult.entity_candidates.length,
      dedup: stageResult.dedup.relationship,
    }),
  }, runOptions)

  return {
    run: runResult.run,
    identity,
    stages: stageEvents,
    record: recordSucceeded,
    warnings: stageResult.warnings,
  }
}
