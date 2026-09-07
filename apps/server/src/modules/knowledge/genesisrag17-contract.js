import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  KNOWLEDGE_INGESTION_STAGE_CATALOG,
  KNOWLEDGE_QUALITY_GATE_STAGE_ID,
} from '@/platform/integrations/core/pipeline-tracking-contract'

// @req FR-109 — the Tier 1 raw entrypoint and MSP handoff use one frozen
// genesisrag17.v1 contract, with exact stage and attempt identities.
// @req FR-110 — receipt-backed publication and scoped retrieval are validated
// before a run can be closed or a query result returned.
// @spec ADR-050, ADR-063, ADR-068, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/unit/genesisrag17-contract.test.js

export const GENESIS_RAG17_SCHEMA_VERSION = 'genesisrag17.v1'
export const GENESIS_RAG17_PIPELINE_VERSION = GENESIS_RAG17_SCHEMA_VERSION
export const GENESIS_RAG17_SCOPE_KEYS = Object.freeze([
  'portfolioId',
  'tenantId',
  'businessId',
  'workspaceId',
  'agentId',
  'visibility',
])
export const GENESIS_RAG17_PIPELINE_TOOLS = Object.freeze({
  submit: 'msp_pipeline_submit',
  claim: 'msp_pipeline_claim',
  graphReceipt: 'msp_pipeline_graph_receipt',
  writeReceipt: 'msp_pipeline_write_receipt',
  stageFailure: 'msp_pipeline_stage_failure',
  gate: 'msp_pipeline_gate',
  publicationReceipt: 'msp_pipeline_publication_receipt',
  evidence: 'msp_pipeline_evidence',
  query: 'msp_pipeline_query',
})
export const GENESIS_RAG17_EXTERNAL_STAGE_IDS = Object.freeze(
  KNOWLEDGE_INGESTION_STAGE_CATALOG
    .filter(({ sequence }) => sequence >= 90)
    .map(({ pipelineStageId }) => pipelineStageId),
)

const HASH_PATTERN = /^[a-f0-9]{64}$/i
const zNonEmptyString = z.string().min(1)
const zHash = z.string().regex(HASH_PATTERN, 'must be a SHA-256 hex digest')
const zDate = z.string().datetime({ offset: true })
const zScope = z.object({
  portfolioId: z.string(),
  tenantId: z.string(),
  businessId: z.string(),
  workspaceId: z.string(),
  agentId: z.string(),
  visibility: z.literal('private'),
}).strict()

export const zGenesisRag17Scope = zScope.superRefine((scope, ctx) => {
  for (const key of GENESIS_RAG17_SCOPE_KEYS) {
    if (typeof scope[key] !== 'string') continue
    if (scope[key].length > 500) ctx.addIssue({ code: z.ZodIssueCode.too_big, maximum: 500, type: 'string', inclusive: true, path: [key], message: `${key} is too long` })
  }
  for (const key of ['portfolioId', 'tenantId', 'businessId', 'visibility']) {
    if (!scope[key]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [key], message: `${key} is required` })
  }
})

export const zGenesisRag17StageIdentity = z.object({
  runId: zNonEmptyString,
  pipelineStageId: zNonEmptyString,
  executionStepId: zNonEmptyString,
  attemptId: zNonEmptyString,
  stageNumber: z.number().int().min(9).max(17),
}).strict()

export const zGenesisRag17Source = z.object({
  sourceId: zNonEmptyString,
  rawArtifactId: zNonEmptyString,
  parsedArtifactId: zNonEmptyString,
  documentId: zNonEmptyString,
  version: zNonEmptyString,
  contentHash: zHash,
  content: z.string().min(1),
}).strict()

export const zGenesisRag17Chunk = z.object({
  chunkId: zNonEmptyString,
  parsedArtifactId: zNonEmptyString,
  ordinal: z.number().int().nonnegative(),
  text: z.string(),
  contentHash: zHash,
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
}).strict()

export const zGenesisRag17Mention = z.object({
  sourceMentionId: zNonEmptyString,
  resolutionKey: zNonEmptyString,
  semanticType: zNonEmptyString,
  name: zNonEmptyString,
  chunkId: zNonEmptyString,
  startOffset: z.number().int().nonnegative(),
  endOffset: z.number().int().nonnegative(),
}).strict()

export const zGenesisRag17Policy = z.object({
  allowEmbedding: z.boolean(),
  allowPublication: z.boolean(),
}).strict()

export const zGenesisRag17Batch = z.object({
  schemaVersion: z.literal(GENESIS_RAG17_SCHEMA_VERSION),
  batchId: zNonEmptyString,
  idempotencyKey: zNonEmptyString,
  scope: zGenesisRag17Scope,
  runId: zNonEmptyString,
  stages: z.array(zGenesisRag17StageIdentity).length(9),
  source: zGenesisRag17Source,
  policy: zGenesisRag17Policy,
  chunks: z.array(zGenesisRag17Chunk).min(1),
  mentions: z.array(zGenesisRag17Mention),
}).strict()

export const GENESIS_RAG17_METRIC_KEYS = Object.freeze([
  'records_in',
  'records_out',
  'records_quarantined',
  'error_count',
  'retry_count',
  'duration_ms',
])

export const zGenesisRag17Metrics = z.object({
  records_in: z.number().int().nonnegative(),
  records_out: z.number().int().nonnegative(),
  records_quarantined: z.number().int().nonnegative(),
  error_count: z.number().int().nonnegative(),
  retry_count: z.number().int().nonnegative(),
  duration_ms: z.number().finite().nonnegative(),
}).strict()

export const zGenesisRag17EvidenceRow = z.object({
  cursor: z.number().int().positive(),
  schemaVersion: z.literal(GENESIS_RAG17_SCHEMA_VERSION),
  scope: zGenesisRag17Scope,
  runId: zNonEmptyString,
  pipelineStageId: zNonEmptyString,
  executionStepId: zNonEmptyString,
  attemptId: zNonEmptyString,
  stageNumber: z.number().int().min(9).max(17),
  outcome: z.enum(['SUCCEEDED', 'FAILED']),
  startedAt: zDate,
  finishedAt: zDate,
  metrics: zGenesisRag17Metrics,
  details: z.record(z.string(), z.unknown()),
}).strict()

export const zGenesisRag17EvidencePage = z.object({
  schemaVersion: z.literal(GENESIS_RAG17_SCHEMA_VERSION),
  scope: zGenesisRag17Scope,
  rows: z.array(zGenesisRag17EvidenceRow),
  nextCursor: z.number().int().nonnegative(),
}).strict()

export const zGenesisRag17Transaction = z.object({
  id: zNonEmptyString,
  frontier: zNonEmptyString,
  checkpoint: zNonEmptyString,
}).strict()

export const zGenesisRag17Readback = z.object({
  ok: z.boolean(),
  nodeCount: z.number().finite().nonnegative(),
  edgeCount: z.number().finite().nonnegative(),
  vectorCount: z.number().finite().nonnegative(),
  citationCount: z.number().finite().nonnegative(),
}).strict()

export const zGenesisRag17LaneStatus = z.object({
  status: z.enum(['ready', 'not_applicable', 'unsupported']),
  reason: z.string(),
  objects: z.number().int().nonnegative(),
}).strict()

export const zGenesisRag17LaneManifest = z.object({
  vector: zGenesisRag17LaneStatus,
  lexical: zGenesisRag17LaneStatus,
  graph: zGenesisRag17LaneStatus,
  sqlite: zGenesisRag17LaneStatus,
  bitemporal: zGenesisRag17LaneStatus,
  provenance: zGenesisRag17LaneStatus,
}).strict()

const zMetricMap = z.object({
  13: zGenesisRag17Metrics,
  15: zGenesisRag17Metrics,
  16: zGenesisRag17Metrics,
}).strict()
const zBenchmark = z.object({
  fixtureVersion: zNonEmptyString,
  queryCount: z.number().int().nonnegative(),
  recallAt5: z.number().finite().nonnegative(),
  mrr: z.number().finite().nonnegative(),
  citationCorrectness: z.number().finite().nonnegative(),
  crossTenantLeaks: z.number().int().nonnegative(),
}).strict()

export const zGenesisRag17WriteReceipt = z.object({
  schemaVersion: z.literal(GENESIS_RAG17_SCHEMA_VERSION),
  scope: zGenesisRag17Scope,
  runId: zNonEmptyString,
  decisionId: zNonEmptyString,
  decisionHash: zHash,
  stages: z.array(zGenesisRag17StageIdentity).length(9),
  snapshotId: zNonEmptyString,
  generation: zNonEmptyString,
  model: z.object({ id: z.literal('intfloat/multilingual-e5-small'), revision: z.literal('614241f622f53c4eeff9890bdc4f31cfecc418b3'), dimensions: z.literal(384), metric: z.literal('cosine'), artifactHashes: z.record(z.string(), zHash) }).strict(),
  transaction: zGenesisRag17Transaction,
  readback: zGenesisRag17Readback,
  laneManifest: zGenesisRag17LaneManifest,
  metrics: zMetricMap,
  benchmark: zBenchmark,
  graphReceiptHash: zHash,
  derivedHash: zHash,
  executionTimes: z.object({
    13: z.object({ startedAt: zDate, finishedAt: zDate }).strict(),
    15: z.object({ startedAt: zDate, finishedAt: zDate }).strict(),
    16: z.object({ startedAt: zDate, finishedAt: zDate }).strict(),
  }).strict(),
}).strict()

export const zGenesisRag17PublicationReceipt = z.object({
  schemaVersion: z.literal(GENESIS_RAG17_SCHEMA_VERSION),
  scope: zGenesisRag17Scope,
  runId: zNonEmptyString,
  decisionId: zNonEmptyString,
  decisionHash: zHash,
  snapshotId: zNonEmptyString,
  generation: zNonEmptyString,
  receiptHash: zHash,
  publishedAt: zDate,
  pointerHash: zHash,
  modelRevision: z.literal('614241f622f53c4eeff9890bdc4f31cfecc418b3'),
  transactionFrontier: zNonEmptyString,
  readback: z.object({ ok: z.literal(true) }).strict(),
}).strict()

export const zGenesisRag17QueryResponse = z.object({
  schemaVersion: z.literal(GENESIS_RAG17_SCHEMA_VERSION),
  scope: zGenesisRag17Scope,
  snapshotId: zNonEmptyString,
  generation: zNonEmptyString,
  results: z.array(z.object({
    id: zNonEmptyString,
    score: z.number().finite(),
    text: z.string(),
    citation: z.object({
      sourceId: zNonEmptyString,
      rawArtifactId: zNonEmptyString,
      parsedArtifactId: zNonEmptyString,
      chunkId: zNonEmptyString,
      contentHash: zHash,
    }).strict(),
  }).strict()),
}).strict()

export function canonicalGenesisRag17Json(value) {
  const stack = new Set()
  const encode = (current) => {
    if (current === null) return 'null'
    if (typeof current === 'string') return JSON.stringify(current)
    if (typeof current === 'boolean') return current ? 'true' : 'false'
    if (typeof current === 'number') {
      if (!Number.isFinite(current)) throw new TypeError('GenesisRAG17 JSON rejects non-finite numbers')
      return JSON.stringify(current)
    }
    if (typeof current !== 'object') throw new TypeError('GenesisRAG17 JSON value is not serializable')
    if (stack.has(current)) throw new TypeError('GenesisRAG17 JSON rejects cycles')
    stack.add(current)
    let result
    if (Array.isArray(current)) {
      result = `[${current.map((item) => encode(item)).join(',')}]`
    } else {
      const keys = Object.keys(current).sort()
      result = `{${keys.map((key) => `${JSON.stringify(key)}:${encode(current[key])}`).join(',')}}`
    }
    stack.delete(current)
    return result
  }
  return encode(value)
}

export function hashGenesisRag17Json(value) {
  return createHash('sha256').update(canonicalGenesisRag17Json(value), 'utf8').digest('hex')
}

export function hashGenesisRag17Text(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex')
}

export function parseGenesisRag17Scope(value) {
  return zGenesisRag17Scope.parse(value)
}

export function assertGenesisRag17BatchIntegrity(batch) {
  const parsed = zGenesisRag17Batch.parse(batch)
  if (parsed.source.contentHash !== hashGenesisRag17Text(parsed.source.content)) {
    throw new Error('GenesisRAG17 source contentHash does not match exact content')
  }
  const stageKeys = new Set()
  for (const stage of parsed.stages) {
    const expectedId = stageIdForNumber(stage.stageNumber)
    if (stage.pipelineStageId !== expectedId || stage.runId !== parsed.runId) {
      throw new Error('GenesisRAG17 batch stage identity does not match its stage number or run')
    }
    const key = `${stage.pipelineStageId}:${stage.executionStepId}:${stage.attemptId}`
    if (stageKeys.has(key)) throw new Error('GenesisRAG17 batch repeats a stage identity')
    stageKeys.add(key)
  }
  const chunkIds = new Set()
  let previousOrdinal = -1
  for (const chunk of parsed.chunks) {
    if (chunk.parsedArtifactId !== parsed.source.parsedArtifactId) throw new Error('GenesisRAG17 chunk parsedArtifactId does not match source')
    if (chunk.endOffset < chunk.startOffset || parsed.source.content.slice(chunk.startOffset, chunk.endOffset) !== chunk.text) {
      throw new Error('GenesisRAG17 chunk offsets do not identify an exact source substring')
    }
    if (chunk.contentHash !== hashGenesisRag17Text(chunk.text)) throw new Error('GenesisRAG17 chunk contentHash does not match exact text')
    if (chunkIds.has(chunk.chunkId) || chunk.ordinal <= previousOrdinal) throw new Error('GenesisRAG17 chunks must have unique increasing ordinals')
    chunkIds.add(chunk.chunkId)
    previousOrdinal = chunk.ordinal
  }
  const mentionIds = new Set()
  const chunksById = new Map(parsed.chunks.map((chunk) => [chunk.chunkId, chunk]))
  for (const mention of parsed.mentions) {
    const chunk = chunksById.get(mention.chunkId)
    if (!chunk || mention.endOffset < mention.startOffset || chunk.text.slice(mention.startOffset, mention.endOffset) !== mention.name) {
      throw new Error('GenesisRAG17 mention offsets do not identify the exact chunk occurrence')
    }
    if (mentionIds.has(mention.sourceMentionId)) throw new Error('GenesisRAG17 sourceMentionId must be unique')
    mentionIds.add(mention.sourceMentionId)
  }
  return parsed
}

export function stageIdForNumber(stageNumber) {
  if (!Number.isInteger(stageNumber) || stageNumber < 1 || stageNumber > 17) return null
  return KNOWLEDGE_INGESTION_STAGE_CATALOG.find(({ sequence }) => sequence / 10 === stageNumber)?.pipelineStageId || null
}

export function stageNumberForId(pipelineStageId) {
  const stage = KNOWLEDGE_INGESTION_STAGE_CATALOG.find((entry) => entry.pipelineStageId === pipelineStageId)
  return stage ? stage.sequence / 10 : null
}

export function buildGenesisRag17StageIdentities(runId, steps) {
  const byNumber = new Map()
  for (const step of steps || []) {
    const stageNumber = stageNumberForId(step.pipelineStageId)
    if (stageNumber < 9 || stageNumber > 17) continue
    if (byNumber.has(stageNumber)) throw new Error(`GenesisRAG17 run has duplicate Stage ${stageNumber}`)
    byNumber.set(stageNumber, {
      runId,
      pipelineStageId: step.pipelineStageId,
      executionStepId: step.executionStepId,
      attemptId: step.attemptId,
      stageNumber,
    })
  }
  const identities = []
  for (let stageNumber = 9; stageNumber <= 17; stageNumber++) {
    const identity = byNumber.get(stageNumber)
    if (!identity) throw new Error(`GenesisRAG17 run is missing Stage ${stageNumber}`)
    identities.push(identity)
  }
  return identities
}

export function assertGenesisRag17ScopeEqual(left, right) {
  const a = zGenesisRag17Scope.parse(left)
  const b = zGenesisRag17Scope.parse(right)
  for (const key of GENESIS_RAG17_SCOPE_KEYS) {
    if (a[key] !== b[key]) throw new Error(`GenesisRAG17 scope mismatch at ${key}`)
  }
  return a
}

export function validateGenesisRag17EvidencePage(page, { scope, runId, afterCursor = 0, limit = 100 } = {}) {
  const parsed = zGenesisRag17EvidencePage.parse(page)
  assertGenesisRag17ScopeEqual(parsed.scope, scope)
  if (parsed.rows.length > limit) throw new Error('GenesisRAG17 evidence page exceeds requested limit')
  let cursor = afterCursor
  const keys = new Set()
  for (const row of parsed.rows) {
    if (row.runId !== runId || row.cursor <= cursor) throw new Error('GenesisRAG17 evidence cursor or run id is invalid')
    if (new Date(row.finishedAt).valueOf() < new Date(row.startedAt).valueOf()) throw new Error('GenesisRAG17 evidence times are invalid')
    const key = `${row.pipelineStageId}:${row.executionStepId}:${row.attemptId}`
    if (keys.has(key)) throw new Error('GenesisRAG17 evidence page repeats a stage attempt')
    keys.add(key)
    cursor = row.cursor
  }
  if (parsed.nextCursor !== cursor) throw new Error('GenesisRAG17 evidence nextCursor does not follow the page')
  return parsed
}

export function parseGenesisRag17QueryResponse(value, scope) {
  const parsed = zGenesisRag17QueryResponse.parse(value)
  assertGenesisRag17ScopeEqual(parsed.scope, scope)
  return parsed
}

export { KNOWLEDGE_QUALITY_GATE_STAGE_ID }
