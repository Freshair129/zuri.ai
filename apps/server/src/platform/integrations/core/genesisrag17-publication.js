import prisma from '@/lib/db'
import { GENESIS_RAG17_SCHEMA_VERSION, parseGenesisRag17Scope, assertGenesisRag17ScopeEqual, canonicalGenesisRag17Json, hashGenesisRag17Json, zGenesisRag17PublicationReceipt } from '@/modules/knowledge/genesisrag17-contract'
// @req FR-110 — exact attempt and authenticated publication proof before successful finish.
// @spec ADR-073, ADR-067
// @tested tests/acceptance/genesisrag17-e2e.test.js
function serviceError(status, message, code) { return Object.assign(new Error(message), { status, code }) }
function parseJson(value, fallback = null) { try { return JSON.parse(value) } catch { return fallback } }
function atDate(now) { return new Date(typeof now === 'function' ? now() : now) }
function ensureRunId(value) { if (typeof value !== 'string' || !value) throw serviceError(400, 'run identity required') }
export async function persistGenesisRag17PublicationReceipt(receipt, { db = prisma, now = () => new Date() } = {}) {
  const parsed = zGenesisRag17PublicationReceipt.parse(receipt)
  const run = await db.pipelineRun.findUnique({ where: { executionRunId: parsed.runId } })
  if (!run) throw serviceError(404, 'GenesisRAG17 publication receipt run not found')
  const scope = parseGenesisRag17Scope(parsed.scope)
  const business = await db.business.findUnique({ where: { id: scope.businessId }, select: { tenantId: true, status: true, tenant: { select: { portfolioId: true } } } })
  if (!business || business.status !== 'ACTIVE' || business.tenantId !== scope.tenantId || business.tenant?.portfolioId !== scope.portfolioId || run.id === null || run.tenantId !== scope.tenantId || run.businessId !== scope.businessId) throw serviceError(403, 'GenesisRAG17 publication receipt is outside the run scope', 'GENESISRAG17_SCOPE_DENIED')
  const receiptJson = canonicalGenesisRag17Json(parsed)
  const where = {
    executionRunId_decisionId_decisionHash_snapshotId_generation_receiptHash: {
      executionRunId: parsed.runId,
      decisionId: parsed.decisionId,
      decisionHash: parsed.decisionHash,
      snapshotId: parsed.snapshotId,
      generation: parsed.generation,
      receiptHash: parsed.receiptHash,
    },
  }
  const existing = await db.genesisRag17PublicationReceipt.findUnique({ where })
  if (existing) {
    if (existing.receiptJson !== receiptJson || existing.scopeJson !== canonicalGenesisRag17Json(scope)) throw serviceError(409, 'GenesisRAG17 publication identity was reused with different receipt', 'GENESISRAG17_PUBLICATION_CONFLICT')
    return { status: 'UNCHANGED', receipt: existing }
  }
  const at = atDate(now)
  const row = await db.genesisRag17PublicationReceipt.create({
    data: {
      id: `gpr_${hashGenesisRag17Json(parsed).slice(0, 48)}`,
      runId: run.id,
      executionRunId: parsed.runId,
      scopeJson: canonicalGenesisRag17Json(scope),
      decisionId: parsed.decisionId,
      decisionHash: parsed.decisionHash,
      snapshotId: parsed.snapshotId,
      generation: parsed.generation,
      receiptHash: parsed.receiptHash,
      publishedAt: new Date(parsed.publishedAt),
      pointerHash: parsed.pointerHash,
      modelRevision: parsed.modelRevision,
      transactionFrontier: parsed.transactionFrontier,
      readbackJson: canonicalGenesisRag17Json(parsed.readback),
      receiptJson,
      createdAt: at,
    },
  })
  return { status: 'CREATED', receipt: row }
}

export async function assertGenesisRag17Publication({ schemaVersion, executionRunId, scope } = {}, { db = prisma, viewer, now = () => new Date(), idFactory } = {}) {
  if (schemaVersion !== GENESIS_RAG17_SCHEMA_VERSION) throw serviceError(400, 'GenesisRAG17 finish requires schemaVersion genesisrag17.v1', 'GENESISRAG17_SCHEMA_REQUIRED')
  const normalizedScope = parseGenesisRag17Scope(scope)
  ensureRunId(executionRunId, 'executionRunId')
  const run = await db.pipelineRun.findUnique({ where: { executionRunId } })
  if (!run) throw serviceError(404, 'GenesisRAG17 pipeline run not found')
  if (run.tenantId !== normalizedScope.tenantId || run.businessId !== normalizedScope.businessId) throw serviceError(403, 'GenesisRAG17 finish scope does not match the pipeline run', 'GENESISRAG17_SCOPE_DENIED')
  const business = await db.business.findUnique({ where: { id: normalizedScope.businessId }, select: { tenantId: true, status: true, tenant: { select: { portfolioId: true } } } })
  if (!business || business.status !== 'ACTIVE' || business.tenantId !== normalizedScope.tenantId || business.tenant?.portfolioId !== normalizedScope.portfolioId) throw serviceError(403, 'GenesisRAG17 finish scope does not match the Business', 'GENESISRAG17_SCOPE_DENIED')
  const batch = await db.genesisRag17Batch.findFirst({ where: { executionRunId } })
  if (!batch) throw serviceError(409, 'GenesisRAG17 finish requires a persisted Stage 9 batch', 'GENESISRAG17_FINISH_PREREQUISITE_MISSING')
  const batchValue = parseJson(batch.requestJson)
  if (!batchValue) throw serviceError(409, 'GenesisRAG17 batch request is unreadable', 'GENESISRAG17_FINISH_PREREQUISITE_MISSING')
  assertGenesisRag17ScopeEqual(batchValue.scope, normalizedScope)
  const response = parseJson(batch.responseJson, {})
  const decisionId = batch.decisionId || response.decisionId
  if (!decisionId) throw serviceError(409, 'GenesisRAG17 finish requires an MSP decision', 'GENESISRAG17_FINISH_PREREQUISITE_MISSING')
  const steps = await db.pipelineStep.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } })
  const evidence = await db.genesisRag17StageEvidence.findMany({ where: { executionRunId } })
  const byStepIdentity = new Map(evidence.map((row) => [`${row.pipelineStageId}:${row.executionStepId}:${row.attemptId}`, row]))
  const missing = []
  const mismatched = []
  for (const step of steps) {
    const row = byStepIdentity.get(`${step.pipelineStageId}:${step.executionStepId}:${step.attemptId}`)
    if (!row) { missing.push(step.pipelineStageId); continue }
    if (row.outcome !== 'SUCCEEDED') mismatched.push(`${step.pipelineStageId}:FAILED`)
  }
  const stage17 = steps.find((step) => step.pipelineStageId === 'DPS-KI-QUALITY-GATE')
  const stage17Evidence = stage17 ? byStepIdentity.get(`${stage17.pipelineStageId}:${stage17.executionStepId}:${stage17.attemptId}`) : null
  let publication = null
  if (stage17Evidence) {
    const details = parseJson(stage17Evidence.detailsJson, {})
    if (details.verdict?.verdict !== 'PASS' || !details.publicationReceipt) mismatched.push('DPS-KI-QUALITY-GATE:PUBLICATION_RECEIPT_REQUIRED')
    else {
      publication = zGenesisRag17PublicationReceipt.safeParse(details.publicationReceipt)
      if (!publication.success) mismatched.push('DPS-KI-QUALITY-GATE:PUBLICATION_RECEIPT_INVALID')
      else {
        if (publication.data.runId !== executionRunId || publication.data.decisionId !== decisionId) mismatched.push('DPS-KI-QUALITY-GATE:PUBLICATION_IDENTITY_MISMATCH')
        else if (publication.data.scope.portfolioId !== normalizedScope.portfolioId || publication.data.scope.tenantId !== normalizedScope.tenantId || publication.data.scope.businessId !== normalizedScope.businessId || publication.data.scope.workspaceId !== normalizedScope.workspaceId || publication.data.scope.agentId !== normalizedScope.agentId || publication.data.scope.visibility !== normalizedScope.visibility) mismatched.push('DPS-KI-QUALITY-GATE:PUBLICATION_SCOPE_MISMATCH')
      }
    }
  }
  if (missing.length || mismatched.length || !publication) {
    const details = [...missing.map((stage) => `${stage}:EVIDENCE_MISSING`), ...mismatched]
    const error = serviceError(409, 'GenesisRAG17 finish requires matching terminal evidence and publication receipt', 'GENESISRAG17_FINISH_PREREQUISITE_MISSING')
    error.details = details
    throw error
  }
  const stored = await db.genesisRag17PublicationReceipt.findFirst({ where: { executionRunId, decisionId: publication.data.decisionId, decisionHash: publication.data.decisionHash, snapshotId: publication.data.snapshotId, generation: publication.data.generation, receiptHash: publication.data.receiptHash } })
  if (!stored || stored.receiptJson !== canonicalGenesisRag17Json(publication.data)) {
    throw serviceError(409, 'GenesisRAG17 finish requires the matching locally persisted publication receipt', 'GENESISRAG17_PUBLICATION_RECEIPT_REQUIRED')
  }
  return publication.data
}
