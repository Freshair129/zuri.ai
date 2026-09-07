import prisma from '@/lib/db'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'
import { createMspTransportFromEnvironment } from '@/modules/agent/msp-stdio-transport'
import { GENESIS_RAG17_SCHEMA_VERSION, parseGenesisRag17Scope, assertGenesisRag17ScopeEqual, zGenesisRag17QueryResponse } from '@/modules/knowledge/genesisrag17-contract'
import { resolveRuntimeCredential } from './genesisrag17-executor'

// @req FR-109 — resumable source dispatch and evidence polling through MSP.
// @req FR-110 — scoped published queries; external writes remain in Tier 4.
// @spec ADR-050, ADR-070
// @tested tests/acceptance/genesisrag17-e2e.test.js

function denied(message) { return Object.assign(new Error(message), { status: 403 }) }

/** Reads are never cached: an empty evidence page can grow later. */
export async function callGenesisRag17Worker({ operation, role = 'source', scope, request = {}, viewer, transport, env = process.env, credential } = {}) {
  if (!isInstallationOperator(viewer)) throw denied('GenesisRAG17 source worker requires an installation operator')
  if (role !== 'source' || !['evidence', 'query'].includes(operation)) throw denied('Tier 1 may only submit sources, pull evidence and query through MSP')
  const normalizedScope = parseGenesisRag17Scope(scope)
  const send = transport || createMspTransportFromEnvironment(env)
  const key = resolveRuntimeCredential({ scope: normalizedScope, role: 'source', env, credential })
  const response = await send(`msp_pipeline_${operation}`, { ...request, schemaVersion: GENESIS_RAG17_SCHEMA_VERSION, scope: normalizedScope, credential: key })
  if (response?.schemaVersion !== GENESIS_RAG17_SCHEMA_VERSION) throw new Error('MSP pipeline response version mismatch')
  assertGenesisRag17ScopeEqual(response.scope, normalizedScope)
  return { response }
}

export async function queryGenesisRag17({ scope, query, topK = 5, snapshotId, ...options } = {}) {
  if (typeof query !== 'string' || !query.trim() || query.length > 16000 || !Number.isSafeInteger(topK) || topK < 1 || topK > 100) throw new Error('Invalid GenesisRAG17 query')
  const { response } = await callGenesisRag17Worker({ ...options, operation: 'query', scope, request: { query, topK, ...(snapshotId ? { snapshotId } : {}) } })
  const result = zGenesisRag17QueryResponse.parse(response)
  if (snapshotId && result.snapshotId !== snapshotId) throw new Error('MSP returned another snapshot')
  return result
}

/** Retry the immutable Stage 9 outbox, retaining its original attempt/key. */
export async function resumeGenesisRag17Worker({ scope, runId, db = prisma, viewer, transport, env = process.env, credential } = {}) {
  if (!isInstallationOperator(viewer)) throw denied('GenesisRAG17 source worker requires an installation operator')
  const normalizedScope = parseGenesisRag17Scope(scope)
  const send = transport || createMspTransportFromEnvironment(env)
  const key = resolveRuntimeCredential({ scope: normalizedScope, role: 'source', env, credential })
  const rows = await db.genesisRag17Batch.findMany({ where: { ...(runId ? { executionRunId: runId } : {}), status: 'PENDING' }, orderBy: { createdAt: 'asc' } })
  const resumed = []
  for (const row of rows) {
    const batch = JSON.parse(row.requestJson)
    try { assertGenesisRag17ScopeEqual(batch.scope, normalizedScope) } catch { continue }
    const response = await send('msp_pipeline_submit', { schemaVersion: GENESIS_RAG17_SCHEMA_VERSION, scope: normalizedScope, credential: key, batch })
    assertGenesisRag17ScopeEqual(response.scope, normalizedScope)
    if (response.schemaVersion !== GENESIS_RAG17_SCHEMA_VERSION || response.batchId !== batch.batchId || !response.decisionId) throw new Error('MSP returned an invalid batch acknowledgement')
    await db.genesisRag17Batch.update({ where: { id: row.id }, data: { status: 'ACKNOWLEDGED', decisionId: response.decisionId, responseJson: JSON.stringify(response), updatedAt: new Date() } })
    resumed.push(row.batchId)
  }
  return { schemaVersion: GENESIS_RAG17_SCHEMA_VERSION, resumed }
}

/** A process-owned loop; stop awaits its current pass. */
export function createGenesisRag17SourceWorker(options) {
  let active = false, timer = null, inFlight = null
  const intervalMs = options.intervalMs ?? 1000
  if (!Number.isSafeInteger(intervalMs) || intervalMs < 10) throw new Error('Invalid source worker interval')
  async function runOnce() {
    if (inFlight) return inFlight
    inFlight = (async () => {
      await resumeGenesisRag17Worker(options)
      const db = options.db || prisma
      const rows = await db.genesisRag17Batch.findMany({ where: options.runId ? { executionRunId: options.runId } : {} })
      const { pullGenesisRag17Evidence } = await import('./genesisrag17-importer')
      const { finishKnowledgeIngestionRun } = await import('./knowledge-ingestion-executor')
      const results = []
      for (const row of rows) {
        try { assertGenesisRag17ScopeEqual(JSON.parse(row.scopeJson), options.scope) } catch { continue }
        const run = await db.pipelineRun.findUnique({ where: { executionRunId: row.executionRunId } })
        if (!run || !['QUEUED', 'RUNNING'].includes(run.status)) continue
        const imported = await pullGenesisRag17Evidence({ schemaVersion: GENESIS_RAG17_SCHEMA_VERSION, scope: options.scope, runId: row.executionRunId }, options)
        // Also resume a crash between the evidence/cursor commit and finalization.
        const terminal = await db.genesisRag17StageEvidence.findFirst({ where: { executionRunId: run.executionRunId, OR: [{ outcome: 'FAILED' }, { stageNumber: 17 }] } })
        if (terminal) {
          await finishKnowledgeIngestionRun({ dataPipelineDefinitionId: run.dataPipelineDefinitionId, executionContractId: run.executionContractId, executionRunId: run.executionRunId,
            scope: { tenantId: run.tenantId, businessId: run.businessId }, finishedAt: new Date().toISOString(),
          }, { db, viewer: options.viewer })
        }
        results.push(imported)
      }
      return results
    })()
    try { return await inFlight } finally { inFlight = null }
  }
  async function tick() {
    try { await runOnce() } catch (error) { options.onError?.(error) }
    if (active) timer = setTimeout(tick, intervalMs)
  }
  return { runOnce, start() { if (!active) { active = true; void tick() } }, async stop() { active = false; clearTimeout(timer); await inFlight } }
}
