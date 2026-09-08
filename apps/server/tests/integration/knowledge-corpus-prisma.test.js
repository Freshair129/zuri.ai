import { beforeEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import {
  GENESIS_RAG17_SCHEMA_VERSION,
  hashGenesisRag17Json,
  hashGenesisRag17Text,
  stageIdForNumber,
} from '@/modules/knowledge/genesisrag17-contract'
import {
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
} from '@/platform/integrations/core/pipeline-tracking-contract'
import { createKnowledgeExecutionAuthority } from '@/modules/knowledge/knowledge-execution-authority'
import { createKnowledgeRepository } from '@/modules/knowledge/knowledge-repository'
import {
  citationReference,
  publishVerifiedKnowledgeIngestion,
  queryKnowledgeCorpus,
  resolveKnowledgeCitation,
  withdrawKnowledgeSource,
} from '@/modules/knowledge/knowledge-corpus-service'
import { makeViewer } from '../factories/viewer'

// @req FR-172 — the corpus publication transaction and current-access reads
// are proven against the real Prisma models, with native receipt/lineage
// verification kept at the separate GenesisRAG17 acceptance boundary.
// @spec ADR-072, SEC-001, SEC-008
// @tested apps/server/tests/integration/knowledge-corpus-prisma.test.js

function token() {
  return randomUUID().replaceAll('-', '').slice(0, 16)
}

function scopeFor(ids) {
  return {
    portfolioId: ids.portfolioId,
    tenantId: ids.tenantId,
    businessId: ids.businessId,
    workspaceId: ids.workspaceId,
    agentId: 'knowledge-agent',
    visibility: 'private',
  }
}

function receiptFor(ingestion, scope, decisionId) {
  return {
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    scope,
    runId: ingestion.executionRunId,
    decisionId,
    decisionHash: 'a'.repeat(64),
    snapshotId: ingestion.snapshotId,
    generation: ingestion.snapshotGeneration,
    receiptHash: ingestion.receiptHash,
    publishedAt: '2026-09-08T01:00:00.000Z',
    pointerHash: 'c'.repeat(64),
    modelRevision: '614241f622f53c4eeff9890bdc4f31cfecc418b3',
    transactionFrontier: `frontier-${ingestion.id}`,
    readback: { ok: true },
  }
}

function requestFor(ingestion, source, scope, stage9StepId, stage9AttemptId) {
  return {
    schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
    runId: ingestion.executionRunId,
    scope,
    stages: [{
      runId: ingestion.executionRunId,
      pipelineStageId: stageIdForNumber(9),
      executionStepId: stage9StepId,
      attemptId: stage9AttemptId,
      stageNumber: 9,
    }],
    source: {
      sourceId: source.id,
      rawArtifactId: ingestion.rawArtifactId,
      parsedArtifactId: ingestion.parsedArtifactId,
      documentId: source.id,
      version: ingestion.sourceVersion,
      contentHash: ingestion.contentHash,
    },
  }
}

function seamRepository({ receipts, lineages }) {
  const wrap = (delegate) => ({
    ...delegate,
    verifyPublication: async (executionRunId) => receipts.get(executionRunId) || null,
    resolveLineage: async (reference) => {
      const record = lineages.get(reference.chunkId)
      if (!record) return null
      const ingestion = await prisma.knowledgeIngestion.findUnique({ where: { id: record.ingestionId } })
      if (!ingestion) return null
      return {
        sourceId: ingestion.sourceId,
        documentId: ingestion.sourceId,
        version: ingestion.sourceVersion,
        rawArtifactId: ingestion.rawArtifactId,
        parsedArtifactId: ingestion.parsedArtifactId,
        contentHash: ingestion.contentHash,
        chunkId: reference.chunkId,
        text: record.text,
        startOffset: 0,
        endOffset: record.text.length,
      }
    },
    transaction: (callback) => delegate.transaction((tx) => callback(wrap(tx))),
  })
  return wrap(createKnowledgeRepository(prisma))
}

async function createFixture() {
  const suffix = token()
  const ids = {
    portfolioId: `portfolio-${suffix}`,
    tenantId: `tenant-${suffix}`,
    businessId: `business-${suffix}`,
    workspaceId: `workspace-${suffix}`,
    projectId: `project-${suffix}`,
    personId: `person-${suffix}`,
    corpusId: `corpus-${suffix}`,
    sourceId: `source-${suffix}`,
    ingestionId: `ingestion-${suffix}-v1`,
  }
  const scope = scopeFor(ids)
  await prisma.portfolio.create({ data: { id: ids.portfolioId, code: `PORT-${suffix}`, name: 'Knowledge test portfolio' } })
  await prisma.tenant.create({ data: { id: ids.tenantId, code: `TEN-${suffix}`, portfolioId: ids.portfolioId, name: 'Knowledge test tenant' } })
  await prisma.business.create({ data: { id: ids.businessId, code: `BUS-${suffix}`, tenantId: ids.tenantId, name: 'Knowledge test business' } })
  await prisma.workspace.create({ data: { id: ids.workspaceId, code: `WS-${suffix}`, name: 'Knowledge test workspace', scopeType: 'BUSINESS', portfolioId: ids.portfolioId, tenantId: ids.tenantId, businessId: ids.businessId } })
  await prisma.project.create({ data: { id: ids.projectId, code: `PRJ-${suffix}`, businessId: ids.businessId, workspaceId: ids.workspaceId, name: 'Knowledge test project' } })
  await prisma.person.create({ data: { id: ids.personId, code: `PER-${suffix}`, displayName: 'Knowledge test reader' } })
  await prisma.membership.create({ data: { id: `membership-${suffix}`, personId: ids.personId, tenantId: ids.tenantId, businessId: ids.businessId, role: 'MEMBER', status: 'ACTIVE', domainKeysJson: '[]' } })
  await prisma.knowledgeCorpus.create({
    data: {
      id: ids.corpusId,
      corpusKey: `knowledge:${ids.businessId}:${ids.projectId}`,
      portfolioId: ids.portfolioId,
      tenantId: ids.tenantId,
      businessId: ids.businessId,
      projectId: ids.projectId,
      workspaceId: ids.workspaceId,
      scopeJson: JSON.stringify(scope),
      policyJson: JSON.stringify({ allowEmbedding: true, allowPublication: true }),
      status: 'ACTIVE',
    },
  })
  const source = await prisma.knowledgeSource.create({
    data: {
      id: ids.sourceId,
      corpusId: ids.corpusId,
      sourceKey: `source:${suffix}`,
      kind: 'TEXT',
      title: 'Knowledge test source',
      desiredRevision: 1,
    },
  })
  const receipts = new Map()
  const lineages = new Map()

  async function createIngestion({ id, revision, sourceVersion, content, snapshotId, snapshotGeneration, sourceRow = source }) {
    const executionRunId = `execution-${id}`
    const rawArtifactId = `raw-${id}`
    const parsedArtifactId = `parsed-${id}`
    const receiptHash = `${String(revision).repeat(64)}`.slice(0, 64)
    const ingestion = await prisma.knowledgeIngestion.create({
      data: {
        id,
        corpusId: ids.corpusId,
        sourceId: sourceRow.id,
        revision,
        sourceVersion,
        contentHash: hashGenesisRag17Text(content),
        content,
        sourceMetaJson: '{}',
        idempotencyKey: `idempotency-${id}`,
        requestHash: hashGenesisRag17Json({ id, content }),
        submittedById: ids.personId,
        status: 'QUEUED',
        executionRunId,
        rawArtifactId,
        parsedArtifactId,
        snapshotId,
        snapshotGeneration,
        receiptHash,
        attempts: 1,
      },
    })
    const run = await prisma.pipelineRun.create({
      data: {
        id: `pipeline-${id}`,
        executionRunId,
        dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
        executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID,
        tenantId: ids.tenantId,
        businessId: ids.businessId,
        status: 'SUCCEEDED',
        sourceSha256: ingestion.contentHash,
        artifactRef: rawArtifactId,
        correlationId: `correlation-${id}`,
        idempotencyKey: `pipeline-idempotency-${id}`,
        requestHash: ingestion.requestHash,
      },
    })
    const stage9StepId = `stage9-step-${id}`
    const stage9AttemptId = `stage9-attempt-${id}`
    const request = requestFor(ingestion, sourceRow, scope, stage9StepId, stage9AttemptId)
    const decisionId = `decision-${id}`
    await prisma.genesisRag17IngestionIntent.create({
      data: {
        id: `intent-${id}`,
        intentKey: `intent-key-${id}`,
        runId: run.id,
        executionRunId,
        scopeJson: JSON.stringify(scope),
        requestJson: JSON.stringify(request),
        derivationJson: '{}',
        rawArtifactId,
        sourceId: sourceRow.id,
        documentId: sourceRow.id,
        version: sourceVersion,
        contentHash: ingestion.contentHash,
        portfolioId: ids.portfolioId,
        tenantId: ids.tenantId,
        businessId: ids.businessId,
        workspaceId: ids.workspaceId,
        agentId: scope.agentId,
        visibility: scope.visibility,
        status: 'SUCCEEDED',
        nextStageNumber: 10,
      },
    })
    await prisma.genesisRag17Batch.create({
      data: {
        id: `batch-${id}`,
        batchId: `batch-key-${id}`,
        idempotencyKey: `batch-idempotency-${id}`,
        runId: run.id,
        executionRunId,
        stage9StepId,
        stage9AttemptId,
        scopeJson: JSON.stringify(scope),
        requestJson: JSON.stringify(request),
        status: 'SUCCEEDED',
        decisionId,
        responseJson: JSON.stringify({ decisionId }),
      },
    })
    const receipt = receiptFor(ingestion, scope, decisionId)
    receipts.set(executionRunId, receipt)
    lineages.set(`chunk-${id}`, { ingestionId: id, text: content })
    return ingestion
  }

  const firstIngestion = await createIngestion({
    id: ids.ingestionId,
    revision: 1,
    sourceVersion: 'v1',
    content: 'alpha document',
    snapshotId: `snapshot-${suffix}-1`,
    snapshotGeneration: `native-${suffix}-1`,
  })
  const repository = seamRepository({ receipts, lineages })
  const reader = makeViewer({ role: 'MEMBER', visibleBusinessIds: [ids.businessId], ownedBusinessIds: [] })
  const owner = makeViewer({ visibleBusinessIds: [ids.businessId], ownedBusinessIds: [ids.businessId] })
  const denied = () => makeViewer({ role: 'MEMBER', visibleBusinessIds: [], ownedBusinessIds: [] })
  const resolveCurrentViewer = async () => {
    const membership = await prisma.membership.findFirst({ where: { personId: ids.personId, businessId: ids.businessId, status: 'ACTIVE' } })
    return membership ? reader : denied()
  }
  return { ids, scope, source, firstIngestion, repository, receipts, lineages, reader, owner, resolveCurrentViewer, createIngestion }
}

async function publish(fixture, ingestion) {
  return publishVerifiedKnowledgeIngestion(ingestion.id, {
    repository: fixture.repository,
    db: prisma,
    authority: createKnowledgeExecutionAuthority(fixture.scope, 'execute', ingestion.executionRunId),
  })
}

describe('knowledge corpus Prisma transaction boundary', () => {
  let fixture

  beforeEach(async () => {
    fixture = await createFixture()
  })

  it('publishes through real corpus/source/ingestion/generation rows and is idempotent', async () => {
    const first = await publish(fixture, fixture.firstIngestion)
    expect(first.status).toBe('PUBLISHED')
    expect(await prisma.knowledgeCorpus.findUnique({ where: { id: fixture.ids.corpusId } })).toMatchObject({ generation: 1, version: 2 })
    expect(await prisma.knowledgeCorpusGeneration.count({ where: { corpusId: fixture.ids.corpusId } })).toBe(1)
    expect(await prisma.knowledgeIngestion.findUnique({ where: { id: fixture.firstIngestion.id } })).toMatchObject({ status: 'PUBLISHED', snapshotId: fixture.firstIngestion.snapshotId })

    const repeated = await publish(fixture, fixture.firstIngestion)
    expect(repeated.status).toBe('UNCHANGED')
    expect(await prisma.knowledgeCorpusGeneration.count({ where: { corpusId: fixture.ids.corpusId } })).toBe(1)
    expect(first.manifestHash).toBe(hashGenesisRag17Json(JSON.parse(first.generation.manifestJson)))
  })

  it('preserves a historical generation across correction, then withdraws with CAS', async () => {
    const first = await publish(fixture, fixture.firstIngestion)
    const oldCitation = citationReference({
      corpusId: fixture.ids.corpusId,
      corpusGeneration: first.corpus.generation,
      sourceId: fixture.source.id,
      ingestionId: fixture.firstIngestion.id,
      chunkId: `chunk-${fixture.firstIngestion.id}`,
    })
    await prisma.knowledgeSource.update({ where: { id: fixture.source.id }, data: { desiredRevision: 2 } })
    const correction = await fixture.createIngestion({
      id: `${fixture.ids.ingestionId}-v2`,
      revision: 2,
      sourceVersion: 'v2',
      content: 'alpha corrected',
      snapshotId: `${fixture.firstIngestion.snapshotId}-v2`,
      snapshotGeneration: `${fixture.firstIngestion.snapshotGeneration}-v2`,
    })
    const corrected = await publish(fixture, correction)
    expect(corrected.corpus.generation).toBe(2)
    expect(await prisma.knowledgeCorpusGeneration.count({ where: { corpusId: fixture.ids.corpusId } })).toBe(2)
    const historical = await resolveKnowledgeCitation(oldCitation, { repository: fixture.repository, db: prisma, viewer: fixture.reader })
    expect(historical).toMatchObject({ ingestionId: fixture.firstIngestion.id, text: 'alpha document', contentHash: fixture.firstIngestion.contentHash })

    const sourceBeforeWithdraw = await prisma.knowledgeSource.findUnique({ where: { id: fixture.source.id } })
    const withdrawn = await withdrawKnowledgeSource(fixture.source.id, { expectedVersion: sourceBeforeWithdraw.version }, { repository: fixture.repository, db: prisma, viewer: fixture.owner })
    expect(withdrawn.status).toBe('WITHDRAWN')
    expect(withdrawn.manifest.entries).toHaveLength(0)
    expect(await prisma.knowledgeCorpusGeneration.count({ where: { corpusId: fixture.ids.corpusId } })).toBe(3)
    expect(await prisma.knowledgeCorpusGeneration.findUnique({ where: { corpusId_number: { corpusId: fixture.ids.corpusId, number: 1 } } })).toBeTruthy()
    await expect(resolveKnowledgeCitation(oldCitation, { repository: fixture.repository, db: prisma, viewer: fixture.reader }))
      .rejects.toMatchObject({ status: 404, code: 'KNOWLEDGE_SOURCE_REVOKED' })
    await expect(withdrawKnowledgeSource(fixture.source.id, { expectedVersion: sourceBeforeWithdraw.version }, { repository: fixture.repository, db: prisma, viewer: fixture.owner }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_SOURCE_VERSION_CONFLICT' })
  })

  it('withdraws a deleted FILE source and preserves a remaining corpus source', async () => {
    const fileAssetId = `file-${fixture.ids.sourceId}`
    await prisma.fileAsset.create({
      data: {
        id: fileAssetId,
        code: `FILE-${token()}`,
        tenantId: fixture.ids.tenantId,
        businessId: fixture.ids.businessId,
        projectId: fixture.ids.projectId,
        storageKind: 'LOCAL',
        relativePath: 'knowledge-test.txt',
        name: 'knowledge-test.txt',
        mime: 'text/plain',
        size: fixture.firstIngestion.content.length,
        sha256: fixture.firstIngestion.contentHash,
        status: 'ACTIVE',
      },
    })
    const source = await prisma.knowledgeSource.update({ where: { id: fixture.source.id }, data: { fileAssetId } })
    fixture.source = source
    await publish(fixture, fixture.firstIngestion)

    const remainingSource = await prisma.knowledgeSource.create({
      data: {
        id: `source-${fixture.ids.sourceId}-remaining`,
        corpusId: fixture.ids.corpusId,
        sourceKey: `source:${fixture.ids.sourceId}:remaining`,
        kind: 'TEXT',
        title: 'Remaining knowledge source',
        desiredRevision: 1,
      },
    })
    const remainingIngestion = await fixture.createIngestion({
      id: `${fixture.ids.ingestionId}-remaining`,
      revision: 1,
      sourceVersion: 'v1',
      content: 'remaining document',
      snapshotId: `${fixture.firstIngestion.snapshotId}-remaining`,
      snapshotGeneration: `${fixture.firstIngestion.snapshotGeneration}-remaining`,
      sourceRow: remainingSource,
    })
    await publish(fixture, remainingIngestion)

    await prisma.fileAsset.update({ where: { id: fileAssetId }, data: { status: 'DELETED', deletedAt: new Date() } })
    const sourceBeforeWithdraw = await prisma.knowledgeSource.findUnique({ where: { id: fixture.source.id } })
    const withdrawn = await withdrawKnowledgeSource(fixture.source.id, { expectedVersion: sourceBeforeWithdraw.version }, { repository: fixture.repository, db: prisma, viewer: fixture.owner })
    expect(withdrawn.status).toBe('WITHDRAWN')
    expect(withdrawn.manifest.entries.map((entry) => entry.sourceId)).toEqual([remainingSource.id])
    expect((await prisma.knowledgeSource.findUnique({ where: { id: fixture.source.id } })).revokedAt).not.toBeNull()

    const querySnapshot = vi.fn(async () => ({
      schemaVersion: GENESIS_RAG17_SCHEMA_VERSION,
      scope: fixture.scope,
      snapshotId: remainingIngestion.snapshotId,
      generation: remainingIngestion.snapshotGeneration,
      results: [{
        id: `hit-${remainingIngestion.id}`,
        score: 0.8,
        text: remainingIngestion.content,
        citation: {
          sourceId: remainingSource.id,
          rawArtifactId: remainingIngestion.rawArtifactId,
          parsedArtifactId: remainingIngestion.parsedArtifactId,
          chunkId: `chunk-${remainingIngestion.id}`,
          contentHash: hashGenesisRag17Text(remainingIngestion.content),
        },
      }],
    }))
    const queried = await queryKnowledgeCorpus({ businessId: fixture.ids.businessId, projectId: fixture.ids.projectId, query: 'remaining' }, {
      repository: fixture.repository,
      db: prisma,
      viewer: fixture.reader,
      querySnapshot,
    })
    expect(queried.results).toHaveLength(1)
    expect(queried.results[0].sourceId).toBe(remainingSource.id)
  })

  it('rechecks a real membership-backed viewer before delayed query disclosure', async () => {
    await publish(fixture, fixture.firstIngestion)
    const querySnapshot = vi.fn(async () => {
      await prisma.membership.updateMany({ where: { personId: fixture.ids.personId, businessId: fixture.ids.businessId }, data: { status: 'REVOKED' } })
      return { schemaVersion: GENESIS_RAG17_SCHEMA_VERSION, scope: fixture.scope, snapshotId: fixture.firstIngestion.snapshotId, generation: fixture.firstIngestion.snapshotGeneration, results: [] }
    })
    await expect(queryKnowledgeCorpus({ businessId: fixture.ids.businessId, projectId: fixture.ids.projectId, query: 'alpha' }, {
      repository: fixture.repository,
      db: prisma,
      viewer: fixture.reader,
      querySnapshot,
      resolveCurrentViewer: fixture.resolveCurrentViewer,
    })).rejects.toMatchObject({ status: 404, code: 'KNOWLEDGE_BUSINESS_NOT_FOUND' })
    expect(querySnapshot).toHaveBeenCalledTimes(1)
  })

  it('rechecks the current corpus before returning delayed historical citation text', async () => {
    const published = await publish(fixture, fixture.firstIngestion)
    const citationId = citationReference({
      corpusId: fixture.ids.corpusId,
      corpusGeneration: published.corpus.generation,
      sourceId: fixture.source.id,
      ingestionId: fixture.firstIngestion.id,
      chunkId: `chunk-${fixture.firstIngestion.id}`,
    })
    const resolveLineage = fixture.repository.resolveLineage
    fixture.repository.resolveLineage = async (...args) => {
      await prisma.knowledgeCorpus.update({ where: { id: fixture.ids.corpusId }, data: { status: 'DISABLED' } })
      return resolveLineage(...args)
    }
    await expect(resolveKnowledgeCitation(citationId, {
      repository: fixture.repository,
      db: prisma,
      viewer: fixture.reader,
      resolveCurrentViewer: fixture.resolveCurrentViewer,
    })).rejects.toMatchObject({ status: 404, code: 'KNOWLEDGE_CORPUS_NOT_FOUND' })
  })

  it('returns a lineage mismatch when the pinned chunk is absent', async () => {
    const published = await publish(fixture, fixture.firstIngestion)
    const citationId = citationReference({
      corpusId: fixture.ids.corpusId,
      corpusGeneration: published.corpus.generation,
      sourceId: fixture.source.id,
      ingestionId: fixture.firstIngestion.id,
      chunkId: `chunk-${fixture.firstIngestion.id}`,
    })
    fixture.lineages.delete(`chunk-${fixture.firstIngestion.id}`)
    await expect(resolveKnowledgeCitation(citationId, {
      repository: fixture.repository,
      db: prisma,
      viewer: fixture.reader,
    })).rejects.toMatchObject({ status: 502, code: 'KNOWLEDGE_LINEAGE_MISMATCH' })
  })

  it('rejects a generation whose stored manifest JSON has an unrepresented field', async () => {
    const published = await publish(fixture, fixture.firstIngestion)
    const row = await prisma.knowledgeCorpusGeneration.findUnique({ where: { corpusId_number: { corpusId: fixture.ids.corpusId, number: published.corpus.generation } } })
    const tampered = JSON.parse(row.manifestJson)
    tampered.unknownField = 'must not be discarded before hashing'
    await prisma.knowledgeCorpusGeneration.update({ where: { id: row.id }, data: { manifestJson: JSON.stringify(tampered) } })
    const querySnapshot = vi.fn()
    await expect(queryKnowledgeCorpus({ businessId: fixture.ids.businessId, projectId: fixture.ids.projectId, query: 'alpha' }, { repository: fixture.repository, db: prisma, viewer: fixture.reader, querySnapshot }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_MANIFEST_TAMPERED' })
    const citationId = citationReference({ corpusId: fixture.ids.corpusId, corpusGeneration: published.corpus.generation, sourceId: fixture.source.id, ingestionId: fixture.firstIngestion.id, chunkId: `chunk-${fixture.firstIngestion.id}` })
    await expect(resolveKnowledgeCitation(citationId, { repository: fixture.repository, db: prisma, viewer: fixture.reader }))
      .rejects.toMatchObject({ status: 409, code: 'KNOWLEDGE_MANIFEST_TAMPERED' })
  })
})
