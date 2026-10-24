// @req FR-173, FR-071 — replay a failed Knowledge admission with the same
// immutable source version and a new linked pipeline run.
// @spec ADR-072, ADR-030 D4-D6, SEC-001, SEC-003, SEC-008
// @tested tests/unit/knowledge-replay-service.test.js
import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { hasKnowledgeRunAuthority } from '@/modules/knowledge/knowledge-execution-authority'
import { resolveApiAccessViewer } from '@/modules/identity/api-access-auth'
import { makeViewer } from '../factories/viewer'
import { KNOWLEDGE_INGESTION_CONTRACT_ID, KNOWLEDGE_INGESTION_DEFINITION_ID } from '@/platform/integrations/core/pipeline-tracking-contract'
import { encodeKnowledgeBinary, KNOWLEDGE_BINARY_ENCODING, KNOWLEDGE_BINARY_PARSER_VERSION } from '@/modules/knowledge/knowledge-binary-parser'

const service = await import('@/modules/knowledge/knowledge-replay-service').catch(() => null)

const scope = {
  portfolioId: 'portfolio-1',
  tenantId: 'tenant-1',
  businessId: 'business-1',
  workspaceId: 'workspace-1',
  agentId: 'agent-1',
  visibility: 'private',
}
const content = '{"sku":"DEMO-KB-MUG-350-001"}'
const fileBytes = Buffer.from('{"catalogVersion":1}', 'utf8')
const fileSha256 = createHash('sha256').update(fileBytes).digest('hex')
const contentHash = createHash('sha256').update(content, 'utf8').digest('hex')

function fixture() {
  const at = new Date('2026-10-24T03:00:00.000Z')
  const state = {
    corpus: {
      id: 'corpus-1', businessId: scope.businessId, projectId: null, tenantId: scope.tenantId,
      status: 'ACTIVE', deletedAt: null, scopeJson: JSON.stringify(scope),
      policyJson: JSON.stringify({ allowEmbedding: true, allowPublication: true }), version: 3,
    },
    source: {
      id: 'source-1', corpusId: 'corpus-1', kind: 'FILE', sourceKey: 'DEMO-KB-MUG-350-001',
      title: 'Demo mug', fileAssetId: 'asset-1', desiredRevision: 1, activeIngestionId: null,
      version: 4, revokedAt: null, deletedAt: null,
    },
    asset: {
      id: 'asset-1', businessId: scope.businessId, tenantId: scope.tenantId, projectId: null,
      name: 'demo-catalog.json', mime: 'application/json', size: fileBytes.length,
      status: 'ACTIVE', storageKind: 'MANAGED_BLOB', sha256: fileSha256, version: 7,
      deletedAt: null, blobRef: 'managed://asset-1',
    },
    ingestion: {
      id: 'ingestion-1', corpusId: 'corpus-1', sourceId: 'source-1', revision: 1,
      sourceVersion: 'catalog-record-v1', contentHash, content,
      sourceMetaJson: JSON.stringify({
        kind: 'FILE', fileAssetId: 'asset-1', fileAssetVersion: 7, mime: 'application/json',
        size: Buffer.byteLength(content, 'utf8'), storageKind: 'MANAGED_BLOB', sourceVersion: 'catalog-record-v1',
        contentHash, projectId: null,
        structured: { provider: 'SMARTGIFT_CATALOG', entityType: 'ProductMaster', fileSha256 },
      }),
      status: 'FAILED', executionRunId: 'run-failed', rawArtifactId: 'raw-1', parsedArtifactId: 'parsed-1',
      snapshotId: null, snapshotGeneration: null, receiptHash: null, claimToken: null,
      leaseExpiresAt: null, attempts: 1, failureCode: 'KNOWLEDGE_PIPELINE_FAILED', version: 9,
      createdAt: at, updatedAt: at,
    },
    runs: [{
      id: 'pipeline-row-1', executionRunId: 'run-failed', dataPipelineDefinitionId: KNOWLEDGE_INGESTION_DEFINITION_ID,
      executionContractId: KNOWLEDGE_INGESTION_CONTRACT_ID, tenantId: scope.tenantId,
      businessId: scope.businessId, status: 'FAILED', currentStageId: 'DPS-KI-INDEX',
      primaryFailureCode: 'GENESISRAG17_EXTERNAL_STAGE_FAILED', sourceRef: 'knowledge-source:source-1', sourceSha256: contentHash,
      artifactRef: 'raw-1', artifactSha256: contentHash, idempotencyKey: 'initial-run', requestHash: 'initial-hash',
      replayOfExecutionRunId: null,
    }],
    stageEvidence: [{
      runId: 'pipeline-row-1', executionRunId: 'run-failed', pipelineStageId: 'DPS-KI-INDEX',
      executionStepId: 'step-stage-16', attemptId: 'attempt-stage-16', stageNumber: 16, outcome: 'FAILED',
      detailsJson: JSON.stringify({ failureHash: 'e'.repeat(64), error: { code: 'BENCHMARK_NO_APPLICABLE_QUERIES', message: 'No applicable benchmark query' } }),
    }],
    stageSteps: [{
      id: 'pipeline-step-16', runId: 'pipeline-row-1', pipelineStageId: 'DPS-KI-INDEX',
      executionStepId: 'step-stage-16', attemptId: 'attempt-stage-16', sequence: 16, status: 'FAILED',
      createdAt: at,
    }],
    audits: [],
  }
  const repository = {
    transaction: (callback) => callback(repository, db),
    getIngestion: async (id) => state.ingestion?.id === id ? state.ingestion : null,
    getCorpus: async (id) => state.corpus?.id === id ? state.corpus : null,
    getSource: async (id) => state.source?.id === id ? state.source : null,
    getPipelineRun: async (executionRunId) => state.runs.find((run) => run.executionRunId === executionRunId) || null,
    getPipelineRunByIdempotencyKey: async (idempotencyKey) => state.runs.find((run) => run.idempotencyKey === idempotencyKey) || null,
    listStageEvidence: async (executionRunId) => state.stageEvidence.filter((row) => row.executionRunId === executionRunId),
    listPipelineStepsForStage: async (runId, pipelineStageId) => state.stageSteps
      .filter((step) => step.runId === runId && step.pipelineStageId === pipelineStageId)
      .sort((left, right) => right.sequence - left.sequence || right.createdAt - left.createdAt),
    getFileAsset: async (id) => state.asset?.id === id ? state.asset : null,
    retryFailedIngestion: async (id, options) => {
      const row = state.ingestion
      if (!row || row.id !== id || row.status !== 'FAILED' || row.version !== options.expectedVersion
        || row.executionRunId !== options.expectedExecutionRunId || row.claimToken !== null
        || row.leaseExpiresAt && row.leaseExpiresAt > options.now) return null
      Object.assign(row, {
        status: 'QUEUED', executionRunId: options.executionRunId, failureCode: null,
        claimToken: null, leaseExpiresAt: null, version: row.version + 1, updatedAt: options.now,
      })
      return row
    },
    audit: async (event) => { state.audits.push(event); return event },
  }
  const db = {
    fileAsset: { findUnique: async ({ where }) => repository.getFileAsset(where.id) },
    $transaction: undefined,
  }
  const authorization = vi.fn(async () => ({ authorized: true, asset: state.asset }))
  const fileContentResolver = vi.fn(async () => ({ content: fileBytes, asset: state.asset }))
  const pipelineReplay = vi.fn(async (executionRunId, input, options) => {
    const parent = await repository.getPipelineRun(executionRunId)
    expect(hasKnowledgeRunAuthority(options.viewer, parent)).toBe(true)
    const run = {
      ...parent, id: 'pipeline-row-2', executionRunId: 'run-replay',
      status: 'QUEUED', idempotencyKey: input.idempotencyKey,
      requestHash: 'replay-hash', replayScope: 'FULL_RUN', replayOfExecutionRunId: executionRunId,
    }
    state.runs.push(run)
    return { status: 'CREATED', run, workerExecution: 'PENDING' }
  })
  const runtimeResolver = vi.fn(async () => ({ scope, policy: { allowEmbedding: true, allowPublication: true } }))
  return { at, state, repository, db, authorization, fileContentResolver, pipelineReplay, runtimeResolver }
}

describe('Knowledge admission replay service', () => {
  it('requeues the same immutable source version against a new FR-071 child run', async () => {
    expect(service?.retryKnowledgeIngestion).toBeTypeOf('function')
    const f = fixture()

    const result = await service.retryKnowledgeIngestion('ingestion-1', { idempotencyKey: 'owner-retry-1' }, {
      db: f.db, viewer: makeViewer({ role: 'OWNER', principal: { id: 'owner-1', code: 'PER-OWNER', displayName: 'Owner' }, visibleBusinessIds: ['business-1'], ownedBusinessIds: ['business-1'] }), now: f.at, repository: f.repository,
      authorization: f.authorization, fileContentResolver: f.fileContentResolver, pipelineReplay: f.pipelineReplay,
      runtimeResolver: f.runtimeResolver,
    })

    expect(result).toMatchObject({
      id: 'ingestion-1', status: 'QUEUED', executionRunId: 'run-replay',
      replayOfExecutionRunId: 'run-failed', sourceVersion: 'catalog-record-v1', contentHash,
      unchanged: false,
    })
    expect(f.state.ingestion).toMatchObject({
      status: 'QUEUED', executionRunId: 'run-replay', sourceVersion: 'catalog-record-v1',
      contentHash, content, rawArtifactId: 'raw-1', parsedArtifactId: 'parsed-1', failureCode: null,
    })
    expect(f.state.runs[0]).toMatchObject({ status: 'FAILED', executionRunId: 'run-failed', replayOfExecutionRunId: null })
    expect(f.state.runs[1]).toMatchObject({ status: 'QUEUED', replayOfExecutionRunId: 'run-failed' })
    expect(f.pipelineReplay).toHaveBeenCalledWith('run-failed', expect.objectContaining({
      scope: 'FULL_RUN', sourceSha256: contentHash, artifactSha256: contentHash,
    }), expect.objectContaining({ db: f.db }))
    expect(f.fileContentResolver).toHaveBeenCalledWith('asset-1', expect.objectContaining({ visibleBusinessIds: ['business-1'] }))
    expect(f.state.audits).toHaveLength(1)
    expect(f.state.audits[0]).toMatchObject({
      entityId: 'ingestion-1', action: 'KNOWLEDGE_INGESTION_REPLAY_REQUESTED',
      payload: { originalExecutionRunId: 'run-failed', replayExecutionRunId: 'run-replay', sourceVersion: 'catalog-record-v1', contentHash },
    })
  })

  it('returns the already attached child for a repeated idempotency key while queued', async () => {
    expect(service?.retryKnowledgeIngestion).toBeTypeOf('function')
    const f = fixture()
    const options = {
      db: f.db, viewer: makeViewer({ role: 'OWNER', principal: { id: 'owner-1', code: 'PER-OWNER', displayName: 'Owner' }, visibleBusinessIds: ['business-1'], ownedBusinessIds: ['business-1'] }), now: f.at, repository: f.repository,
      authorization: f.authorization, fileContentResolver: f.fileContentResolver, pipelineReplay: f.pipelineReplay,
      runtimeResolver: f.runtimeResolver,
    }
    await service.retryKnowledgeIngestion('ingestion-1', { idempotencyKey: 'owner-retry-1' }, options)
    const repeated = await service.retryKnowledgeIngestion('ingestion-1', { idempotencyKey: 'owner-retry-1' }, options)

    expect(repeated).toMatchObject({ status: 'QUEUED', executionRunId: 'run-replay', replayOfExecutionRunId: 'run-failed', unchanged: true })
    expect(f.pipelineReplay).toHaveBeenCalledTimes(1)
  })

  it.each(['P2002', 'KNOWLEDGE_REPLAY_CONFLICT'])('recovers a committed same-key winner after %s', async (raceCode) => {
    const f = fixture()
    const options = {
      db: f.db, viewer: makeViewer({ role: 'OWNER', principal: { id: 'owner-1', code: 'PER-OWNER', displayName: 'Owner' }, visibleBusinessIds: ['business-1'], ownedBusinessIds: ['business-1'] }), now: f.at, repository: f.repository,
      authorization: f.authorization, fileContentResolver: f.fileContentResolver, pipelineReplay: f.pipelineReplay,
      runtimeResolver: f.runtimeResolver,
    }
    f.pipelineReplay.mockImplementationOnce(async (executionRunId, input) => {
      const parent = await f.repository.getPipelineRun(executionRunId)
      const winner = {
        ...parent, id: 'pipeline-row-winner', executionRunId: 'run-winner', status: 'QUEUED',
        idempotencyKey: input.idempotencyKey, requestHash: 'winner-hash', replayScope: 'FULL_RUN',
        replayOfExecutionRunId: executionRunId,
      }
      f.state.runs.push(winner)
      Object.assign(f.state.ingestion, { status: 'QUEUED', executionRunId: 'run-winner', failureCode: null, version: f.state.ingestion.version + 1 })
      const error = new Error('unique idempotency key')
      error.code = raceCode
      throw error
    })

    const result = await service.retryKnowledgeIngestion('ingestion-1', { idempotencyKey: 'owner-retry-race' }, options)

    expect(result).toMatchObject({ status: 'QUEUED', executionRunId: 'run-winner', replayOfExecutionRunId: 'run-failed', unchanged: true })
    expect(f.state.runs.filter((run) => run.replayOfExecutionRunId === 'run-failed')).toHaveLength(1)
    expect(f.state.audits).toHaveLength(0)
  })

  it('rejects an older matching Stage 16 failure when the latest attempt failed differently', async () => {
    const f = fixture()
    f.state.stageSteps.push({
      id: 'pipeline-step-16-retry', runId: 'pipeline-row-1', pipelineStageId: 'DPS-KI-INDEX',
      executionStepId: 'step-stage-16-retry', attemptId: 'attempt-stage-16-retry', sequence: 16, status: 'FAILED',
      createdAt: new Date(f.at.getTime() + 1),
    })
    f.state.stageEvidence.push({
      ...f.state.stageEvidence[0], id: 'evidence-stage-16-retry', executionStepId: 'step-stage-16-retry',
      attemptId: 'attempt-stage-16-retry', detailsJson: JSON.stringify({ error: { code: 'OTHER_FAILURE' } }),
    })

    await expect(service.retryKnowledgeIngestion('ingestion-1', { idempotencyKey: 'owner-retry-stale-stage' }, {
      db: f.db, viewer: makeViewer({ role: 'OWNER', principal: { id: 'owner-1', code: 'PER-OWNER', displayName: 'Owner' }, visibleBusinessIds: ['business-1'], ownedBusinessIds: ['business-1'] }), now: f.at, repository: f.repository,
      authorization: f.authorization, fileContentResolver: f.fileContentResolver, pipelineReplay: f.pipelineReplay,
      runtimeResolver: f.runtimeResolver,
    })).rejects.toMatchObject({ code: 'KNOWLEDGE_REPLAY_NOT_ELIGIBLE' })
    expect(f.pipelineReplay).not.toHaveBeenCalled()
  })

  it('verifies a plain text FileAsset against source metadata when its asset hash is null', async () => {
    const f = fixture()
    const plain = Buffer.from('approved plain text knowledge', 'utf8')
    const plainContent = plain.toString('utf8')
    const plainHash = createHash('sha256').update(plain).digest('hex')
    f.state.asset.mime = 'text/plain'
    f.state.asset.sha256 = null
    f.state.asset.size = plain.length
    f.state.ingestion.content = plainContent
    f.state.ingestion.contentHash = plainHash
    f.state.runs[0].sourceSha256 = plainHash
    f.state.runs[0].artifactSha256 = plainHash
    f.state.ingestion.sourceMetaJson = JSON.stringify({
      kind: 'FILE', fileAssetId: 'asset-1', fileAssetVersion: 7, mime: 'text/plain',
      size: plain.length, storageKind: 'MANAGED_BLOB', sourceVersion: 'catalog-record-v1',
      contentHash: plainHash, projectId: null,
    })
    f.fileContentResolver.mockResolvedValue({ content: plain, asset: f.state.asset })

    const result = await service.retryKnowledgeIngestion('ingestion-1', { idempotencyKey: 'owner-retry-plain' }, {
      db: f.db, viewer: makeViewer({ role: 'OWNER', principal: { id: 'owner-1', code: 'PER-OWNER', displayName: 'Owner' }, visibleBusinessIds: ['business-1'], ownedBusinessIds: ['business-1'] }), now: f.at, repository: f.repository,
      authorization: f.authorization, fileContentResolver: f.fileContentResolver, pipelineReplay: f.pipelineReplay,
      runtimeResolver: f.runtimeResolver,
    })

    expect(result).toMatchObject({ status: 'QUEUED', contentHash: plainHash })
  })

  it('verifies typed binary FileAsset bytes instead of the persisted base64 data URL', async () => {
    const f = fixture()
    const rawBytes = Buffer.from('%PDF-1.7\nmanaged source bytes', 'utf8')
    const rawHash = createHash('sha256').update(rawBytes).digest('hex')
    const binaryContent = encodeKnowledgeBinary(rawBytes, 'application/pdf')
    f.state.asset.mime = 'application/pdf'
    f.state.asset.sha256 = null
    f.state.asset.size = rawBytes.length
    f.state.ingestion.content = binaryContent
    f.state.ingestion.contentHash = rawHash
    f.state.runs[0].sourceSha256 = rawHash
    f.state.runs[0].artifactSha256 = rawHash
    f.state.ingestion.sourceMetaJson = JSON.stringify({
      kind: 'FILE', fileAssetId: 'asset-1', fileAssetVersion: 7, mime: 'application/pdf',
      size: rawBytes.length, storageKind: 'MANAGED_BLOB', sourceVersion: 'catalog-record-v1',
      contentHash: rawHash, projectId: null, binaryProfile: KNOWLEDGE_BINARY_PARSER_VERSION,
      binaryEncoding: KNOWLEDGE_BINARY_ENCODING, binaryMediaType: 'application/pdf',
      serialization: 'data-uri-base64', rawByteLength: rawBytes.length,
    })
    f.fileContentResolver.mockResolvedValue({ content: rawBytes, asset: f.state.asset })

    const result = await service.retryKnowledgeIngestion('ingestion-1', { idempotencyKey: 'owner-retry-binary' }, {
      db: f.db, viewer: makeViewer({ role: 'OWNER', principal: { id: 'owner-1', code: 'PER-OWNER', displayName: 'Owner' }, visibleBusinessIds: ['business-1'], ownedBusinessIds: ['business-1'] }), now: f.at, repository: f.repository,
      authorization: f.authorization, fileContentResolver: f.fileContentResolver, pipelineReplay: f.pipelineReplay,
      runtimeResolver: f.runtimeResolver,
    })

    expect(result).toMatchObject({ status: 'QUEUED', contentHash: rawHash })
  })

  it('requires per-Business owner authority and rejects Enterprise API viewers', async () => {
    const apiViewer = await resolveApiAccessViewer({ headers: { get: () => 'Bearer apik_owner-retry-test' } }, {
      db: { apiAccessKey: {
        findUnique: async () => ({ id: 'api-1', tenantId: 'tenant-1', status: 'ACTIVE' }),
        updateMany: async () => ({ count: 1 }),
      } },
    })
    for (const viewer of [
      makeViewer({ role: 'MEMBER', principal: { id: 'member-1', code: 'PER-MEMBER', displayName: 'Member' }, visibleBusinessIds: ['business-1'], ownedBusinessIds: [] }),
      apiViewer,
    ]) {
      const f = fixture()
      await expect(service.retryKnowledgeIngestion('ingestion-1', { idempotencyKey: 'owner-retry-1' }, {
        db: f.db, viewer, now: f.at, repository: f.repository,
        authorization: f.authorization, fileContentResolver: f.fileContentResolver, pipelineReplay: f.pipelineReplay,
        runtimeResolver: f.runtimeResolver,
      })).rejects.toMatchObject({ status: 404, code: 'KNOWLEDGE_ACCESS_DENIED' })
      expect(f.authorization).not.toHaveBeenCalled()
      expect(f.pipelineReplay).not.toHaveBeenCalled()
    }
  })

  it('refuses stale, revoked, leased, non-failed or changed FileAsset versions before creating a replay', async () => {
    expect(service?.retryKnowledgeIngestion).toBeTypeOf('function')
    for (const mutate of [
      (f) => { f.state.ingestion.status = 'RUNNING' },
      (f) => { f.state.source.desiredRevision = 2 },
      (f) => { f.state.source.revokedAt = new Date('2026-10-24T02:00:00.000Z') },
      (f) => { f.state.ingestion.claimToken = 'active-claim' },
      (f) => { f.state.ingestion.leaseExpiresAt = new Date('2026-10-24T03:01:00.000Z') },
      (f) => { f.state.asset.version += 1 },
      (f) => { f.state.asset.sha256 = 'a'.repeat(64) },
      (f) => { f.state.runs[0].primaryFailureCode = 'OTHER_FAILURE' },
      (f) => { f.state.stageEvidence[0].detailsJson = JSON.stringify({ error: { code: 'OTHER_FAILURE' } }) },
      (f) => { f.state.stageEvidence[0].stageNumber = 15 },
    ]) {
      const f = fixture()
      mutate(f)
      await expect(service.retryKnowledgeIngestion('ingestion-1', { idempotencyKey: 'owner-retry-1' }, {
        db: f.db, viewer: makeViewer({ role: 'OWNER', principal: { id: 'owner-1', code: 'PER-OWNER', displayName: 'Owner' }, visibleBusinessIds: ['business-1'], ownedBusinessIds: ['business-1'] }), now: f.at, repository: f.repository,
        authorization: f.authorization, fileContentResolver: f.fileContentResolver, pipelineReplay: f.pipelineReplay,
        runtimeResolver: f.runtimeResolver,
      })).rejects.toMatchObject({ status: expect.any(Number) })
      expect(f.pipelineReplay).not.toHaveBeenCalled()
    }
  })
})
