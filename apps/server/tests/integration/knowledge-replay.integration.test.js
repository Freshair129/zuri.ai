// @req FR-173, FR-071 — an eligible owner retry attaches a new immutable full-run
// child and the runtime resumes the same source through GenesisRAG17 raw stages.
// @spec ADR-072, ADR-030 D4-D6, SEC-001, SEC-003, SEC-008
// @tested tests/integration/knowledge-replay.integration.test.js
import { createHash, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { retryKnowledgeIngestion } from '@/modules/knowledge/knowledge-replay-service'
import { createKnowledgeAdmissionRuntime } from '@/modules/knowledge/knowledge-runtime'
import { createKnowledgeExecutionAuthority } from '@/modules/knowledge/knowledge-execution-authority'
import { hashGenesisRag17Text } from '@/modules/knowledge/genesisrag17-contract'
import { IDENTITY_REFS_EMPTY, KNOWLEDGE_INGESTION_CONTRACT_ID, KNOWLEDGE_INGESTION_DEFINITION_ID } from '@/platform/integrations/core/pipeline-tracking-contract'
import { createPipelineRun, requestKnowledgePipelineReplay } from '@/platform/integrations/core/pipeline-tracking-service'

const content = '# Demo catalog\n\nDEMO-KB-MUG-350-001 — Ceramic demo mug, 350 ml.'
const contentHash = hashGenesisRag17Text(content)
const IS_POSTGRES = /^(postgres|postgresql):/i.test(process.env.DATABASE_URL ?? '')

describe('Knowledge owner replay integration', () => {
  let portfolio
  let tenant
  let business
  let viewer
  let env
  const saved = {}

  beforeAll(async () => {
    for (const name of ['ZURI_KNOWLEDGE_ENABLED', 'ZURI_KNOWLEDGE_BINDINGS', 'MSP_PIPELINE_PRINCIPALS', 'ZURI_MSP_COMMAND']) saved[name] = process.env[name]
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    portfolio = await createPortfolio({ name: `Replay ${suffix}`, code: `PF-KREPLAY-${suffix}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `Replay tenant ${suffix}`, code: `TN-KREPLAY-${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, name: `Replay business ${suffix}`, code: `BU-KREPLAY-${suffix}` })
    viewer = makeViewer({ role: 'OWNER', visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    const scope = { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: '', agentId: '', visibility: 'private' }
    env = {
      ...process.env,
      ZURI_KNOWLEDGE_ENABLED: '1',
      ZURI_KNOWLEDGE_BINDINGS: JSON.stringify([{ scope, policy: { allowEmbedding: true, allowPublication: true } }]),
      MSP_PIPELINE_PRINCIPALS: JSON.stringify([{ role: 'source', scope, credential: 'knowledge-replay-test-key' }]),
      ZURI_MSP_COMMAND: process.execPath,
    }
  })

  afterEach(async () => {
    // The raw-stage case intentionally stops before the external worker. Its
    // pending job must not be claimed by the next case's injected runtime.
    if (!business) return
    await prisma.knowledgeIngestion.updateMany({
      where: { corpus: { businessId: business.id }, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'WITHDRAWN', claimToken: null, leaseExpiresAt: null },
    })
    await prisma.pipelineRun.updateMany({
      where: { businessId: business.id, status: { in: ['QUEUED', 'RUNNING'] } },
      data: { status: 'CANCELLED', finishedAt: new Date() },
    })
  })

  afterAll(async () => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    await prisma.$disconnect()
  })

  it.each(['same-key', 'different-keys'])('reattaches one FR-071 child under %s retries and replays its immutable raw source', async (raceMode) => {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12)
    const scope = { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: '', agentId: '', visibility: 'private' }
    const corpus = await prisma.knowledgeCorpus.create({ data: {
      corpusKey: `knowledge:replay:${suffix}`, portfolioId: portfolio.id, tenantId: tenant.id,
      businessId: business.id, projectId: null, workspaceId: '', scopeJson: JSON.stringify(scope),
      policyJson: JSON.stringify({ allowEmbedding: true, allowPublication: true }), status: 'ACTIVE',
    } })
    const source = await prisma.knowledgeSource.create({ data: {
      corpusId: corpus.id, sourceKey: `demo-mug-${suffix}`, kind: 'TEXT', title: 'Demo mug', desiredRevision: 1,
    } })
    const ingestion = await prisma.knowledgeIngestion.create({ data: {
      corpusId: corpus.id, sourceId: source.id, revision: 1, sourceVersion: 'catalog-record-v1',
      contentHash, content, idempotencyKey: `knowledge-replay-source:${suffix}`,
      requestHash: createHash('sha256').update(suffix).digest('hex'), status: 'QUEUED',
    } })
    const transport = vi.fn(async () => { throw new Error('No external stage is part of this acceptance') })
    const runtime = createKnowledgeAdmissionRuntime({ db: prisma, env, transport })

    await runtime.runOnce()
    const admitted = await prisma.knowledgeIngestion.findUnique({ where: { id: ingestion.id } })
    expect(admitted.executionRunId).toBeTruthy()
    expect(admitted.rawArtifactId).toBeTruthy()
    const original = await prisma.pipelineRun.findUnique({ where: { executionRunId: admitted.executionRunId } })
    const stage = await prisma.pipelineStep.findFirst({ where: { runId: original.id, pipelineStageId: 'DPS-KI-INDEX' } })
    const now = new Date()
    await prisma.pipelineRun.update({ where: { id: original.id }, data: {
      status: 'FAILED', currentStageId: 'DPS-KI-INDEX', primaryFailureCode: 'GENESISRAG17_EXTERNAL_STAGE_FAILED',
      finishedAt: now,
    } })
    await prisma.pipelineStep.update({ where: { id: stage.id }, data: { status: 'FAILED' } })
    await prisma.genesisRag17StageEvidence.create({ data: {
      id: randomUUID(), runId: original.id, executionRunId: original.executionRunId,
      pipelineStageId: 'DPS-KI-INDEX', executionStepId: stage.executionStepId, attemptId: stage.attemptId,
      stageNumber: 16, outcome: 'FAILED', startedAt: now, finishedAt: now,
      recordsIn: 0, recordsOut: 0, recordsQuarantined: 0, errorCount: 1, retryCount: 0, durationMs: 0,
      detailsJson: JSON.stringify({ failureHash: createHash('sha256').update(suffix).digest('hex'), error: { code: 'BENCHMARK_NO_APPLICABLE_QUERIES', message: 'No applicable benchmark query' } }),
      rowHash: createHash('sha256').update(`stage-16:${suffix}`).digest('hex'),
    } })
    await prisma.knowledgeIngestion.update({ where: { id: ingestion.id }, data: {
      status: 'FAILED', failureCode: 'KNOWLEDGE_PIPELINE_FAILED', claimToken: null, leaseExpiresAt: null,
    } })

    const requestRetry = (key) => retryKnowledgeIngestion(ingestion.id, { idempotencyKey: key }, { db: prisma, env, viewer, now })
    const retryKeys = IS_POSTGRES
      ? [`retry:${suffix}`, raceMode === 'same-key' ? `retry:${suffix}` : `retry:${suffix}:other`]
      : [`retry:${suffix}`]
    const outcomes = await Promise.allSettled(retryKeys.map(requestRetry))
    const completed = outcomes.filter((outcome) => outcome.status === 'fulfilled').map((outcome) => outcome.value)
    expect(completed.length).toBeGreaterThanOrEqual(1)
    if (IS_POSTGRES) expect(completed).toHaveLength(raceMode === 'same-key' ? 2 : 1)
    for (const outcome of outcomes.filter((entry) => entry.status === 'rejected')) {
      expect(outcome.reason).toMatchObject({ status: 409 })
    }
    const winnerIndex = outcomes.findIndex((outcome) => outcome.status === 'fulfilled')
    const result = outcomes[winnerIndex].value
    expect(result).toMatchObject({
      status: 'QUEUED', replayOfExecutionRunId: original.executionRunId,
      sourceVersion: 'catalog-record-v1', contentHash, retryAvailable: false,
    })
    const childId = result.executionRunId
    expect((await requestRetry(retryKeys[winnerIndex])).executionRunId).toBe(childId)
    expect(await prisma.pipelineRun.count({ where: { replayOfExecutionRunId: original.executionRunId } })).toBe(1)
    const child = await prisma.pipelineRun.findUnique({ where: { executionRunId: childId } })
    expect(child).toMatchObject({ status: 'QUEUED', replayOfExecutionRunId: original.executionRunId, replayScope: 'FULL_RUN' })

    await runtime.runOnce()

    const afterReplay = await prisma.knowledgeIngestion.findUnique({ where: { id: ingestion.id } })
    const parentAfterReplay = await prisma.pipelineRun.findUnique({ where: { executionRunId: original.executionRunId } })
    const childStage2 = await prisma.genesisRag17StageEvidence.findFirst({ where: { executionRunId: childId, stageNumber: 2, outcome: 'SUCCEEDED' } })
    expect(afterReplay).toMatchObject({ status: 'RUNNING', executionRunId: childId, sourceVersion: 'catalog-record-v1', contentHash })
    expect(parentAfterReplay).toMatchObject({ status: 'FAILED', primaryFailureCode: 'GENESISRAG17_EXTERNAL_STAGE_FAILED' })
    expect(childStage2).toBeTruthy()
    expect(transport).toHaveBeenCalled()
  })

  it('publishes a succeeded replay child without re-entering raw ingestion and surfaces a failed child', async () => {
    const scope = { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: '', agentId: '', visibility: 'private' }
    const fixtures = []
    for (const status of ['SUCCEEDED', 'FAILED']) {
      const suffix = `${status.toLowerCase()}-${randomUUID().replaceAll('-', '').slice(0, 8)}`
      const corpus = await prisma.knowledgeCorpus.create({ data: {
        corpusKey: `knowledge:terminal-replay:${suffix}`, portfolioId: portfolio.id, tenantId: tenant.id,
        businessId: business.id, projectId: null, workspaceId: '', scopeJson: JSON.stringify(scope),
        policyJson: JSON.stringify({ allowEmbedding: true, allowPublication: true }), status: 'ACTIVE',
      } })
      const source = await prisma.knowledgeSource.create({ data: {
        corpusId: corpus.id, sourceKey: `terminal-replay-${suffix}`, kind: 'TEXT', title: suffix, desiredRevision: 1,
      } })
      const rawArtifactId = `knowledge-raw:${source.id}`
      const original = await createPipelineRun({
        dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
        executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
        businessId: business.id,
        sourceRef: `knowledge-source:${source.id}`,
        sourceSha256: contentHash,
        artifactRef: rawArtifactId,
        artifactSha256: contentHash,
        bootstrapBatchId: `terminal-original:${suffix}`,
        correlationId: `terminal-original:${suffix}`,
        idempotencyKey: `terminal-original:${suffix}`,
        expectedCount: 1,
        identityRefs: { ...IDENTITY_REFS_EMPTY },
        tagIds: [],
      }, { db: prisma, viewer: createKnowledgeExecutionAuthority(scope) })
      await prisma.pipelineRun.update({ where: { executionRunId: original.run.executionRunId }, data: {
        status: 'FAILED', currentStageId: 'DPS-KI-INDEX', primaryFailureCode: 'GENESISRAG17_EXTERNAL_STAGE_FAILED',
      } })
      const replay = await requestKnowledgePipelineReplay(original.run.executionRunId, {
        scope: 'FULL_RUN', correlationId: `terminal-replay:${suffix}`, idempotencyKey: `terminal-replay:${suffix}`,
        sourceSha256: contentHash, artifactSha256: contentHash,
      }, { db: prisma, viewer: createKnowledgeExecutionAuthority(scope, 'execute', original.run.executionRunId) })
      await prisma.pipelineRun.update({ where: { executionRunId: replay.run.executionRunId }, data: { status } })
      const ingestion = await prisma.knowledgeIngestion.create({ data: {
        corpusId: corpus.id, sourceId: source.id, revision: 1, sourceVersion: 'catalog-record-v1',
        contentHash, content, sourceMetaJson: '{}', idempotencyKey: `terminal-replay:${suffix}`,
        requestHash: createHash('sha256').update(suffix).digest('hex'), status: 'QUEUED',
        executionRunId: replay.run.executionRunId, rawArtifactId,
      } })
      fixtures.push({ status, ingestion })
    }

    const ingest = vi.fn()
    const sourceWorkerFactory = vi.fn(() => ({ runOnce: vi.fn() }))
    const publish = vi.fn(async (id, { claimToken }) => prisma.knowledgeIngestion.updateMany({
      where: { id, claimToken }, data: { status: 'PUBLISHED', claimToken: null, leaseExpiresAt: null },
    }))
    await createKnowledgeAdmissionRuntime({ db: prisma, env, ingest, sourceWorkerFactory, publish }).runOnce()

    expect(ingest).not.toHaveBeenCalled()
    expect(sourceWorkerFactory).not.toHaveBeenCalled()
    expect(publish).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(fixtures[0].ingestion.id, expect.anything())
    expect(await prisma.knowledgeIngestion.findUnique({ where: { id: fixtures[0].ingestion.id } })).toMatchObject({ status: 'PUBLISHED' })
    expect(await prisma.knowledgeIngestion.findUnique({ where: { id: fixtures[1].ingestion.id } })).toMatchObject({ status: 'FAILED', failureCode: 'KNOWLEDGE_PIPELINE_FAILED' })
  })
})
