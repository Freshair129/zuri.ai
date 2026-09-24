import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'
import { createKnowledgeExecutionAuthority, hasKnowledgeScopeAuthority, hasKnowledgeRunAuthority } from '@/modules/knowledge/knowledge-execution-authority'
import { resolveKnowledgeRuntimeBinding, createKnowledgeAdmissionRuntime } from '@/modules/knowledge/knowledge-runtime'
import { withdrawKnowledgeSource } from '@/modules/knowledge/knowledge-corpus-service'
import { ingestGenesisRag17Raw } from '@/platform/integrations/core/genesisrag17-executor'
import { createPipelineRun, requestPipelineReplay, getPipelineMonitor } from '@/platform/integrations/core/pipeline-tracking-service'
import { KNOWLEDGE_INGESTION_DEFINITION_ID } from '@/platform/integrations/core/pipeline-tracking-contract'
import { hashGenesisRag17Text } from '@/modules/knowledge/genesisrag17-contract'

// @req FR-173 — scope-bound authority, durable run attachment, lease recovery and no false publication.
// @spec ADR-072, SEC-003
// @tested tests/unit/knowledge-runtime.test.js
const scope = { portfolioId: 'p', tenantId: 't', businessId: 'b', workspaceId: '', agentId: '', visibility: 'private' }
const environment = (value = scope) => ({ ZURI_KNOWLEDGE_ENABLED: '1', ZURI_KNOWLEDGE_BINDINGS: JSON.stringify([{ scope: value, policy: { allowEmbedding: true, allowPublication: true } }]), MSP_PIPELINE_PRINCIPALS: JSON.stringify([{ role: 'source', scope: value, credential: 'isolated-source-key' }]), ZURI_MSP_COMMAND: process.execPath })

describe('knowledge runtime authority', () => {
  it('cannot be serialized, cloned, used for another scope or mistaken for an operator', () => {
    const authority = createKnowledgeExecutionAuthority(scope)
    expect(isInstallationOperator(authority)).toBe(false)
    expect(hasKnowledgeScopeAuthority(authority, scope)).toBe(true)
    expect(hasKnowledgeScopeAuthority(JSON.parse(JSON.stringify(authority)), scope)).toBe(false)
    expect(hasKnowledgeScopeAuthority({ ...authority }, scope)).toBe(false)
    expect(hasKnowledgeScopeAuthority(authority, { ...scope, agentId: 'other' })).toBe(false)
    expect(hasKnowledgeScopeAuthority(authority, scope, 'query')).toBe(false)
    expect(hasKnowledgeRunAuthority(authority, { dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID, businessId: 'b', tenantId: 'other' })).toBe(false)
    const resumed = createKnowledgeExecutionAuthority(scope, 'execute', 'run-1')
    const run = { dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID, businessId: 'b', tenantId: 't', executionRunId: 'run-1' }
    expect(hasKnowledgeRunAuthority(resumed, run)).toBe(true)
    expect(hasKnowledgeRunAuthority(resumed, { ...run, executionRunId: 'another-run-in-same-business' })).toBe(false)
  })

  it('does not grant raw execution to an ordinary owner or query-only capability', async () => {
    const owner = makeViewer({ visibleBusinessIds: ['b'], ownedBusinessIds: ['b'] })
    for (const viewer of [owner, createKnowledgeExecutionAuthority(scope, 'query')]) {
      await expect(ingestGenesisRag17Raw({ scope }, { viewer })).rejects.toMatchObject({ status: 403 })
    }
    await expect(createPipelineRun({ businessId: 'b', dataPipelineDefinitionId: 'unrelated' }, { viewer: createKnowledgeExecutionAuthority(scope) })).rejects.toMatchObject({ status: 403 })
    await expect(requestPipelineReplay({}, { viewer: createKnowledgeExecutionAuthority(scope) })).rejects.toMatchObject({ status: 403 })
  })

  it('requires an enabled exact runtime profile, source principal and permitted policy', async () => {
    const db = { business: { findUnique: vi.fn(async () => ({ id: 'b', status: 'ACTIVE', tenantId: 't', tenant: { portfolioId: 'p' } })) } }
    expect(await resolveKnowledgeRuntimeBinding({ businessId: 'b' }, { db, env: environment() })).toEqual({ scope, policy: { allowEmbedding: true, allowPublication: true } })
    for (const env of [{}, { ...environment(), MSP_PIPELINE_PRINCIPALS: '[]' }, { ...environment(), ZURI_MSP_COMMAND: '' }, { ...environment(), ZURI_KNOWLEDGE_BINDINGS: JSON.stringify([{ scope, policy: { allowEmbedding: false, allowPublication: true } }]) }]) {
      await expect(resolveKnowledgeRuntimeBinding({ businessId: 'b' }, { db, env })).rejects.toMatchObject({ status: 503, code: 'KNOWLEDGE_RUNTIME_UNAVAILABLE' })
    }
  })
})

async function durableJob({ sourceKind = 'TEXT', sourceMetaJson = '{}' } = {}) {
  const suffix = randomUUID().slice(0, 8)
  const portfolio = await createPortfolio({ name: `Runtime ${suffix}`, code: `PF-KRT-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Runtime tenant', code: `TN-KRT-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: 'Runtime business', code: `BU-KRT-${suffix}` })
  const actualScope = { ...scope, portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id }
  const corpus = await prisma.knowledgeCorpus.create({ data: { corpusKey: suffix, portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, scopeJson: JSON.stringify(actualScope), policyJson: JSON.stringify({ allowEmbedding: true, allowPublication: true }) } })
  const source = await prisma.knowledgeSource.create({ data: { corpusId: corpus.id, sourceKey: suffix, kind: sourceKind, title: 'Runtime source', desiredRevision: 1 } })
  const content = '# Employment\n\nAlice works for Acme Ltd.\n\n# Purchase\n\nAlice purchased Atlas.'
  const job = await prisma.knowledgeIngestion.create({ data: { corpusId: corpus.id, sourceId: source.id, revision: 1, sourceVersion: '1', content, contentHash: hashGenesisRag17Text(content), sourceMetaJson, idempotencyKey: suffix, requestHash: hashGenesisRag17Text(suffix) } })
  return { corpus, source, job, actualScope, env: environment(actualScope) }
}

describe('knowledge durable queue', () => {
  it('atomically attaches its real pipeline run before reply loss and resumes that run after restart', async () => {
    const fixture = await durableJob()
    const publish = vi.fn()
    const transport = vi.fn(async () => { throw new Error('simulated reply loss after local work') })
    const runtime = createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, transport, publish })
    await runtime.runOnce()
    const lost = await prisma.knowledgeIngestion.findUnique({ where: { id: fixture.job.id } })
    expect(lost.executionRunId).toEqual(expect.any(String))
    expect(lost.rawArtifactId).toEqual(expect.any(String))
    expect(lost.status).toBe('RUNNING')
    expect(lost.claimToken).toBeNull()
    await expect(getPipelineMonitor(lost.executionRunId, { db: prisma, viewer: createKnowledgeExecutionAuthority(fixture.actualScope, 'execute', 'unrelated-run') })).rejects.toMatchObject({ status: 404 })
    expect((await getPipelineMonitor(lost.executionRunId, { db: prisma, viewer: createKnowledgeExecutionAuthority(fixture.actualScope, 'execute', lost.executionRunId) })).run.executionRunId).toBe(lost.executionRunId)
    const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: lost.executionRunId } })
    expect(evidence).toHaveLength(8)
    const pending = await prisma.genesisRag17Batch.findFirst({ where: { executionRunId: lost.executionRunId } })
    const acknowledged = vi.fn(async (name, request) => {
      if (name === 'msp_pipeline_submit') return { schemaVersion: 'genesisrag17.v1', scope: request.scope, batchId: request.batch.batchId, decisionId: 'isolated-pending-decision', status: 'PENDING' }
      throw new Error('No remote evidence in this focused test')
    })
    const restarted = createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, transport: acknowledged, publish })
    await restarted.runOnce()
    const resumed = await prisma.knowledgeIngestion.findUnique({ where: { id: fixture.job.id } })
    expect(resumed.executionRunId).toBe(lost.executionRunId)
    expect(resumed.status).toBe('RUNNING')
    expect(await prisma.pipelineRun.count({ where: { businessId: fixture.corpus.businessId } })).toBe(1)
    expect(await prisma.genesisRag17StageEvidence.count({ where: { executionRunId: lost.executionRunId } })).toBe(8)
    expect(acknowledged.mock.calls[0][1].batch.idempotencyKey).toBe(JSON.parse(pending.requestJson).idempotencyKey)
    expect(publish).not.toHaveBeenCalled()
    expect(await prisma.knowledgeCorpusGeneration.count({ where: { corpusId: fixture.corpus.id } })).toBe(0)
  })

  it('does not execute a leased job, then resumes after the lease expires', async () => {
    const fixture = await durableJob()
    const clock = new Date('2026-09-08T10:00:00Z')
    await prisma.knowledgeIngestion.update({ where: { id: fixture.job.id }, data: { status: 'RUNNING', claimToken: 'dead-process', leaseExpiresAt: new Date(clock.getTime() + 1000) } })
    const ingest = vi.fn(async () => { throw new Error('retryable transport failure') })
    const runtime = createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, now: () => clock, ingest })
    await runtime.runOnce()
    expect(ingest).not.toHaveBeenCalled()
    clock.setTime(clock.getTime() + 2000)
    await runtime.runOnce()
    expect(ingest).toHaveBeenCalledTimes(1)
    expect((await prisma.knowledgeIngestion.findUnique({ where: { id: fixture.job.id } })).claimToken).toBeNull()
  })

  it('does not execute a superseded or withdrawn source', async () => {
    const fixture = await durableJob()
    await prisma.knowledgeSource.update({ where: { id: fixture.source.id }, data: { revokedAt: new Date() } })
    const ingest = vi.fn()
    await createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, ingest }).runOnce()
    expect(ingest).not.toHaveBeenCalled()
    expect((await prisma.knowledgeIngestion.findUnique({ where: { id: fixture.job.id } })).status).toBe('WITHDRAWN')
  })

  // @req FR-173 — a job resumed after restart may already own a real FR-071
  // PipelineRun; discovering the job SUPERSEDED or WITHDRAWN must close that
  // run, not just the KnowledgeIngestion row, or it is orphaned forever
  // (production found exactly this: run 1db6810c-eb86-4e96-9f4c-e9c89c8ba0d3,
  // RUNNING since 2026-09-21 with a PENDING batch and a RUNNING intent).
  async function pendingBatchRun(fixture) {
    // Tier 1 completes locally and the run is left waiting on the first
    // external stage (Stage 9), acknowledged PENDING — the same shape as the
    // stuck production run — without ever touching that batch's own request.
    const transport = vi.fn(async (name, request) => {
      if (name === 'msp_pipeline_submit') return { schemaVersion: 'genesisrag17.v1', scope: request.scope, batchId: request.batch.batchId, decisionId: null, status: 'PENDING' }
      throw new Error('No remote evidence in this focused test')
    })
    const runtime = createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, transport })
    await runtime.runOnce()
    const stuck = await prisma.knowledgeIngestion.findUnique({ where: { id: fixture.job.id } })
    expect(stuck.executionRunId).toEqual(expect.any(String))
    expect((await prisma.pipelineRun.findUnique({ where: { executionRunId: stuck.executionRunId } })).status).toBe('RUNNING')
    const pendingBatch = await prisma.genesisRag17Batch.findFirst({ where: { executionRunId: stuck.executionRunId } })
    expect(pendingBatch.status).toBe('PENDING')
    return { stuck, transport, pendingBatch }
  }

  it('closes the orphaned PipelineRun when a job is discovered superseded after its run was created', async () => {
    const fixture = await durableJob()
    const { stuck, transport, pendingBatch } = await pendingBatchRun(fixture)

    await prisma.knowledgeSource.update({ where: { id: fixture.source.id }, data: { desiredRevision: 2 } })
    await createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, transport }).runOnce()

    const closed = await prisma.knowledgeIngestion.findUnique({ where: { id: fixture.job.id } })
    expect(closed.status).toBe('SUPERSEDED')
    expect(closed.failureCode).toBe('KNOWLEDGE_SOURCE_SUPERSEDED')

    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(['QUEUED', 'RUNNING']).not.toContain(run.status)
    expect(run.status).toBe('FAILED')

    const intent = await prisma.genesisRag17IngestionIntent.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(intent.status).toBe('FAILED')
    expect(JSON.parse(intent.lastErrorJson).code).toBe('KNOWLEDGE_SOURCE_SUPERSEDED')

    // The outstanding Stage 9 request itself is never touched.
    const batchAfter = await prisma.genesisRag17Batch.findUnique({ where: { id: pendingBatch.id } })
    expect(batchAfter.status).toBe('PENDING')
    expect(batchAfter.responseJson).toBe(pendingBatch.responseJson)
  })

  it('closes the orphaned PipelineRun when a job is discovered withdrawn after its run was created', async () => {
    const fixture = await durableJob()
    const { stuck, transport, pendingBatch } = await pendingBatchRun(fixture)

    await prisma.knowledgeSource.update({ where: { id: fixture.source.id }, data: { revokedAt: new Date() } })
    await createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, transport }).runOnce()

    const closed = await prisma.knowledgeIngestion.findUnique({ where: { id: fixture.job.id } })
    expect(closed.status).toBe('WITHDRAWN')
    expect(closed.failureCode).toBe('KNOWLEDGE_SOURCE_WITHDRAWN')

    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(['QUEUED', 'RUNNING']).not.toContain(run.status)
    expect(run.status).toBe('FAILED')

    const intent = await prisma.genesisRag17IngestionIntent.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(intent.status).toBe('FAILED')
    expect(JSON.parse(intent.lastErrorJson).code).toBe('KNOWLEDGE_SOURCE_WITHDRAWN')

    const batchAfter = await prisma.genesisRag17Batch.findUnique({ where: { id: pendingBatch.id } })
    expect(batchAfter.status).toBe('PENDING')
    expect(batchAfter.responseJson).toBe(pendingBatch.responseJson)
  })

  // Production's actual orphan (1db6810c-eb86-4e96-9f4c-e9c89c8ba0d3) was not
  // discovered by a claimed job at all: its KnowledgeIngestion was already
  // SUPERSEDED by the time anyone looked, so `listPending` (QUEUED/RUNNING
  // only) had already stopped selecting it and `processJob`'s own close
  // could never run again. This is the shape the reconciliation sweep in
  // `runOnce` exists for.
  it('sweeps and closes a PipelineRun for an ingestion already SUPERSEDED before this process ever claims it again (the production shape)', async () => {
    const fixture = await durableJob()
    const { stuck, transport, pendingBatch } = await pendingBatchRun(fixture)

    // Simulate the production row directly: something other than this
    // admission process (a competing pass, or `publishInTransaction`'s own
    // stale-revision branch) already wrote SUPERSEDED without closing the
    // run it left attached.
    await prisma.knowledgeIngestion.update({
      where: { id: fixture.job.id },
      data: { status: 'SUPERSEDED', failureCode: 'KNOWLEDGE_SOURCE_REVISION_SUPERSEDED', claimToken: null, leaseExpiresAt: null },
    })

    await createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, transport }).runOnce()

    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(['QUEUED', 'RUNNING']).not.toContain(run.status)
    expect(run.status).toBe('FAILED')

    const intent = await prisma.genesisRag17IngestionIntent.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(intent.status).toBe('FAILED')
    expect(JSON.parse(intent.lastErrorJson).code).toBe('KNOWLEDGE_SOURCE_REVISION_SUPERSEDED')

    const batchAfter = await prisma.genesisRag17Batch.findUnique({ where: { id: pendingBatch.id } })
    expect(batchAfter.status).toBe('PENDING')
    expect(batchAfter.responseJson).toBe(pendingBatch.responseJson)

    // The sweep closes the run; it never reinterprets the admission's own
    // verdict on the ingestion row itself.
    const ingestion = await prisma.knowledgeIngestion.findUnique({ where: { id: fixture.job.id } })
    expect(ingestion.status).toBe('SUPERSEDED')
    expect(ingestion.failureCode).toBe('KNOWLEDGE_SOURCE_REVISION_SUPERSEDED')
  })

  // The main user-facing withdraw path (withdrawKnowledgeSource, reached from
  // DELETE /api/knowledge/sources/[sourceId]) goes around the runtime
  // entirely: withdrawInTransaction writes WITHDRAWN onto the source's active
  // ingestion directly. Once that row leaves QUEUED/RUNNING, this admission
  // never claims it again, so the sweep — not `processJob` — has to be what
  // closes the run it already owns.
  it('closes the orphaned PipelineRun after the real withdrawKnowledgeSource service withdraws its source mid-flight', async () => {
    const fixture = await durableJob()
    const { stuck, transport, pendingBatch } = await pendingBatchRun(fixture)

    // Mirror production: the source's active ingestion points at the job
    // this run belongs to, exactly as knowledge-admission-service.js leaves
    // it after admitting the request.
    await prisma.knowledgeSource.update({ where: { id: fixture.source.id }, data: { activeIngestionId: fixture.job.id } })
    const sourceBeforeWithdraw = await prisma.knowledgeSource.findUnique({ where: { id: fixture.source.id } })
    const owner = makeViewer({ visibleBusinessIds: [fixture.actualScope.businessId], ownedBusinessIds: [fixture.actualScope.businessId] })

    const withdrawn = await withdrawKnowledgeSource(fixture.source.id, { expectedVersion: sourceBeforeWithdraw.version }, { db: prisma, viewer: owner })
    expect(withdrawn.status).toBe('WITHDRAWN')

    const ingestionAfterWithdraw = await prisma.knowledgeIngestion.findUnique({ where: { id: fixture.job.id } })
    expect(ingestionAfterWithdraw.status).toBe('WITHDRAWN')
    expect(ingestionAfterWithdraw.failureCode).toBe('KNOWLEDGE_SOURCE_WITHDRAWN')
    // The withdraw service itself never touches the run — this is the gap.
    expect((await prisma.pipelineRun.findUnique({ where: { executionRunId: stuck.executionRunId } })).status).toBe('RUNNING')

    await createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, transport }).runOnce()

    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(['QUEUED', 'RUNNING']).not.toContain(run.status)
    expect(run.status).toBe('FAILED')

    const intent = await prisma.genesisRag17IngestionIntent.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(intent.status).toBe('FAILED')
    expect(JSON.parse(intent.lastErrorJson).code).toBe('KNOWLEDGE_SOURCE_WITHDRAWN')

    const batchAfterWithdraw = await prisma.genesisRag17Batch.findUnique({ where: { id: pendingBatch.id } })
    expect(batchAfterWithdraw.status).toBe('PENDING')
    expect(batchAfterWithdraw.responseJson).toBe(pendingBatch.responseJson)
  })

  // The catch branch (a source that moves on concurrently with an in-flight
  // resumed job) is the other close path `processJob` owns directly, not the
  // sweep — worth covering separately from the top-of-job check above.
  it('closes the orphaned PipelineRun via the catch branch when a source is superseded while a resumed job is mid-flight', async () => {
    const fixture = await durableJob()
    const { stuck, pendingBatch } = await pendingBatchRun(fixture)

    const sourceWorkerFactory = vi.fn(() => ({
      runOnce: vi.fn(async () => {
        // The source moves on concurrently with this in-flight pass, exactly
        // as production could see it: nothing about the thrown error names
        // supersession — the catch branch discovers it fresh.
        await prisma.knowledgeSource.update({ where: { id: fixture.source.id }, data: { desiredRevision: 2 } })
        throw new Error('simulated transport interruption mid-flight')
      }),
    }))

    await createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, sourceWorkerFactory }).runOnce()

    const closed = await prisma.knowledgeIngestion.findUnique({ where: { id: fixture.job.id } })
    expect(closed.status).toBe('SUPERSEDED')
    expect(closed.failureCode).toBe('KNOWLEDGE_SOURCE_SUPERSEDED')

    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(['QUEUED', 'RUNNING']).not.toContain(run.status)
    expect(run.status).toBe('FAILED')

    const intent = await prisma.genesisRag17IngestionIntent.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(intent.status).toBe('FAILED')
    expect(JSON.parse(intent.lastErrorJson).code).toBe('KNOWLEDGE_SOURCE_SUPERSEDED')

    const batchAfterCatch = await prisma.genesisRag17Batch.findUnique({ where: { id: pendingBatch.id } })
    expect(batchAfterCatch.status).toBe('PENDING')
    expect(batchAfterCatch.responseJson).toBe(pendingBatch.responseJson)
  })

  it('preserves a FileAsset MIME when creating the Stage 1 request', async () => {
    const fixture = await durableJob({
      sourceKind: 'FILE',
      sourceMetaJson: JSON.stringify({ kind: 'FILE', fileAssetId: 'file-markdown', mime: 'text/markdown; charset=utf-8' }),
    })
    const ingest = vi.fn(async () => ({
      run: { executionRunId: `runtime-file-${fixture.job.id}` },
      source: { rawArtifactId: `raw-${fixture.job.id}`, parsedArtifactId: `parsed-${fixture.job.id}` },
    }))
    const sourceWorkerFactory = vi.fn(() => ({ runOnce: vi.fn(async () => {}) }))

    await createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, ingest, sourceWorkerFactory }).runOnce()

    expect(ingest).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({ sourceType: 'FILE', contentType: 'text/markdown' }),
    }), expect.anything())
  })

  it('closes confirmed local stage failure instead of retrying a failed attempt forever', async () => {
    const fixture = await durableJob()
    const ingest = (input, options) => ingestGenesisRag17Raw({ ...input, source: { ...input.source, connectionId: 'missing-test-adapter' } }, options)
    await createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, ingest }).runOnce()
    const failed = await prisma.knowledgeIngestion.findUnique({ where: { id: fixture.job.id } })
    expect(failed.status).toBe('FAILED')
    expect((await prisma.pipelineRun.findUnique({ where: { executionRunId: failed.executionRunId } })).status).toBe('FAILED')
    expect(await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: failed.executionRunId } })).toEqual([expect.objectContaining({ stageNumber: 1, outcome: 'FAILED', errorCount: 1 })])
  })
})
