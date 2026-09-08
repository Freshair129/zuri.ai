import { hasKnowledgeScopeAuthority } from '@/modules/knowledge/knowledge-execution-authority'
import prisma from '@/lib/db'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'
import { recordPipelineEvent } from './pipeline-tracking-service'
import { zKnowledgeStage17Evidence } from './pipeline-tracking-contract'
import { writeStageEvidence } from './genesisrag17-executor'
import {
  GENESIS_RAG17_SCHEMA_VERSION,
  assertGenesisRag17ScopeEqual,
  hashGenesisRag17Json,
  parseGenesisRag17Scope,
  stageNumberForId,
  validateGenesisRag17EvidencePage,
  zGenesisRag17PublicationReceipt,
} from '@/modules/knowledge/genesisrag17-contract'
import { callGenesisRag17Worker } from './genesisrag17-worker'
import { persistGenesisRag17PublicationReceipt } from './genesisrag17-publication'

// @req FR-172 — only the exact admitted knowledge run accepts private runtime authority.
// @req FR-110 — Tier 1 pulls immutable Stage 9–17 evidence through MSP,
// applies it to the exact run/step/attempt identity and advances a per-run
// cursor only after the local evidence and ledger writes commit.
// @req FR-109 — late evidence for an older attempt cannot close or mutate a
// newer attempt; Tier 1 stores aggregate metrics/details only.
// @spec ADR-050 D3-D4, ADR-067, ADR-068, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/integration/genesisrag17-tier1.test.js

const EXTERNAL_MIN_STAGE = 9
const EXTERNAL_MAX_STAGE = 17
const DEFAULT_LIMIT = 100
const MAX_LIMIT = 100
const DEFAULT_MAX_PAGES = 10

function serviceError(status, message, code = null) {
  const error = new Error(message)
  error.status = status
  if (code) error.code = code
  return error
}

function atDate(now) {
  const value = typeof now === 'function' ? now() : now || new Date()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.valueOf())) throw new Error('GenesisRAG17 now must resolve to a valid Date')
  return date
}

function parseJson(value, fallback = null) {
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

function scopeCursorWhere(scope, runId) {
  return {
    runId,
    portfolioId: scope.portfolioId,
    tenantId: scope.tenantId,
    businessId: scope.businessId,
    workspaceId: scope.workspaceId,
    agentId: scope.agentId,
    visibility: scope.visibility,
  }
}

function cursorId(scope, runId) {
  return `gcur_${hashGenesisRag17Json({ runId, scope }).slice(0, 48)}`
}

async function assertRunScope(db, run, scope) {
  if (!run || run.executionRunId === undefined) throw serviceError(404, 'GenesisRAG17 pipeline run not found')
  if (run.tenantId !== scope.tenantId || run.businessId !== scope.businessId) throw serviceError(403, 'GenesisRAG17 evidence run is outside the requested scope', 'GENESISRAG17_SCOPE_DENIED')
  const business = await db.business.findUnique({ where: { id: scope.businessId }, select: { tenantId: true, status: true, tenant: { select: { portfolioId: true } } } })
  if (!business || business.status !== 'ACTIVE' || business.tenantId !== scope.tenantId || business.tenant?.portfolioId !== scope.portfolioId) throw serviceError(403, 'GenesisRAG17 evidence scope does not match the Business', 'GENESISRAG17_SCOPE_DENIED')
}

async function assertBatchScope(db, run, scope) {
  const batch = await db.genesisRag17Batch.findFirst({ where: { executionRunId: run.executionRunId } })
  if (!batch) throw serviceError(409, 'GenesisRAG17 evidence requires a persisted Stage 9 batch', 'GENESISRAG17_BATCH_REQUIRED')
  const request = parseJson(batch.requestJson)
  if (!request?.scope) throw serviceError(409, 'GenesisRAG17 batch scope is unreadable', 'GENESISRAG17_BATCH_REQUIRED')
  assertGenesisRag17ScopeEqual(request.scope, scope)
  return { batch, request }
}

function eventIdentityRefs(run) {
  const refs = parseJson(run.identityRefsJson, {})
  return refs && typeof refs === 'object' && !Array.isArray(refs) ? refs : {
    nodeIds: [], edgeIds: [], artifactIds: [], contractIds: [], meetingIds: [], callIds: [], followupIds: [], reqIds: [], verifyIds: [], gateIds: [], integrationId: null, graphId: null, workflowContractId: null, workflowId: null, runbookIds: [], promotionIds: [], skillIds: [], toolIds: [],
  }
}

function ledgerEvent(run, step, row, eventType, at, error = null) {
  const failed = eventType === 'STEP_FAILED'
  return {
    eventType,
    dataPipelineDefinitionId: run.dataPipelineDefinitionId,
    executionContractId: run.executionContractId,
    executionRunId: run.executionRunId,
    pipelineStageId: step.pipelineStageId,
    executionStepId: step.executionStepId,
    attemptId: step.attemptId,
    pipelineRecordId: null,
    sourceRecordKey: null,
    sourceRowNumber: null,
    sourceSha256: run.sourceSha256,
    docId: null,
    picId: null,
    factId: null,
    sourceDocIds: [],
    sourcePicIds: [],
    destinationRecordId: null,
    sequence: step.sequence,
    status: failed ? 'FAILED' : eventType === 'STEP_STARTED' ? 'RUNNING' : 'SUCCEEDED',
    correlationId: `ki17:${run.executionRunId}`,
    idempotencyKey: `ki17:${run.executionRunId}:${step.pipelineStageId}:${step.executionStepId}:${step.attemptId}:${eventType.toLowerCase()}`,
    inputHash: null,
    outputHash: ['STEP_SUCCEEDED', 'STEP_FAILED'].includes(eventType) ? hashGenesisRag17Json({ metrics: row.metrics, details: row.details, outcome: row.outcome }) : null,
    ...(['STEP_SUCCEEDED', 'STEP_FAILED'].includes(eventType) ? { actualCount: row.metrics.records_in, insertedCount: row.metrics.records_out, failedCount: row.metrics.error_count } : {}),
    tagIds: [],
    identityRefs: eventIdentityRefs(run),
    failureCode: failed ? String(error?.code || error?.message || 'GENESISRAG17_EXTERNAL_STAGE_FAILED').replace(/[^A-Za-z0-9._:/#@-]/g, '_').slice(0, 200) : null,
    errorRef: failed ? `ki17://evidence/${row.cursor}` : null,
    retryable: failed ? false : null,
    reconciliation: null,
    gate: null,
  }
}

function rowMetrics(row) {
  return {
    records_in: row.metrics.records_in,
    records_out: row.metrics.records_out,
    records_quarantined: row.metrics.records_quarantined,
    error_count: row.metrics.error_count,
    retry_count: row.metrics.retry_count,
    duration_ms: row.metrics.duration_ms,
  }
}

function rowStage(row, step, run) {
  const stageNumber = stageNumberForId(row.pipelineStageId)
  if (stageNumber !== row.stageNumber || stageNumber < EXTERNAL_MIN_STAGE || stageNumber > EXTERNAL_MAX_STAGE) throw serviceError(409, 'GenesisRAG17 evidence stage number does not match the catalog identity', 'GENESISRAG17_EVIDENCE_IDENTITY_INVALID')
  if (!step || step.runId !== run.id || step.pipelineStageId !== row.pipelineStageId || step.executionStepId !== row.executionStepId || step.attemptId !== row.attemptId) throw serviceError(409, 'GenesisRAG17 evidence does not match the exact current run step attempt', 'GENESISRAG17_EVIDENCE_ATTEMPT_MISMATCH')
  return { pipelineStageId: step.pipelineStageId, executionStepId: step.executionStepId, attemptId: step.attemptId, sequence: step.sequence }
}

function stage17Publication(row, scope, runId) {
  if (row.stageNumber !== 17) return null
  if (row.outcome !== 'SUCCEEDED') return null
  if (!row.details || row.details.verdict?.verdict !== 'PASS' || !row.details.publicationReceipt) throw serviceError(409, 'GenesisRAG17 Stage 17 evidence requires a passing verdict and publicationReceipt', 'GENESISRAG17_PUBLICATION_RECEIPT_REQUIRED')
  const parsed = zGenesisRag17PublicationReceipt.parse(row.details.publicationReceipt)
  if (parsed.runId !== runId) throw serviceError(409, 'GenesisRAG17 publication receipt run identity does not match evidence', 'GENESISRAG17_PUBLICATION_IDENTITY_MISMATCH')
  assertGenesisRag17ScopeEqual(parsed.scope, scope)
  const verdict = row.details.verdict
  for (const key of ['runId', 'decisionId', 'decisionHash', 'snapshotId', 'generation', 'receiptHash']) if (verdict[key] !== parsed[key]) throw serviceError(409, 'Publication receipt does not match the GKS quality verdict')
  assertGenesisRag17ScopeEqual(verdict.scope, scope)
  return parsed
}

function qualityGateEvidence(row, publication, scope) {
  const verdict = row.details?.verdict
  if (!verdict?.dimensions) throw serviceError(409, 'Stage 17 requires GKS quality dimensions')
  // GKS separates quality from publication permission. Its original verdict
  // remains in the immutable row; the legacy gate combines both decisions.
  const policyHeld = row.outcome === 'FAILED' && verdict.allowPublication === false && ['PASS', 'WARN'].includes(verdict.verdict)
  return zKnowledgeStage17Evidence.parse({
    verdict: policyHeld ? 'QUARANTINE' : verdict.verdict === 'WARN' ? 'PASS_WITH_WARNINGS' : verdict.verdict,
    dimensions: Object.fromEntries(Object.entries(verdict.dimensions).map(([key, value]) => [key, { result: value.result, critical: value.critical }])),
    snapshot: publication ? {
      knowledge_snapshot_id: publication.snapshotId, tenant_id: scope.tenantId, business_id: scope.businessId,
      ontology_version: verdict.ontologyVersion, pipeline_version: verdict.pipelineVersion,
      published_at: publication.publishedAt, statistics: verdict.statistics,
    } : null,
  })
}

async function resolveRows(db, run, batchRequest, rows) {
  const steps = await db.pipelineStep.findMany({ where: { runId: run.id } })
  const byExecutionStepId = new Map(steps.map((step) => [step.executionStepId, step]))
  const batchStages = new Map((batchRequest.stages || []).map((stage) => [stage.stageNumber, stage]))
  const resolved = []
  for (const row of rows) {
    const step = byExecutionStepId.get(row.executionStepId)
    rowStage(row, step, run)
    const batchStage = batchStages.get(row.stageNumber)
    if (!batchStage || batchStage.runId !== row.runId || batchStage.pipelineStageId !== row.pipelineStageId || batchStage.executionStepId !== row.executionStepId || batchStage.attemptId !== row.attemptId) throw serviceError(409, 'GenesisRAG17 evidence does not match the Stage 9 batch attempt identities', 'GENESISRAG17_EVIDENCE_ATTEMPT_MISMATCH')
    resolved.push({ row, step })
  }
  return resolved
}

async function applyRows(db, run, scope, resolved, now, viewer) {
  const applied = []
  for (const { row, step } of resolved) {
    const startedAt = new Date(row.startedAt)
    const finishedAt = new Date(row.finishedAt)
    const details = row.details || {}
    const publication = stage17Publication(row, scope, run.executionRunId)
    const terminal = async (tx) => {
      await recordPipelineEvent(ledgerEvent(run, step, row, 'STEP_STARTED', startedAt), { db: tx, viewer, now: () => startedAt })
      if (row.stageNumber === 17 && row.details?.verdict) {
        const status = publication ? 'APPROVED' : 'REJECTED'
        await recordPipelineEvent({ ...ledgerEvent(run, step, row, 'GATE_UPDATED', finishedAt), status, tenantId: run.tenantId, businessId: run.businessId,
          gate: { gateId: 'GATE-KNOWLEDGE-QUALITY', status, required: true, decidedByPersonId: null, reason: `Stage 17 verdict ${row.details.verdict.verdict}`, evidence: qualityGateEvidence(row, publication, scope) },
        }, { db: tx, viewer, now: () => finishedAt })
      }
      await recordPipelineEvent(ledgerEvent(run, step, row, row.outcome === 'FAILED' ? 'STEP_FAILED' : 'STEP_SUCCEEDED', finishedAt, row.outcome === 'FAILED' ? details : null), { db: tx, viewer, now: () => finishedAt })
      if (publication) await persistGenesisRag17PublicationReceipt(publication, { db: tx, now: () => finishedAt })
      const evidence = await writeStageEvidence(tx, {
        run,
        identity: run.executionRunId,
        stage: step,
        stageNumber: row.stageNumber,
        startedAt,
        finishedAt,
        metrics: rowMetrics(row),
        details,
        outcome: row.outcome,
        cursor: row.cursor,
      })
      return evidence
    }
    const evidence = typeof db.$transaction === 'function' ? await db.$transaction(terminal) : await terminal(db)
    applied.push({ cursor: row.cursor, stageNumber: row.stageNumber, pipelineStageId: row.pipelineStageId, executionStepId: row.executionStepId, attemptId: row.attemptId, outcome: row.outcome, status: evidence ? 'CREATED_OR_UNCHANGED' : 'UNCHANGED' })
  }
  return applied
}

/**
 * Pull one or more bounded evidence pages through MSP. Every row is resolved
 * by its exact executionStepId and attemptId; no stage-level latest fallback is
 * permitted. A malformed or late row throws before any row in that page is
 * written, leaving the durable cursor at its prior value.
 */
export async function pullGenesisRag17Evidence({ schemaVersion, scope, runId, afterCursor, limit = DEFAULT_LIMIT, maxPages = DEFAULT_MAX_PAGES } = {}, {
  db = prisma,
  viewer,
  transport = null,
  env = process.env,
  credential = null,
  now = () => new Date(),
} = {}) {
  if (!isInstallationOperator(viewer) && !hasKnowledgeScopeAuthority(viewer, scope)) throw serviceError(403, 'GenesisRAG17 evidence pull requires scoped runtime authority')
  if (schemaVersion !== GENESIS_RAG17_SCHEMA_VERSION) throw serviceError(400, 'GenesisRAG17 evidence pull requires schemaVersion genesisrag17.v1', 'GENESISRAG17_SCHEMA_REQUIRED')
  const normalizedScope = parseGenesisRag17Scope(scope)
  if (typeof runId !== 'string' || !runId.trim()) throw serviceError(400, 'GenesisRAG17 evidence pull requires runId', 'GENESISRAG17_RUN_ID_REQUIRED')
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) throw serviceError(400, 'GenesisRAG17 evidence pull limit is invalid', 'GENESISRAG17_LIMIT_INVALID')
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 100) throw serviceError(400, 'GenesisRAG17 evidence pull maxPages is invalid', 'GENESISRAG17_LIMIT_INVALID')
  const run = await db.pipelineRun.findUnique({ where: { executionRunId: runId } })
  await assertRunScope(db, run, normalizedScope)
  const { batch, request: batchRequest } = await assertBatchScope(db, run, normalizedScope)
  const cursorRow = await db.genesisRag17EvidenceCursor.findUnique({ where: { runId_portfolioId_tenantId_businessId_workspaceId_agentId_visibility: scopeCursorWhere(normalizedScope, runId) } })
  let cursor = afterCursor === undefined ? (cursorRow?.cursor || 0) : afterCursor
  if (!Number.isSafeInteger(cursor) || cursor < 0) throw serviceError(400, 'GenesisRAG17 evidence afterCursor is invalid', 'GENESISRAG17_CURSOR_INVALID')
  if (cursor > (cursorRow?.cursor || 0)) throw serviceError(409, 'Cannot advance past evidence that has not been durably imported', 'GENESISRAG17_CURSOR_AHEAD')
  const startCursor = cursor
  const applied = []
  let pages = 0
  let lastResponse = null
  for (; pages < maxPages;) {
    const pageResult = await callGenesisRag17Worker({
      operation: 'evidence',
      role: 'source',
      scope: normalizedScope,
      request: { runId, afterCursor: cursor, limit },
      db,
      viewer,
      transport,
      env,
      credential,
      now,
      storeResponse: true,
    })
    const page = validateGenesisRag17EvidencePage(pageResult.response, { scope: normalizedScope, runId, afterCursor: cursor, limit })
    lastResponse = page
    pages += 1
    const resolved = await resolveRows(db, run, batchRequest, page.rows)
    const nextCursor = page.nextCursor
    const at = atDate(now)
    const updateCursor = async (tx) => tx.genesisRag17EvidenceCursor.upsert({
      where: { runId_portfolioId_tenantId_businessId_workspaceId_agentId_visibility: scopeCursorWhere(normalizedScope, runId) },
      create: { id: cursorId(normalizedScope, runId), ...scopeCursorWhere(normalizedScope, runId), cursor: nextCursor, lastPulledAt: at, createdAt: at, updatedAt: at },
      update: { cursor: nextCursor, lastPulledAt: at, updatedAt: at },
    })
    const commitPage = async (tx) => {
      const result = await applyRows(tx, run, normalizedScope, resolved, now, viewer)
      await updateCursor(tx)
      return result
    }
    const pageApplied = typeof db.$transaction === 'function' ? await db.$transaction(commitPage) : await commitPage(db)
    applied.push(...pageApplied)
    cursor = nextCursor
    if (!page.rows.length || page.rows.length < limit) break
  }
  return {
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    scope: normalizedScope,
    runId,
    batchId: batch.batchId,
    startCursor,
    cursor,
    pages,
    applied,
    nextCursor: lastResponse?.nextCursor ?? cursor,
  }
}

export { rowMetrics, rowStage }
