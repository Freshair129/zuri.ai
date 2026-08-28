import { createHash } from 'node:crypto'
import { z } from 'zod'

// @req FR-071 — the DuckDB/source-artifact → Supabase pipeline has one stable
// definition/contract/stage/event identity envelope.
// @req FR-109 — the seventeen-stage knowledge ingestion pipeline is a second
// definition on the same envelope, not a second ledger.
// @spec ADR-030 D2-D4, SDD-042, SDD-057, SDD-066, SDD-073, SEC-003, SEC-008, ADR-050
// @tested tests/unit/platform/pipeline-tracking-contract.test.js
// @tested tests/unit/platform/knowledge-ingestion-catalog.test.js

export const DATA_PIPELINE_DEFINITION_ID = 'DPL-SUPABASE-BUSINESS-KNOWLEDGE-V1'
export const EXECUTION_CONTRACT_ID = 'EXC-DATA-MIGRATION-V1'

export const PIPELINE_STAGE_CATALOG = Object.freeze([
  { sequence: 10, pipelineStageId: 'DPS-SOURCE-SNAPSHOT', label: 'Open approved source snapshot' },
  { sequence: 20, pipelineStageId: 'DPS-EXPORT-ARTIFACT', label: 'Produce immutable export artifact' },
  { sequence: 30, pipelineStageId: 'DPS-SCHEMA-VALIDATE', label: 'Validate record shape and allowed fields' },
  { sequence: 40, pipelineStageId: 'DPS-RECONCILE', label: 'Reconcile rows, keys and hashes' },
  { sequence: 50, pipelineStageId: 'DPS-SCOPE-RESOLVE', label: 'Resolve destination scope' },
  { sequence: 60, pipelineStageId: 'DPS-STAGING-LOAD', label: 'Load transaction-local staging set' },
  { sequence: 70, pipelineStageId: 'DPS-SUPABASE-APPLY', label: 'Apply guarded Supabase upsert' },
  { sequence: 80, pipelineStageId: 'DPS-POST-APPLY-VERIFY', label: 'Verify destination isolation and counts' },
  { sequence: 90, pipelineStageId: 'DPS-PUBLISH', label: 'Publish approved projection' },
  { sequence: 99, pipelineStageId: 'DPS-ROLLBACK', label: 'Rollback failed or rejected run' },
])

export const KNOWLEDGE_INGESTION_DEFINITION_ID = 'DPL-KNOWLEDGE-INGEST-V1'
export const KNOWLEDGE_INGESTION_CONTRACT_ID = 'EXC-KNOWLEDGE-INGEST-V1'

/**
 * FR-109's seventeen stages, in the sequence its feature note fixes.
 *
 * These ids are keys and the sequence is display ordering — the same split
 * PIPELINE_STAGE_CATALOG above already makes, and the reason the numbering runs
 * in tens: a stage inserted later must never renumber the evidence of a job
 * that predates it (ADR-050 D1).
 *
 * The owning tier is documented per stage rather than encoded, because ADR-050
 * D2 assigns AUTHORITY and SDD-058 resolves LOCATION per object from the data's
 * own classification. A tier column here would read as a deployment rule and be
 * wrong the first time RESTRICTED knowledge forced Stage 15 to run locally.
 * Stages 9-17 are reported onto this ledger by GKS and GenesisBlockDB; Tier 1
 * records them and executes none of them (ADR-050 D3).
 */
export const KNOWLEDGE_INGESTION_STAGE_CATALOG = Object.freeze([
  { sequence: 10, pipelineStageId: 'DPS-KI-INGEST', label: 'Ingestion' },
  { sequence: 20, pipelineStageId: 'DPS-KI-PARSE', label: 'Parsing / Extraction' },
  { sequence: 30, pipelineStageId: 'DPS-KI-PROVENANCE', label: 'Provenance Capture' },
  { sequence: 40, pipelineStageId: 'DPS-KI-NORMALIZE', label: 'Normalization' },
  { sequence: 50, pipelineStageId: 'DPS-KI-CLASSIFY', label: 'Classification / Access Scope' },
  { sequence: 60, pipelineStageId: 'DPS-KI-DEDUPE', label: 'Deduplication / Versioning' },
  { sequence: 70, pipelineStageId: 'DPS-KI-CHUNK', label: 'Chunking' },
  { sequence: 80, pipelineStageId: 'DPS-KI-ENTITY-EXTRACT', label: 'Entity Extraction' },
  { sequence: 90, pipelineStageId: 'DPS-KI-ENTITY-RESOLVE', label: 'Entity Resolution' },
  { sequence: 100, pipelineStageId: 'DPS-KI-FACT-EXTRACT', label: 'Relation / Fact Extraction' },
  { sequence: 110, pipelineStageId: 'DPS-KI-ONTOLOGY-MAP', label: 'Schema / Ontology Mapping' },
  { sequence: 120, pipelineStageId: 'DPS-KI-TEMPORAL-MAP', label: 'Temporal Mapping' },
  { sequence: 130, pipelineStageId: 'DPS-KI-GRAPH-BUILD', label: 'Graph Construction' },
  { sequence: 140, pipelineStageId: 'DPS-KI-ENRICH', label: 'Knowledge / Graph Enrichment' },
  { sequence: 150, pipelineStageId: 'DPS-KI-EMBED', label: 'Embedding' },
  { sequence: 160, pipelineStageId: 'DPS-KI-INDEX', label: 'Multi-Lane Indexing' },
  { sequence: 170, pipelineStageId: 'DPS-KI-QUALITY-GATE', label: 'Graph + Retrieval Quality Gate' },
])

/**
 * Every pipeline definition this ledger accepts, each holding the execution
 * contract id it is paired with and the catalog that belongs to it (SDD-066).
 *
 * The envelope validates the PAIR. Two independent `z.literal` pins — what this
 * replaced — could each only check one half, so nothing stopped a run claiming
 * one definition under the other's contract.
 *
 * A stage is validated against ITS OWN definition's catalog and never against
 * the union of both. The union was the cheaper change and it is the wrong one:
 * it would let a Supabase migration run report a `DPS-KI-EMBED` step and pass
 * every check, which is the ADR-050 D3 tier boundary being crossed inside a
 * validator that reported no problem.
 */
export const PIPELINE_DEFINITIONS = Object.freeze({
  [DATA_PIPELINE_DEFINITION_ID]: Object.freeze({
    executionContractId: EXECUTION_CONTRACT_ID,
    catalog: PIPELINE_STAGE_CATALOG,
  }),
  [KNOWLEDGE_INGESTION_DEFINITION_ID]: Object.freeze({
    executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
    catalog: KNOWLEDGE_INGESTION_STAGE_CATALOG,
  }),
})

/** Own properties only: `constructor` is not a pipeline definition. */
export function definitionById(dataPipelineDefinitionId) {
  return Object.hasOwn(PIPELINE_DEFINITIONS, dataPipelineDefinitionId)
    ? PIPELINE_DEFINITIONS[dataPipelineDefinitionId]
    : null
}

export function catalogFor(dataPipelineDefinitionId) {
  const definition = definitionById(dataPipelineDefinitionId)
  if (!definition) throw new Error(`Unknown pipeline definition: ${dataPipelineDefinitionId}`)
  return definition.catalog
}

export const RUN_STATUSES = Object.freeze(['QUEUED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL', 'ROLLED_BACK', 'CANCELLED'])
export const STEP_STATUSES = Object.freeze(['NOT_STARTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'REPLAYING'])
export const RECORD_STATUSES = Object.freeze(['NOT_STARTED', 'RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'REPLAYING'])
export const GATE_STATUSES = Object.freeze(['PENDING', 'APPROVED', 'REJECTED', 'WAIVED'])
export const EVENT_TYPES = Object.freeze([
  'RUN_CREATED',
  'RUN_STARTED',
  'RUN_FINISHED',
  'STEP_STARTED',
  'STEP_HEARTBEAT',
  'STEP_SUCCEEDED',
  'STEP_FAILED',
  'RECORD_STARTED',
  'RECORD_SUCCEEDED',
  'RECORD_FAILED',
  'RECONCILIATION_RECORDED',
  'GATE_UPDATED',
])

export const IDENTITY_REFS_EMPTY = Object.freeze({
  nodeIds: [],
  edgeIds: [],
  artifactIds: [],
  contractIds: [],
  meetingIds: [],
  callIds: [],
  followupIds: [],
  reqIds: [],
  verifyIds: [],
  gateIds: [],
  integrationId: null,
  graphId: null,
  workflowContractId: null,
  workflowId: null,
  runbookIds: [],
  promotionIds: [],
  skillIds: [],
  toolIds: [],
})

const zId = z.string().trim().min(1).max(500)
const zNullableId = zId.nullable()
const zHash = z.string().regex(/^[a-f0-9]{64}$/i, 'must be a SHA-256 hex digest')
const zNullableHash = zHash.nullable()
const zCount = z.number().int().nonnegative()

// SDD-073 — `errorRef` is a REFERENCE to an error, never the error itself.
//
// FR-071 says this four times ("one redacted record outcome per attempt", the
// "redacted append-only evidence outbox", "keep restricted document payloads
// separate from redacted pipeline events", and AC-071.28's "emit only
// append-only, redacted" events) and, until this shape existed, enforced it
// zero times: the field was `z.string().max(1000)`, which accepts a stack
// trace, an exception message, or a quoted document fragment. The rule lived
// entirely in caller discipline, and the ledger it protects is append-only —
// a payload written there cannot be taken back.
//
// The allowed shape is a reference token: ASCII alphanumerics plus the
// separators a handle uses (`err://event-1`, a UUID, `ERR-1234`,
// `errors/2026-08-28/ab12`). Every value in the repository already conforms.
//
// **Whitespace alone is NOT the test, and that is the whole reason for the
// character class.** The obvious guard — reject anything containing a space or
// newline — reads as sufficient in English and is not: Thai does not separate
// words with spaces, so an entire Thai sentence is one whitespace-free token
// and would pass untouched. In a product whose user-facing copy is Thai, an
// error message is more likely to be Thai than not. Allowing a known alphabet
// rather than rejecting a known separator is what closes that.
//
// **What this does not do.** It blocks the accident — passing `err.message` or
// `err.stack` straight through, which is how this field would realistically be
// polluted — not a determined caller, who can still concatenate a sentence
// with underscores. It raises the cost of leaking and removes the silent path;
// it does not make disclosure impossible. Do not read a passing value as
// evidence that the reference carries nothing sensitive.
const zErrorRef = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._:/#@-]*$/,
    'errorRef must be a redacted reference token (AC-071.28), not error text',
  )
const zIdentityRefs = z.object({
  nodeIds: z.array(zId).max(100),
  edgeIds: z.array(zId).max(100),
  artifactIds: z.array(zId).max(100),
  contractIds: z.array(zId).max(100),
  meetingIds: z.array(zId).max(100),
  callIds: z.array(zId).max(100),
  followupIds: z.array(zId).max(100),
  reqIds: z.array(zId).max(100),
  verifyIds: z.array(zId).max(100),
  gateIds: z.array(zId).max(100),
  integrationId: zNullableId,
  graphId: zNullableId,
  workflowContractId: zNullableId,
  workflowId: zNullableId,
  runbookIds: z.array(zId).max(100),
  promotionIds: z.array(zId).max(100),
  skillIds: z.array(zId).max(100),
  toolIds: z.array(zId).max(100),
}).strict()

const zReconciliation = z.object({
  expectedCount: zCount,
  actualCount: zCount,
  insertedCount: zCount,
  updatedCount: zCount,
  unchangedCount: zCount,
  rejectedCount: zCount,
  duplicateCount: zCount,
  sourceSha256: zNullableHash,
  artifactSha256: zNullableHash,
  stagingHash: zNullableHash,
  destinationHash: zNullableHash,
  rlsProbeResult: z.string().trim().max(100).nullable(),
  isolationResult: z.string().trim().max(100).nullable(),
  result: z.enum(['PENDING', 'PASS', 'FAIL']),
}).strict().nullable()

const zGate = z.object({
  gateId: zNullableId,
  status: z.enum(GATE_STATUSES),
  required: z.boolean(),
  decidedByPersonId: zNullableId,
  reason: z.string().trim().max(500).nullable(),
}).strict().nullable()

/**
 * The definition and its execution contract are checked as a pair, and a stage
 * against that definition's own catalog (SDD-066). Returns the resolved
 * definition so a caller can go on to check its stage, or null when the
 * definition itself is unknown and every downstream check would be meaningless.
 */
function refineDefinitionPair(value, ctx) {
  const definition = definitionById(value.dataPipelineDefinitionId)
  if (!definition) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['dataPipelineDefinitionId'],
      message: 'unknown pipeline definition',
    })
    return null
  }
  if (value.executionContractId !== definition.executionContractId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['executionContractId'],
      message: `execution contract does not belong to ${value.dataPipelineDefinitionId}`,
    })
  }
  return definition
}

export const zPipelineEvent = z.object({
  eventType: z.enum(EVENT_TYPES),
  dataPipelineDefinitionId: zId,
  executionContractId: zId,
  executionRunId: zId,
  pipelineStageId: zNullableId,
  executionStepId: zNullableId,
  attemptId: zNullableId,
  pipelineRecordId: zNullableId,
  sourceRecordKey: z.string().trim().max(500).nullable(),
  sourceRowNumber: z.number().int().nonnegative().nullable(),
  sourceSha256: zNullableHash,
  docId: zNullableId,
  picId: zNullableId,
  factId: zNullableId,
  sourceDocIds: z.array(zId).max(100),
  sourcePicIds: z.array(zId).max(100),
  destinationRecordId: zNullableId,
  sequence: z.number().int().nonnegative().nullable(),
  status: z.enum([...RUN_STATUSES, ...STEP_STATUSES, ...GATE_STATUSES]),
  correlationId: zId,
  idempotencyKey: zId,
  inputHash: zNullableHash,
  outputHash: zNullableHash,
  // NFR-020's per-stage counts (SDD-070), reusing PipelineStep's own count
  // columns rather than adding new ones: actualCount is records_in,
  // insertedCount is records_out, failedCount is records_failed. Optional so
  // every existing caller — the Supabase migration path, every fixture in
  // this file's own test suite — is unaffected; a step event that omits them
  // updates nothing about counts, exactly as it always has.
  actualCount: zCount.optional(),
  insertedCount: zCount.optional(),
  failedCount: zCount.optional(),
  tagIds: z.array(zId).max(100),
  identityRefs: zIdentityRefs,
  failureCode: z.string().trim().min(1).max(200).nullable(),
  errorRef: zErrorRef.nullable(),
  retryable: z.boolean().nullable(),
  reconciliation: zReconciliation,
  gate: zGate,
}).strict().superRefine((value, ctx) => {
  const definition = refineDefinitionPair(value, ctx)
  if (definition && value.pipelineStageId !== null
    && !definition.catalog.some((stage) => stage.pipelineStageId === value.pipelineStageId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pipelineStageId'],
      message: `stage does not belong to ${value.dataPipelineDefinitionId}`,
    })
  }
  const stepEvent = ['STEP_STARTED', 'STEP_HEARTBEAT', 'STEP_SUCCEEDED', 'STEP_FAILED'].includes(value.eventType)
  const recordEvent = ['RECORD_STARTED', 'RECORD_SUCCEEDED', 'RECORD_FAILED'].includes(value.eventType)
  if (stepEvent && (!value.pipelineStageId || !value.executionStepId || !value.attemptId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['executionStepId'], message: 'stage events require stage, step and attempt IDs' })
  }
  if (recordEvent && (!value.pipelineRecordId || !value.attemptId)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pipelineRecordId'], message: 'record events require record and attempt IDs' })
  }
  if (value.status === 'FAILED') {
    for (const [field, message] of [
      ['failureCode', 'failed events require failureCode'],
      ['errorRef', 'failed events require errorRef'],
      ['retryable', 'failed events require retryable'],
    ]) {
      if (value[field] == null || value[field] === '') ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message })
    }
  }
  if (value.eventType === 'RECONCILIATION_RECORDED' && !value.reconciliation) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reconciliation'], message: 'reconciliation event requires reconciliation evidence' })
  }
  if (value.eventType === 'GATE_UPDATED' && !value.gate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['gate'], message: 'gate event requires gate evidence' })
  }
})

export const zPipelineRunInput = z.object({
  dataPipelineDefinitionId: zId,
  executionContractId: zId,
  businessId: zId,
  sourceRef: z.string().trim().max(1000).nullable().optional().default(null),
  sourceSha256: zHash.nullable().optional().default(null),
  artifactRef: z.string().trim().max(1000).nullable().optional().default(null),
  artifactSha256: zHash.nullable().optional().default(null),
  expectedCount: zCount.default(0),
  bootstrapBatchId: zNullableId.optional().default(null),
  correlationId: zId,
  idempotencyKey: zId,
  identityRefs: zIdentityRefs,
  tagIds: z.array(zId).max(100).default([]),
}).strict().superRefine(refineDefinitionPair)

export const zReplayInput = z.object({
  scope: z.enum(['FULL_RUN', 'FAILED_STAGE', 'FAILED_RECORDS', 'PROVENANCE_FILTERED']),
  correlationId: zId,
  idempotencyKey: zId,
  sourceSha256: zHash.nullable().optional().default(null),
  artifactSha256: zHash.nullable().optional().default(null),
  executionStepId: zNullableId.optional().default(null),
  pipelineRecordIds: z.array(zId).max(500).default([]),
  docIds: z.array(zId).max(500).default([]),
  picIds: z.array(zId).max(500).default([]),
  factIds: z.array(zId).max(500).default([]),
}).strict().superRefine((value, ctx) => {
  if (value.scope === 'FAILED_STAGE' && !value.executionStepId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['executionStepId'], message: 'failed-stage replay requires executionStepId' })
  }
  if (value.scope === 'FAILED_RECORDS' && value.pipelineRecordIds.length === 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pipelineRecordIds'], message: 'failed-record replay requires pipelineRecordIds' })
  }
  if (value.scope === 'PROVENANCE_FILTERED' && !value.docIds.length && !value.picIds.length && !value.factIds.length) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['docIds'], message: 'provenance replay requires a source identity filter' })
  }
})

const RUN_TRANSITIONS = Object.freeze({
  QUEUED: ['QUEUED', 'RUNNING', 'CANCELLED'],
  RUNNING: ['RUNNING', 'SUCCEEDED', 'FAILED', 'PARTIAL', 'ROLLED_BACK', 'CANCELLED'],
  SUCCEEDED: ['SUCCEEDED'],
  FAILED: ['FAILED'],
  PARTIAL: ['PARTIAL'],
  ROLLED_BACK: ['ROLLED_BACK'],
  CANCELLED: ['CANCELLED'],
})

const STEP_TRANSITIONS = Object.freeze({
  NOT_STARTED: ['NOT_STARTED', 'RUNNING', 'FAILED', 'SKIPPED', 'REPLAYING'],
  RUNNING: ['RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED', 'REPLAYING'],
  SUCCEEDED: ['SUCCEEDED'],
  FAILED: ['FAILED', 'REPLAYING'],
  SKIPPED: ['SKIPPED'],
  REPLAYING: ['REPLAYING', 'RUNNING', 'SUCCEEDED', 'FAILED'],
})

export function assertStatusTransition(previous, next, { kind = 'run' } = {}) {
  const graph = kind === 'step' || kind === 'record' ? STEP_TRANSITIONS : RUN_TRANSITIONS
  if (!graph[previous]?.includes(next)) {
    throw new Error(`Invalid ${kind} status transition: ${previous} -> ${next}`)
  }
  return true
}

export function parsePipelineEvent(input) {
  return zPipelineEvent.parse(input)
}

export function parsePipelineRunInput(input) {
  return zPipelineRunInput.parse(input)
}

export function parseReplayInput(input) {
  return zReplayInput.parse(input)
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
  }
  return value
}

export function hashContractPayload(value) {
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

/**
 * A stage is only meaningful inside the definition that declares it, so both
 * arguments are required and there is no default.
 *
 * A default of DATA_PIPELINE_DEFINITION_ID would have been the compatible
 * change and a silent one: every `DPS-KI-*` stage would resolve to null, and
 * the record-event path reads `stage?.sequence ?? 0` off that null — seventeen
 * knowledge steps all landing on sequence 0, and a stage board rendering in
 * whatever order the rows came back.
 */
export function stageById(dataPipelineDefinitionId, pipelineStageId) {
  if (arguments.length < 2) {
    throw new Error('stageById requires the pipeline definition the stage belongs to')
  }
  const definition = definitionById(dataPipelineDefinitionId)
  if (!definition) return null
  return definition.catalog.find((stage) => stage.pipelineStageId === pipelineStageId) || null
}
