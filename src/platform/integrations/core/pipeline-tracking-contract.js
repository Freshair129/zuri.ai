import { createHash } from 'node:crypto'
import { z } from 'zod'

// @req FR-071 — the DuckDB/source-artifact → Supabase pipeline has one stable
// definition/contract/stage/event identity envelope.
// @req FR-109 — the seventeen-stage knowledge ingestion pipeline is a second
// definition on the same envelope, not a second ledger.
// @req FR-129 — the catalog publication approval gate carries the evidence its
// signer acted on, so "who published this catalog and what did they see" is
// answerable from the ledger.
// @req FR-110 — bounded knowledge snapshot evidence is definition- and
// scope-bound on the shared Stage 17 event envelope.
// @spec ADR-030 D2-D4, SDD-042, SDD-057, SDD-066, SDD-070, SDD-073, SDD-075, SEC-003, SEC-008, ADR-050
// @tested tests/unit/platform/pipeline-tracking-contract.test.js
// @tested tests/unit/platform/knowledge-ingestion-catalog.test.js
// @tested tests/unit/platform/fr129-catalog-publication-gate.test.js
// @tested tests/unit/knowledge-published-snapshot-contract.test.js

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

// @req FR-134 — Asset intake shares the definition-neutral execution ledger,
// but its definition/contract/stages never alias either knowledge pipeline.
// @spec SDD-079, ADR-030, ADR-055
// @tested tests/unit/asset-management-pipeline-contract.test.js
export const ASSET_REGISTER_IMPORT_DEFINITION_ID = 'DPL-ASSET-REGISTER-IMPORT-V1'
export const ASSET_REGISTER_IMPORT_CONTRACT_ID = 'EXC-ASSET-REGISTER-IMPORT-V1'
export const ASSET_REGISTER_IMPORT_STAGE_CATALOG = Object.freeze([
  { sequence: 10, pipelineStageId: 'DPS-AM-INTAKE', label: 'Receive immutable Asset intake envelope' },
  { sequence: 20, pipelineStageId: 'DPS-AM-EVIDENCE-GUARD', label: 'Inspect evidence type, size and availability' },
  { sequence: 30, pipelineStageId: 'DPS-AM-EXTRACT-CANDIDATES', label: 'Extract OCR or Vision candidates' },
  { sequence: 40, pipelineStageId: 'DPS-AM-NORMALIZE', label: 'Normalize candidate fields and references' },
  { sequence: 50, pipelineStageId: 'DPS-AM-SCOPE-REFERENCE-VALIDATE', label: 'Validate trusted scope and typed references' },
  { sequence: 60, pipelineStageId: 'DPS-AM-RECONCILE', label: 'Detect duplicate and conflicting evidence' },
  { sequence: 70, pipelineStageId: 'DPS-AM-HUMAN-CONFIRM', label: 'Capture human confirmation and correction' },
  { sequence: 80, pipelineStageId: 'DPS-AM-APPROVAL', label: 'Record approval decision and evidence' },
  { sequence: 90, pipelineStageId: 'DPS-AM-APPLY', label: 'Apply Asset truth transactionally' },
])

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

// FR-110 / KNO-01 — Stages 9–16 are owned by GKS/GenesisBlockDB. When they
// report to this Tier 1 ledger, the evidence is a bounded control envelope and
// aggregate counters only; their entities, facts, embeddings, indexes and
// receipts stay in the owning tier (ADR-050 D3-D4).
export const KNOWLEDGE_INGESTION_EXTERNAL_STAGE_IDS = Object.freeze(
  KNOWLEDGE_INGESTION_STAGE_CATALOG
    .filter(({ sequence }) => sequence >= 90 && sequence <= 160)
    .map(({ pipelineStageId }) => pipelineStageId),
)
export const KNOWLEDGE_QUALITY_GATE_STAGE_ID = 'DPS-KI-QUALITY-GATE'
export const KNOWLEDGE_GATE_VERDICTS = Object.freeze([
  'PASS',
  'PASS_WITH_WARNINGS',
  'QUARANTINE',
  'FAIL',
])
export const KNOWLEDGE_QUALITY_DIMENSIONS = Object.freeze([
  'data',
  'graph',
  'knowledge',
  'security',
  'retrieval',
])
export const KNOWLEDGE_DIMENSION_RESULTS = Object.freeze(['PASS', 'WARN', 'FAIL'])

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
  [ASSET_REGISTER_IMPORT_DEFINITION_ID]: Object.freeze({
    executionContractId: ASSET_REGISTER_IMPORT_CONTRACT_ID,
    catalog: ASSET_REGISTER_IMPORT_STAGE_CATALOG,
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

const zFiniteNonnegativeCount = z.number().finite().int().nonnegative()
const zFiniteNonnegativeDuration = z.number().finite().nonnegative()
const zSnapshotId = z.string().trim().min(1).max(500)
const zSnapshotPublishedAt = z.string().datetime({ offset: true })

/** The five object counts that identify the logical FR-110 snapshot shape. */
export const zKnowledgeSnapshotStatistics = z.object({
  documents: zFiniteNonnegativeCount,
  chunks: zFiniteNonnegativeCount,
  entities: zFiniteNonnegativeCount,
  facts: zFiniteNonnegativeCount,
  relations: zFiniteNonnegativeCount,
}).strict()

/**
 * FR-110 §25's published object. This is deliberately narrower than the
 * specification's recommended `index_generation` and FR-109's
 * `pipeline_job_id`; neither is declared by FR-110.
 */
export const zKnowledgeSnapshot = z.object({
  knowledge_snapshot_id: zSnapshotId,
  tenant_id: zSnapshotId,
  business_id: zSnapshotId,
  ontology_version: zSnapshotId,
  pipeline_version: zSnapshotId,
  published_at: zSnapshotPublishedAt,
  statistics: zKnowledgeSnapshotStatistics,
}).strict()

const zKnowledgeDimensionEvidence = z.object({
  result: z.enum([...KNOWLEDGE_DIMENSION_RESULTS]),
  critical: z.boolean(),
}).strict().superRefine((value, ctx) => {
  if (value.critical && value.result !== 'FAIL') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['result'],
      message: 'a critical quality finding must have a FAIL dimension result',
    })
  }
})

export const zKnowledgeStage17Dimensions = z.object({
  data: zKnowledgeDimensionEvidence,
  graph: zKnowledgeDimensionEvidence,
  knowledge: zKnowledgeDimensionEvidence,
  security: zKnowledgeDimensionEvidence,
  retrieval: zKnowledgeDimensionEvidence,
}).strict()

/**
 * The only FR-110 evidence shape admitted to PipelineGateDecision.evidenceJson.
 * Stage 17's quality verdict is kept under `verdict`; it is not a new ledger
 * status. A held result may carry no published snapshot, while PASS and
 * PASS_WITH_WARNINGS must identify the complete snapshot they would publish.
 */
export const zKnowledgeStage17Evidence = z.object({
  verdict: z.enum([...KNOWLEDGE_GATE_VERDICTS]),
  snapshot: zKnowledgeSnapshot.nullable(),
  dimensions: zKnowledgeStage17Dimensions,
}).strict().superRefine((value, ctx) => {
  if (['PASS', 'PASS_WITH_WARNINGS'].includes(value.verdict) && value.snapshot === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['snapshot'],
      message: 'a publishable Stage 17 verdict requires the complete published snapshot',
    })
  }
})

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

// SDD-075 — the evidence a reviewer signed on, declared here rather than left
// for the first caller to invent.
//
// `PipelineGateDecision.evidenceJson` has existed since FR-071 as `text NOT
// NULL DEFAULT '{}'` and nothing has ever written it, because this object had
// no member for it. `evidenceJson` is untyped text, so gate evidence is
// exactly as checkable as this shape and no more — which is why the shape is
// part of the decision instead of a convention.
//
// **Counts and one identity, never rows.** The column sits under FORCE ROW
// LEVEL SECURITY on an append-only ledger, and a payload written there cannot
// be taken back. `.strict()` is what keeps it that way: an object closed to
// five named scalar members cannot carry a customer name, a price list or a
// rejected row no matter what a caller passes, and the refusal is loud rather
// than a silent truncation. A `passthrough()` here would make the append-only
// ledger the easiest place in the product to leak personal data into.
//
// **`catalogVersion` lives here and not in a column** — SDD-066 made these six
// tables definition-neutral so a second pipeline definition could share them,
// and `catalogVersion` is one definition's vocabulary. FR-110's Stage 17 gate
// runs on the other definition and signs a `knowledge_snapshot_id`, not a
// catalog version; it is a different decision on the same table and this shape
// is deliberately not stretched to cover it. A knowledge gate that needs
// evidence declares its own member and says so. Each admitted shape is strict,
// so an unlabelled object is refused visibly instead of stored. The union below
// admits the named FR-129 catalog shape and FR-110 knowledge shape only.
const zCatalogGateEvidence = z.object({
  catalogVersion: z.string().trim().min(1).max(200),
  artifactSha256: zNullableHash.optional().default(null),
  addedCount: zCount,
  changedCount: zCount,
  unchangedCount: zCount,
}).strict()

// Both pipeline definitions share PipelineGateDecision.evidenceJson, but each
// definition gets a closed evidence vocabulary. A union keeps the column
// definition-neutral without turning it into an arbitrary JSON escape hatch.
const zGateEvidence = z.union([zCatalogGateEvidence, zKnowledgeStage17Evidence])

const zGate = z.object({
  gateId: zNullableId,
  status: z.enum(GATE_STATUSES),
  required: z.boolean(),
  decidedByPersonId: zNullableId,
  reason: z.string().trim().max(500).nullable(),
  // Optional for the same reason SDD-070's counts are: a member persisted only
  // when a caller supplies it leaves every existing decision row and every
  // existing caller unchanged. The one case where it is NOT optional is
  // enforced in the envelope's superRefine below, where the definition is in
  // scope and this object's own schema cannot see it.
  evidence: zGateEvidence.optional(),
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
  // Existing FR-071 events predate the knowledge scope handoff and therefore
  // may omit these fields. A Stage 17 knowledge decision must carry both so
  // the snapshot can be checked at the shared envelope boundary.
  tenantId: zId.optional(),
  businessId: zId.optional(),
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
  // FR-110 / KNO-01 — the knowledge quality gate is a Stage 17 decision, not
  // a free-form gate row. Its control identity must name the quality-gate
  // stage and the attempt, and its evidence must be this definition's closed
  // snapshot/verdict/dimension shape. The existing FR-129 catalog evidence is
  // intentionally not interchangeable with it.
  const knowledgeDefinition = value.dataPipelineDefinitionId === KNOWLEDGE_INGESTION_DEFINITION_ID
  const knowledgeEvidence = value.gate?.evidence
    ? zKnowledgeStage17Evidence.safeParse(value.gate.evidence).success
    : false
  const catalogEvidence = value.gate?.evidence
    ? zCatalogGateEvidence.safeParse(value.gate.evidence).success
    : false
  if (knowledgeDefinition && value.eventType === 'GATE_UPDATED'
    && value.pipelineStageId === KNOWLEDGE_QUALITY_GATE_STAGE_ID) {
    for (const field of ['tenantId', 'businessId']) {
      if (!value[field]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [field],
          message: 'knowledge quality gate decisions require tenant and business scope IDs',
        })
      }
    }
    if (!value.executionStepId || !value.attemptId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['executionStepId'],
        message: 'knowledge quality gate decisions require step and attempt IDs',
      })
    }
    if (!knowledgeEvidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gate', 'evidence'],
        message: 'knowledge quality gate decisions require FR-110 Stage 17 evidence',
      })
    } else if (value.gate.evidence.snapshot
      && (value.gate.evidence.snapshot.tenant_id !== value.tenantId
        || value.gate.evidence.snapshot.business_id !== value.businessId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gate', 'evidence', 'snapshot'],
        message: 'FR-110 snapshot scope must match the shared pipeline event scope',
      })
    }
    if (knowledgeEvidence && value.gate.status === 'APPROVED'
      && (['QUARANTINE', 'FAIL'].includes(value.gate.evidence.verdict)
        || Object.values(value.gate.evidence.dimensions)
          .some(({ result, critical }) => result === 'FAIL' || critical === true))) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gate', 'status'],
        message: 'an APPROVED knowledge quality gate requires a publishable verdict with no blocking dimension',
      })
    }
  } else if (knowledgeEvidence) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gate', 'evidence'],
      message: 'FR-110 Stage 17 evidence is valid only on a knowledge quality gate decision',
    })
  } else if (knowledgeDefinition && catalogEvidence) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['gate', 'evidence'],
      message: 'FR-129 catalog evidence is valid only on the Supabase catalog definition',
    })
  }
  // FR-129 (b) — an APPROVED catalog publication signature must say what the
  // signer saw. "Somebody approved" without "what they approved" is not an
  // auditable decision, and the ledger is append-only: the missing evidence
  // cannot be added afterwards without a second row claiming to be the first.
  //
  // Scoped to THIS definition on purpose. FR-110's Stage 17 gate is an
  // automated quality verdict on `DPL-KNOWLEDGE-INGEST-V1` sharing this one
  // table, and requiring FR-129's catalog evidence of it would be inventing a
  // rule for a requirement that has not asked for one. Both will answer to
  // "approval gate on a pipeline run" in a future search; only one of them is
  // constrained here.
  //
  // REJECTED, WAIVED and PENDING are unconstrained. A rejection's account is
  // its `reason`, and a waiver's subject may be a run that never produced a
  // candidate at all — demanding counts of either would refuse a legitimate
  // decision to make the shape symmetric.
  if (value.gate && value.dataPipelineDefinitionId === DATA_PIPELINE_DEFINITION_ID) {
    if (value.gate.status === 'APPROVED' && !value.gate.evidence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gate', 'evidence'],
        message: 'an APPROVED catalog publication gate requires the evidence it was decided on (FR-129, SDD-075)',
      })
    }
    // FR-129 (2) — "The decision names a person, and, when rejecting, a reason."
    //
    // Said here because the schema cannot say it: `decidedByPersonId` is
    // `String?` with NO relation to `Person`, unlike
    // `CustomerImportReviewDecision.decidedByPersonId`, which is NOT NULL with a
    // real foreign key. So an approval with no signer at all is writable, and
    // an unsigned approval is the same hollow record as an unaccounted one.
    //
    // **This decides nothing about WHO may sign.** That is the named product
    // blocker, and it stays open: this refuses an anonymous signature, not any
    // particular signatory. PENDING and WAIVED are left alone — PENDING is the
    // gate awaiting a decision rather than one, and whether a waiver is a
    // person's act or a definition's property is part of the same open
    // question about `required`.
    if (['APPROVED', 'REJECTED'].includes(value.gate.status) && !value.gate.decidedByPersonId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gate', 'decidedByPersonId'],
        message: 'a catalog publication decision names the person who made it (FR-129)',
      })
    }
    if (value.gate.status === 'REJECTED' && !value.gate.reason) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['gate', 'reason'],
        message: 'a REJECTED catalog publication gate requires a reason (FR-129)',
      })
    }
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
