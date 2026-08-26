import { createHash } from 'node:crypto'
import { z } from 'zod'

// @req FR-071 — the DuckDB/source-artifact → Supabase pipeline has one stable
// definition/contract/stage/event identity envelope.
// @spec ADR-030 D2-D4, SDD-042, SEC-003, SEC-008
// @tested tests/unit/platform/pipeline-tracking-contract.test.js

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

const stageIds = PIPELINE_STAGE_CATALOG.map((stage) => stage.pipelineStageId)
const zId = z.string().trim().min(1).max(500)
const zNullableId = zId.nullable()
const zHash = z.string().regex(/^[a-f0-9]{64}$/i, 'must be a SHA-256 hex digest')
const zNullableHash = zHash.nullable()
const zCount = z.number().int().nonnegative()
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

export const zPipelineEvent = z.object({
  eventType: z.enum(EVENT_TYPES),
  dataPipelineDefinitionId: z.literal(DATA_PIPELINE_DEFINITION_ID),
  executionContractId: z.literal(EXECUTION_CONTRACT_ID),
  executionRunId: zId,
  pipelineStageId: zId.nullable().refine((value) => value === null || stageIds.includes(value), 'unknown pipeline stage'),
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
  tagIds: z.array(zId).max(100),
  identityRefs: zIdentityRefs,
  failureCode: z.string().trim().min(1).max(200).nullable(),
  errorRef: z.string().trim().min(1).max(1000).nullable(),
  retryable: z.boolean().nullable(),
  reconciliation: zReconciliation,
  gate: zGate,
}).strict().superRefine((value, ctx) => {
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
  dataPipelineDefinitionId: z.literal(DATA_PIPELINE_DEFINITION_ID),
  executionContractId: z.literal(EXECUTION_CONTRACT_ID),
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
}).strict()

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

export function stageById(pipelineStageId) {
  return PIPELINE_STAGE_CATALOG.find((stage) => stage.pipelineStageId === pipelineStageId) || null
}
