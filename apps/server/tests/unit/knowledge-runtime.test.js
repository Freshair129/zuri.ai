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
import { KNOWLEDGE_INGESTION_DEFINITION_ID, KNOWLEDGE_INGESTION_CONTRACT_ID } from '@/platform/integrations/core/pipeline-tracking-contract'
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

  // A filler row shaped exactly like the thing that used to monopolize the
  // sweep's bounded window forever: a KnowledgeIngestion that is
  // SUPERSEDED/WITHDRAWN, but whose PipelineRun already reached a terminal
  // status (SUCCEEDED/FAILED) on its own — every published-then-withdrawn
  // source looks like this. The old query (oldest SUPERSEDED/WITHDRAWN
  // ingestion first, regardless of its run's status) let 20+ of these sit
  // ahead of a genuine orphan forever; this helper exists to prove the fixed
  // query never even considers them, because it starts from the still-open
  // PipelineRun side.
  async function closedRunFillerIngestion(fixture, index) {
    const executionRunId = `finished-${fixture.job.id}-${index}`
    await prisma.pipelineRun.create({ data: {
      executionRunId,
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
      tenantId: fixture.actualScope.tenantId,
      businessId: fixture.actualScope.businessId,
      status: index % 2 === 0 ? 'SUCCEEDED' : 'FAILED',
      correlationId: `filler-corr-${fixture.job.id}-${index}`,
      idempotencyKey: `filler-idem-run-${fixture.job.id}-${index}`,
      requestHash: 'filler-hash',
    } })
    const sourceVersion = `filler-${index}`
    const content = `filler content ${index}`
    await prisma.knowledgeIngestion.create({ data: {
      corpusId: fixture.corpus.id,
      sourceId: fixture.source.id,
      revision: 1,
      sourceVersion,
      content,
      contentHash: hashGenesisRag17Text(content),
      idempotencyKey: `filler-idem-${fixture.job.id}-${index}`,
      requestHash: hashGenesisRag17Text(sourceVersion),
      status: index % 2 === 0 ? 'SUPERSEDED' : 'WITHDRAWN',
      failureCode: index % 2 === 0 ? 'KNOWLEDGE_SOURCE_REVISION_SUPERSEDED' : 'KNOWLEDGE_SOURCE_WITHDRAWN',
      executionRunId,
      // Older than the real orphan below on purpose: under the old
      // "oldest ingestion.updatedAt first" query these would have filled
      // every page ahead of it.
      updatedAt: new Date(Date.now() - 3600000 * (25 - index)),
    } })
  }

  it('sweep finds and closes the real orphan even with 20+ older SUPERSEDED/WITHDRAWN rows whose runs already finished sitting ahead of it', async () => {
    const fixture = await durableJob()
    const { stuck, transport, pendingBatch } = await pendingBatchRun(fixture)

    for (let index = 0; index < 25; index += 1) await closedRunFillerIngestion(fixture, index)

    // The real orphan, exactly as production found it: something outside
    // this process already wrote SUPERSEDED without closing the run it left
    // attached, and its updatedAt is the newest row in the table.
    await prisma.knowledgeIngestion.update({
      where: { id: fixture.job.id },
      data: { status: 'SUPERSEDED', failureCode: 'KNOWLEDGE_SOURCE_REVISION_SUPERSEDED', claimToken: null, leaseExpiresAt: null },
    })

    const result = await createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, transport }).runOnce()

    // The 25 filler rows never enter the query at all, regardless of how old
    // their ingestion rows are: closed counts exactly the one real orphan
    // (`examined` is not asserted here — it also carries any other test's
    // still-open knowledge run sharing this same database).
    expect(result.sweep).toMatchObject({ closed: 1, open: 0 })

    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(['QUEUED', 'RUNNING']).not.toContain(run.status)
    expect(run.status).toBe('FAILED')

    const intent = await prisma.genesisRag17IngestionIntent.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(intent.status).toBe('FAILED')
    expect(JSON.parse(intent.lastErrorJson).code).toBe('KNOWLEDGE_SOURCE_REVISION_SUPERSEDED')

    const batchAfter = await prisma.genesisRag17Batch.findUnique({ where: { id: pendingBatch.id } })
    expect(batchAfter.status).toBe('PENDING')
    expect(batchAfter.responseJson).toBe(pendingBatch.responseJson)
  })

  // Another process (a live processJob heartbeat, or a caller that just
  // wrote SUPERSEDED/WITHDRAWN but has not yet reached its own close) may
  // still be mid-flight on the exact row the sweep would otherwise close.
  it('skips an orphan whose ingestion lease is still live, then closes it once the lease expires', async () => {
    const fixture = await durableJob()
    const { stuck, transport } = await pendingBatchRun(fixture)
    const clock = new Date('2026-09-24T10:00:00Z')

    await prisma.knowledgeIngestion.update({
      where: { id: fixture.job.id },
      data: {
        status: 'SUPERSEDED',
        failureCode: 'KNOWLEDGE_SOURCE_REVISION_SUPERSEDED',
        claimToken: 'another-live-process',
        leaseExpiresAt: new Date(clock.getTime() + 60000),
      },
    })

    const firstPass = await createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, transport, now: () => clock }).runOnce()
    expect(firstPass.sweep).toMatchObject({ closed: 0, open: 0 })
    expect((await prisma.pipelineRun.findUnique({ where: { executionRunId: stuck.executionRunId } })).status).toBe('RUNNING')

    clock.setTime(clock.getTime() + 120000)

    const secondPass = await createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, transport, now: () => clock }).runOnce()
    expect(secondPass.sweep).toMatchObject({ closed: 1, open: 0 })
    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(['QUEUED', 'RUNNING']).not.toContain(run.status)
    expect(run.status).toBe('FAILED')
  })

  // closeOrphanedExecutionRun can decline to close a run on purpose (still
  // inside Tier 1, its corpus gone, a stage report rejected) rather than
  // fabricate evidence — a corrupted/unparsable corpus scope is the simplest
  // of those to force from a test. The sweep must not silently count that as
  // closed: it re-checks the run, counts it `open`, and surfaces it once
  // through `onError`.
  it('surfaces a refused close as KNOWLEDGE_ORPHAN_RUN_OPEN and reports it as open, not closed', async () => {
    const fixture = await durableJob()
    const { stuck, transport } = await pendingBatchRun(fixture)

    await prisma.knowledgeIngestion.update({
      where: { id: fixture.job.id },
      data: { status: 'SUPERSEDED', failureCode: 'KNOWLEDGE_SOURCE_REVISION_SUPERSEDED', claimToken: null, leaseExpiresAt: null },
    })
    await prisma.knowledgeCorpus.update({ where: { id: fixture.corpus.id }, data: { scopeJson: 'not-json' } })

    const onError = vi.fn()
    const result = await createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, transport, onError }).runOnce()

    expect(result.sweep).toMatchObject({ closed: 0, open: 1 })
    expect(onError).toHaveBeenCalledWith({ code: 'KNOWLEDGE_ORPHAN_RUN_OPEN', executionRunId: stuck.executionRunId })

    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(run.status).toBe('RUNNING')
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

  // Round 4 gate: `listOpenKnowledgeRuns` took an oldest-first page of open
  // (QUEUED/RUNNING) knowledge PipelineRuns and silently skipped any it could
  // not act on — a run with no KnowledgeIngestion at all (FR-071 replay runs,
  // FR-109 reporter runs share this same dataPipelineDefinitionId but not the
  // executionRunId), a run whose ingestion is itself still QUEUED/RUNNING, or
  // a run whose close is refused. 20+ of those ahead of a real orphan meant
  // the orphan was never reached. These helpers build exactly that shape
  // against the *open-run* query (distinct from `closedRunFillerIngestion`
  // above, whose PipelineRuns are already SUCCEEDED/FAILED and so never even
  // enter it).
  async function openRunWithNoIngestion(fixture, index) {
    await prisma.pipelineRun.create({ data: {
      executionRunId: `open-no-ingestion-${fixture.job.id}-${index}`,
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
      tenantId: fixture.actualScope.tenantId,
      businessId: fixture.actualScope.businessId,
      status: index % 2 === 0 ? 'QUEUED' : 'RUNNING',
      correlationId: `open-no-ingestion-corr-${fixture.job.id}-${index}`,
      idempotencyKey: `open-no-ingestion-idem-${fixture.job.id}-${index}`,
      requestHash: 'filler-hash',
    } })
  }

  async function openRunWithOpenIngestion(fixture, index) {
    const executionRunId = `open-ingestion-${fixture.job.id}-${index}`
    await prisma.pipelineRun.create({ data: {
      executionRunId,
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
      tenantId: fixture.actualScope.tenantId,
      businessId: fixture.actualScope.businessId,
      status: 'RUNNING',
      correlationId: `open-ingestion-corr-${fixture.job.id}-${index}`,
      idempotencyKey: `open-ingestion-idem-run-${fixture.job.id}-${index}`,
      requestHash: 'filler-hash',
    } })
    const sourceVersion = `open-${index}`
    const content = `open content ${index}`
    await prisma.knowledgeIngestion.create({ data: {
      corpusId: fixture.corpus.id,
      sourceId: fixture.source.id,
      revision: 1,
      sourceVersion,
      content,
      contentHash: hashGenesisRag17Text(content),
      idempotencyKey: `open-ingestion-idem-${fixture.job.id}-${index}`,
      requestHash: hashGenesisRag17Text(sourceVersion),
      status: 'RUNNING',
      executionRunId,
    } })
  }

  // A different corpus from `fixture`'s own, with an unparsable scopeJson —
  // its close is refused by `closeOrphanedExecutionRun` exactly as in
  // "surfaces a refused close" above, but kept isolated from `fixture.corpus`
  // so refusing it never prevents the real orphan (which uses `fixture.corpus`)
  // from closing.
  async function refusedCloseOrphan(fixture, label) {
    const corpus = await prisma.knowledgeCorpus.create({ data: {
      corpusKey: `refused-${fixture.job.id}-${label}`,
      portfolioId: fixture.actualScope.portfolioId,
      tenantId: fixture.actualScope.tenantId,
      businessId: fixture.actualScope.businessId,
      scopeJson: 'not-json',
      policyJson: JSON.stringify({ allowEmbedding: true, allowPublication: true }),
    } })
    const source = await prisma.knowledgeSource.create({ data: { corpusId: corpus.id, sourceKey: `refused-${fixture.job.id}-${label}`, kind: 'TEXT', title: 'Refused source', desiredRevision: 1 } })
    const executionRunId = `refused-${fixture.job.id}-${label}`
    await prisma.pipelineRun.create({ data: {
      executionRunId,
      dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
      tenantId: fixture.actualScope.tenantId,
      businessId: fixture.actualScope.businessId,
      status: 'RUNNING',
      correlationId: `refused-corr-${fixture.job.id}-${label}`,
      idempotencyKey: `refused-idem-run-${fixture.job.id}-${label}`,
      requestHash: 'filler-hash',
    } })
    const sourceVersion = `refused-${label}`
    const content = `refused content ${label}`
    await prisma.knowledgeIngestion.create({ data: {
      corpusId: corpus.id,
      sourceId: source.id,
      revision: 1,
      sourceVersion,
      content,
      contentHash: hashGenesisRag17Text(content),
      idempotencyKey: `refused-idem-${fixture.job.id}-${label}`,
      requestHash: hashGenesisRag17Text(sourceVersion),
      status: 'SUPERSEDED',
      failureCode: 'KNOWLEDGE_SOURCE_REVISION_SUPERSEDED',
      executionRunId,
      updatedAt: new Date(Date.now() - 3600000 * 50),
    } })
    return { executionRunId }
  }

  it('closes the real SUPERSEDED orphan in one runOnce() despite 21+ older still-open knowledge PipelineRuns — some with no KnowledgeIngestion, some legitimately in flight, and one refused close', async () => {
    const fixture = await durableJob()
    const { stuck, transport, pendingBatch } = await pendingBatchRun(fixture)

    for (let index = 0; index < 12; index += 1) await openRunWithNoIngestion(fixture, index)
    for (let index = 0; index < 9; index += 1) await openRunWithOpenIngestion(fixture, index)
    const refused = await refusedCloseOrphan(fixture, 'd')
    // 12 + 9 + 1 = 22 older still-open knowledge PipelineRuns sit ahead of the
    // real orphan below in `listOpenKnowledgeRunIds` — none of them actionable.

    await prisma.knowledgeIngestion.update({
      where: { id: fixture.job.id },
      data: { status: 'SUPERSEDED', failureCode: 'KNOWLEDGE_SOURCE_REVISION_SUPERSEDED', claimToken: null, leaseExpiresAt: null },
    })

    const onError = vi.fn()
    const result = await createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, transport, onError }).runOnce()

    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(['QUEUED', 'RUNNING']).not.toContain(run.status)
    expect(run.status).toBe('FAILED')

    const intent = await prisma.genesisRag17IngestionIntent.findUnique({ where: { executionRunId: stuck.executionRunId } })
    expect(intent.status).toBe('FAILED')
    expect(JSON.parse(intent.lastErrorJson).code).toBe('KNOWLEDGE_SOURCE_REVISION_SUPERSEDED')

    const batchAfter = await prisma.genesisRag17Batch.findUnique({ where: { id: pendingBatch.id } })
    expect(batchAfter.status).toBe('PENDING')
    expect(batchAfter.responseJson).toBe(pendingBatch.responseJson)

    // The refused row is reported and left open — it never silently blocks
    // the real orphan from being reached or closed in this same pass.
    expect(onError).toHaveBeenCalledWith({ code: 'KNOWLEDGE_ORPHAN_RUN_OPEN', executionRunId: refused.executionRunId })
    expect((await prisma.pipelineRun.findUnique({ where: { executionRunId: refused.executionRunId } })).status).toBe('RUNNING')

    // The legitimately in-flight row is left exactly as it was.
    expect((await prisma.knowledgeIngestion.findUnique({ where: { executionRunId: `open-ingestion-${fixture.job.id}-0` } })).status).toBe('RUNNING')
    expect((await prisma.pipelineRun.findUnique({ where: { executionRunId: `open-ingestion-${fixture.job.id}-0` } })).status).toBe('RUNNING')

    expect(result.sweep.closed).toBeGreaterThanOrEqual(1)
  })

  it('reports a refused close via onError once across three runOnce() passes, not once per pass', async () => {
    const fixture = await durableJob()
    const { stuck, transport } = await pendingBatchRun(fixture)

    await prisma.knowledgeIngestion.update({
      where: { id: fixture.job.id },
      data: { status: 'SUPERSEDED', failureCode: 'KNOWLEDGE_SOURCE_REVISION_SUPERSEDED', claimToken: null, leaseExpiresAt: null },
    })
    await prisma.knowledgeCorpus.update({ where: { id: fixture.corpus.id }, data: { scopeJson: 'not-json' } })

    const onError = vi.fn()
    const runtime = createKnowledgeAdmissionRuntime({ db: prisma, env: fixture.env, transport, onError })
    await runtime.runOnce()
    await runtime.runOnce()
    await runtime.runOnce()

    const reportsForThisRun = onError.mock.calls.filter(([event]) => event.code === 'KNOWLEDGE_ORPHAN_RUN_OPEN' && event.executionRunId === stuck.executionRunId)
    expect(reportsForThisRun).toHaveLength(1)

    expect((await prisma.pipelineRun.findUnique({ where: { executionRunId: stuck.executionRunId } })).status).toBe('RUNNING')
  })
})
