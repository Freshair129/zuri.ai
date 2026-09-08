import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { isInstallationOperator } from '@/modules/identity/viewer-authority'
import { createKnowledgeExecutionAuthority, hasKnowledgeScopeAuthority, hasKnowledgeRunAuthority } from '@/modules/knowledge/knowledge-execution-authority'
import { resolveKnowledgeRuntimeBinding, createKnowledgeAdmissionRuntime } from '@/modules/knowledge/knowledge-runtime'
import { ingestGenesisRag17Raw } from '@/platform/integrations/core/genesisrag17-executor'
import { createPipelineRun, requestPipelineReplay, getPipelineMonitor } from '@/platform/integrations/core/pipeline-tracking-service'
import { KNOWLEDGE_INGESTION_DEFINITION_ID } from '@/platform/integrations/core/pipeline-tracking-contract'
import { hashGenesisRag17Text } from '@/modules/knowledge/genesisrag17-contract'

// @req FR-172 — scope-bound authority, durable run attachment, lease recovery and no false publication.
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

async function durableJob() {
  const suffix = randomUUID().slice(0, 8)
  const portfolio = await createPortfolio({ name: `Runtime ${suffix}`, code: `PF-KRT-${suffix}` })
  const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Runtime tenant', code: `TN-KRT-${suffix}` })
  const business = await createBusiness({ tenantId: tenant.id, name: 'Runtime business', code: `BU-KRT-${suffix}` })
  const actualScope = { ...scope, portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id }
  const corpus = await prisma.knowledgeCorpus.create({ data: { corpusKey: suffix, portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, scopeJson: JSON.stringify(actualScope), policyJson: JSON.stringify({ allowEmbedding: true, allowPublication: true }) } })
  const source = await prisma.knowledgeSource.create({ data: { corpusId: corpus.id, sourceKey: suffix, kind: 'TEXT', title: 'Runtime source', desiredRevision: 1 } })
  const content = '# Employment\n\nAlice works for Acme Ltd.\n\n# Purchase\n\nAlice purchased Atlas.'
  const job = await prisma.knowledgeIngestion.create({ data: { corpusId: corpus.id, sourceId: source.id, revision: 1, sourceVersion: '1', content, contentHash: hashGenesisRag17Text(content), idempotencyKey: suffix, requestHash: hashGenesisRag17Text(suffix) } })
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
