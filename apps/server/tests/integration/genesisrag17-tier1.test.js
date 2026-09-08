import { randomUUID } from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { makeOperatorViewer } from '../factories/viewer'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { ingestGenesisRag17Raw, resolveGenesisRag17RawLineage } from '@/platform/integrations/core/genesisrag17-executor'
import { requestPipelineReplay } from '@/platform/integrations/core/pipeline-tracking-service'
import {
  GENESIS_RAG17_PIPELINE_VERSION,
  GENESIS_RAG17_SCHEMA_VERSION,
  hashGenesisRag17Json,
  hashGenesisRag17Text,
} from '@/modules/knowledge/genesisrag17-contract'

// @req FR-109 — a real raw entry executes and persists ordered Tier 1 stages,
// canonical RawExternalRecord linkage, immutable versioned lineage and exact
// Person/Product source mentions before the Stage 9 handoff.
// @spec ADR-050, ADR-063, ADR-067, docs/plans/GENESISRAG17-CONTRACT.md
// @tested tests/integration/genesisrag17-tier1.test.js

const fixtureText = [
  '# Employment',
  '',
  'Alice works for Acme Ltd.',
  '',
  '# Purchase',
  '',
  'Alice purchased Atlas.',
  '',
  '# More',
  '',
  'Bob works for Beacon Ltd.',
  '',
  'Bob purchased Nimbus.',
].join('\n')

const now = () => new Date('2026-09-07T15:00:00.000Z')

describe('GenesisRAG17 Tier 1 source execution', () => {
  let portfolio
  let tenant
  let business
  let connection
  let viewer
  let transportCalls

  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8)
    portfolio = await createPortfolio({ name: `KI17 portfolio ${suffix}`, code: `KI17-PF-${suffix}` })
    tenant = await createTenant({ portfolioId: portfolio.id, name: `KI17 tenant ${suffix}`, code: `KI17-TN-${suffix}` })
    business = await createBusiness({ tenantId: tenant.id, name: `KI17 business ${suffix}`, code: `KI17-BU-${suffix}` })
    const provider = await prisma.integrationProvider.create({ data: { code: `KI17-${suffix}`, name: 'GenesisRAG17 source', status: 'ACTIVE' } })
    connection = await prisma.integrationConnection.create({
      data: { tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'KI17 source connection', status: 'ACTIVE' },
    })
    viewer = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
    transportCalls = []
  })

  function input(over = {}) {
    return {
      scope: { portfolioId: portfolio.id, tenantId: tenant.id, businessId: business.id, workspaceId: '', agentId: '', visibility: 'private' },
      sourceId: 'synthetic://ki17/test',
      documentId: 'doc-ki17-test',
      version: '1',
      content: fixtureText,
      connectionId: connection.id,
      policy: { allowEmbedding: true, allowPublication: true },
      ...over,
    }
  }

  function sourceTransport(name, request) {
    transportCalls.push({ name, request })
    return Promise.resolve({
      schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
      scope: request.scope,
      batchId: request.batch.batchId,
      decisionId: null,
      status: 'PENDING',
    })
  }

  it('runs Stage 1 through Stage 8 with real persisted outputs and one pending Stage 9 batch', async () => {
    const result = await ingestGenesisRag17Raw(input(), { db: prisma, viewer, now, transport: sourceTransport, credential: 'test-source' })
    expect(result.schemaVersion).toBe(GENESIS_RAG17_SCHEMA_VERSION)
    expect(result.source.contentHash).toBe(hashGenesisRag17Text(fixtureText))
    expect(result.chunks.length).toBeGreaterThan(2)
    expect(result.mentions.filter((mention) => mention.semanticType === 'Person').map((mention) => mention.name)).toEqual(['Alice', 'Alice', 'Bob', 'Bob'])
    expect(result.mentions.filter((mention) => mention.semanticType === 'Product').map((mention) => mention.name)).toEqual(['Atlas', 'Nimbus'])
    expect(result.mentions.some((mention) => mention.semanticType === 'Organization' && mention.name === 'Acme Ltd.')).toBe(true)
    expect(new Set(result.mentions.map((mention) => mention.sourceMentionId)).size).toBe(result.mentions.length)
    expect(transportCalls).toHaveLength(1)
    expect(transportCalls[0].name).toBe('msp_pipeline_submit')
    expect(result.batch.status).toBe('PENDING')
    expect(result.batch.decisionId).toBeNull()

    const run = await prisma.pipelineRun.findUnique({ where: { executionRunId: result.run.executionRunId } })
    const evidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: result.run.executionRunId }, orderBy: { stageNumber: 'asc' } })
    expect(evidence.map((row) => row.stageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
    expect(evidence.every((row) => row.outcome === 'SUCCEEDED' && row.errorCount === 0 && row.retryCount === 0 && row.durationMs >= 0)).toBe(true)
    expect(JSON.parse(evidence[0].detailsJson)).toMatchObject({ receivedAt: now().toISOString(), rawExternalRecordId: expect.any(String) })
    const steps = await prisma.pipelineStep.findMany({ where: { runId: run.id }, orderBy: { sequence: 'asc' } })
    expect(steps.slice(0, 8).every((step) => step.actualCount > 0 && step.insertedCount > 0 && step.failedCount === 0)).toBe(true)
    const firstDetails = JSON.parse(evidence[0].detailsJson)
    expect(steps[0].outputHash).toBe(hashGenesisRag17Json({
      metrics: {
        records_in: evidence[0].recordsIn,
        records_out: evidence[0].recordsOut,
        records_quarantined: evidence[0].recordsQuarantined,
        error_count: evidence[0].errorCount,
        retry_count: evidence[0].retryCount,
        duration_ms: evidence[0].durationMs,
      },
      details: firstDetails,
    }))
    expect(run.status).toBe('RUNNING')

    const raw = await prisma.knowledgeRawArtifact.findUnique({ where: { id: result.source.rawArtifactId } })
    const canonical = await prisma.rawExternalRecord.findUnique({ where: { id: raw.rawExternalRecordId } })
    const parsed = await prisma.knowledgeParsedArtifact.findUnique({ where: { id: result.source.parsedArtifactId } })
    expect(raw).toMatchObject({ rawExternalRecordId: canonical.id, content: fixtureText, pipelineVersion: GENESIS_RAG17_PIPELINE_VERSION })
    expect(JSON.parse(canonical.payloadJson).content).toBe(fixtureText)
    expect(parsed).toMatchObject({ rawArtifactId: raw.id, documentId: 'doc-ki17-test', content: fixtureText })
    expect(await prisma.genesisRag17Batch.count({ where: { executionRunId: result.run.executionRunId } })).toBe(1)

    const cited = await resolveGenesisRag17RawLineage({
      scope: input().scope,
      sourceId: result.source.sourceId,
      documentId: result.source.documentId,
      version: result.source.version,
      rawArtifactId: result.source.rawArtifactId,
      parsedArtifactId: result.source.parsedArtifactId,
      chunkId: result.chunks[0].chunkId,
    }, { db: prisma })
    expect(cited).toMatchObject({ sourceId: result.source.sourceId, rawArtifactId: result.source.rawArtifactId, parsedArtifactId: result.source.parsedArtifactId, chunkId: result.chunks[0].chunkId })
  })

  it('rejects recognizer metadata that cannot be proven by the durable rule_v1 extractor', async () => {
    await expect(ingestGenesisRag17Raw(input({ recognizerVersion: 'custom-v2' }), { db: prisma, viewer, now, transport: sourceTransport, credential: 'test-source' }))
      .rejects.toMatchObject({ status: 400, code: 'GENESISRAG17_RECOGNIZER_CONFIG_UNSUPPORTED' })
    await expect(ingestGenesisRag17Raw(input({ recognizer_provenance: 'plugin://custom' }), { db: prisma, viewer, now, transport: sourceTransport, credential: 'test-source' }))
      .rejects.toMatchObject({ status: 400, code: 'GENESISRAG17_RECOGNIZER_CONFIG_UNSUPPORTED' })
  })

  it('rolls back the newly created run and intent if the process dies before intent creation', async () => {
    const atomicInput = input({ sourceId: `synthetic://ki17/atomic/${randomUUID()}`, version: `atomic-${randomUUID()}` })
    await expect(ingestGenesisRag17Raw(atomicInput, {
      db: prisma,
      viewer,
      now,
      transport: sourceTransport,
      credential: 'test-source',
      faultInjector: async (point) => {
        if (point === 'after-run-created-before-intent') throw new Error('KI17_TEST_PRE_INTENT_CRASH')
      },
    })).rejects.toThrow('KI17_TEST_PRE_INTENT_CRASH')
    const contentHash = hashGenesisRag17Text(atomicInput.content)
    expect(await prisma.pipelineRun.count({ where: { sourceRef: atomicInput.sourceId, sourceSha256: contentHash } })).toBe(0)
    expect(await prisma.genesisRag17IngestionIntent.count({ where: { sourceId: atomicInput.sourceId, version: atomicInput.version } })).toBe(0)

    const retried = await ingestGenesisRag17Raw(atomicInput, { db: prisma, viewer, now, transport: sourceTransport, credential: 'test-source' })
    expect(retried.batch.status).toBe('PENDING')
    expect(await prisma.genesisRag17IngestionIntent.count({ where: { sourceId: atomicInput.sourceId, version: atomicInput.version } })).toBe(1)
  })

  it('rejects a replay when a durable mention changes immutable source lineage', async () => {
    const replayInput = input({ sourceId: `synthetic://ki17/mention/${randomUUID()}`, version: `mention-${randomUUID()}` })
    const first = await ingestGenesisRag17Raw(replayInput, { db: prisma, viewer, now, transport: sourceTransport, credential: 'test-source' })
    const mention = await prisma.genesisRag17SourceMention.findFirst({ where: { executionRunId: first.run.executionRunId } })
    expect(mention).toBeTruthy()
    await prisma.genesisRag17SourceMention.update({ where: { id: mention.id }, data: { rawArtifactId: 'tampered-raw-artifact' } })

    await expect(ingestGenesisRag17Raw(replayInput, { db: prisma, viewer, now, transport: sourceTransport, credential: 'test-source' }))
      .rejects.toMatchObject({ status: 409, code: 'GENESISRAG17_MENTION_DERIVATION_MISMATCH' })
  })

  it('replays the same raw source without creating a second document lineage or Stage 9 batch', async () => {
    const first = await ingestGenesisRag17Raw(input(), { db: prisma, viewer, now, transport: sourceTransport, credential: 'test-source' })
    const second = await ingestGenesisRag17Raw(input(), { db: prisma, viewer, now, transport: sourceTransport, credential: 'test-source' })
    expect(second.run.executionRunId).toBe(first.run.executionRunId)
    expect(second.source.rawArtifactId).toBe(first.source.rawArtifactId)
    expect(second.source.parsedArtifactId).toBe(first.source.parsedArtifactId)
    expect(await prisma.knowledgeRawArtifact.count({ where: { sourceId: 'synthetic://ki17/test', version: '1' } })).toBe(1)
    expect(await prisma.knowledgeParsedArtifact.count({ where: { rawArtifactId: first.source.rawArtifactId } })).toBe(1)
    expect(await prisma.genesisRag17Batch.count({ where: { executionRunId: first.run.executionRunId } })).toBe(1)
  })

  it('keeps a corrected source version as a separate immutable raw, parsed and chunk lineage', async () => {
    const correctedText = fixtureText.replace('Alice works for Acme Ltd.', 'Alice works for Beacon Ltd.')
    const result = await ingestGenesisRag17Raw(input({ version: '2', content: correctedText }), { db: prisma, viewer, now, transport: sourceTransport, credential: 'test-source' })
    const old = await prisma.knowledgeRawArtifact.findFirst({ where: { sourceId: 'synthetic://ki17/test', version: '1' } })
    const current = await prisma.knowledgeRawArtifact.findUnique({ where: { id: result.source.rawArtifactId } })
    expect(current.id).not.toBe(old.id)
    expect(current.content).toContain('Alice works for Beacon Ltd.')
    expect(old.content).toContain('Alice works for Acme Ltd.')
    expect(result.chunks[0].parsedArtifactId).not.toBe(old.id)
  })

  it('executes an explicit FR-071 replay with new stage attempts and the same raw lineage', async () => {
    const original = await ingestGenesisRag17Raw(input(), { db: prisma, viewer, now, transport: sourceTransport, credential: 'test-source' })
    const replay = await requestPipelineReplay(original.run.executionRunId, {
      scope: 'FULL_RUN',
      correlationId: `ki17-replay-${randomUUID()}`,
      idempotencyKey: `ki17-replay-${randomUUID()}`,
      sourceSha256: original.source.contentHash,
      artifactSha256: original.source.contentHash,
    }, { db: prisma, viewer, now })
    const replayed = await ingestGenesisRag17Raw({ ...input(), replayRunId: replay.run.executionRunId }, { db: prisma, viewer, now, transport: sourceTransport, credential: 'test-source' })

    expect(replayed.status).toBe('REPLAYED')
    expect(replayed.replayed).toBe(true)
    expect(replayed.run.executionRunId).not.toBe(original.run.executionRunId)
    expect(replayed.source.rawArtifactId).toBe(original.source.rawArtifactId)
    expect(replayed.source.parsedArtifactId).toBe(original.source.parsedArtifactId)
    expect(replayed.batch.stage9.attemptId).not.toBe(original.batch.stage9.attemptId)
    expect(await prisma.genesisRag17Batch.count({ where: { executionRunId: original.run.executionRunId } })).toBe(1)
    expect(await prisma.genesisRag17Batch.count({ where: { executionRunId: replayed.run.executionRunId } })).toBe(1)
    const replayEvidence = await prisma.genesisRag17StageEvidence.findMany({ where: { executionRunId: replayed.run.executionRunId }, orderBy: { stageNumber: 'asc' } })
    expect(replayEvidence.map((row) => row.stageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
  })

  it('records Stage 1 failure evidence atomically when the canonical connection is outside scope', async () => {
    const foreign = await createPortfolio({ name: `KI17 foreign ${randomUUID()}`, code: `KI17-F-${randomUUID()}` })
    const foreignTenant = await createTenant({ portfolioId: foreign.id, name: `KI17 foreign tenant ${randomUUID()}`, code: `KI17-FT-${randomUUID()}` })
    const foreignBusiness = await createBusiness({ tenantId: foreignTenant.id, name: `KI17 foreign business ${randomUUID()}`, code: `KI17-FB-${randomUUID()}` })
    const foreignProvider = await prisma.integrationProvider.create({ data: { code: `KI17-FOREIGN-${randomUUID()}`, name: 'Foreign source', status: 'ACTIVE' } })
    const foreignConnection = await prisma.integrationConnection.create({ data: { tenantId: foreignTenant.id, businessId: foreignBusiness.id, providerId: foreignProvider.id, name: 'Foreign connection', status: 'ACTIVE' } })
    const bad = input({ sourceId: `synthetic://ki17/failure/${randomUUID()}`, connectionId: foreignConnection.id })
    await expect(ingestGenesisRag17Raw(bad, { db: prisma, viewer, now, transport: sourceTransport, credential: 'test-source' })).rejects.toThrow(/outside/i)
    const hash = hashGenesisRag17Text(bad.content)
    const run = await prisma.pipelineRun.findFirst({ where: { sourceRef: bad.sourceId, sourceSha256: hash }, orderBy: { createdAt: 'desc' } })
    expect(run).toBeTruthy()
    const stage1 = await prisma.genesisRag17StageEvidence.findFirst({ where: { executionRunId: run.executionRunId, stageNumber: 1 } })
    expect(stage1).toMatchObject({ outcome: 'FAILED', errorCount: 1, recordsQuarantined: 0 })
    const failedStep = await prisma.pipelineStep.findFirst({ where: { runId: run.id, pipelineStageId: 'DPS-KI-INGEST' } })
    expect(failedStep).toMatchObject({ status: 'FAILED', actualCount: 1, insertedCount: 0, failedCount: 1 })
  })
})
