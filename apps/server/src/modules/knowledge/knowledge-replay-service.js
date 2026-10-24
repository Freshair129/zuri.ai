import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { z } from 'zod'
import prisma from '@/lib/db'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { assertKnowledgeFileWritable, resolveKnowledgeScope } from './knowledge-authorization'
import { resolveFileAssetContent as defaultResolveFileAssetContent } from '@/modules/project-manager/application/file-asset-service'
import { createKnowledgeExecutionAuthority } from './knowledge-execution-authority'
import { createKnowledgeRepository } from './knowledge-repository'
import { resolveKnowledgeRuntimeBinding } from './knowledge-runtime'
import { KNOWLEDGE_INGESTION_CONTRACT_ID, KNOWLEDGE_INGESTION_DEFINITION_ID } from '@/platform/integrations/core/pipeline-tracking-contract'
import { requestKnowledgePipelineReplay } from '@/platform/integrations/core/pipeline-tracking-service'
import { isKnowledgeBenchmarkRetryEligible, latestKnowledgeStageAttempt, knowledgeReplayInput } from './knowledge-replay-contract'
import { decodeKnowledgeBinary, hashKnowledgeBinaryBytes, isKnowledgeBinaryProfile, KNOWLEDGE_BINARY_MAX_BYTES } from './knowledge-binary-parser'

// @req FR-173, FR-071 — retry a failed immutable Knowledge version through a
// new, lineage-bound full-run attempt without changing its source identity.
// @spec ADR-072, ADR-030 D4-D6, SEC-001, SEC-003, SEC-008
// @tested tests/unit/knowledge-replay-service.test.js, tests/integration/knowledge-replay.integration.test.js

const SHA256 = /^[a-f0-9]{64}$/i
const failure = (status, code, message) => Object.assign(new Error(message), { status, code })

function parseJson(value, code, label) {
  try {
    const parsed = JSON.parse(value || '{}')
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed
  } catch {
    throw failure(409, code, `${label} is unavailable for retry`)
  }
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function verifyIngestionContent(target) {
  const { ingestion, source } = target
  let metadata = null
  let binaryBytes = null
  if (source.fileAssetId) {
    metadata = parseJson(ingestion.sourceMetaJson, 'KNOWLEDGE_REPLAY_METADATA_INVALID', 'Knowledge source metadata')
    if (
      !SHA256.test(String(metadata.contentHash || ''))
      || String(metadata.contentHash).toLowerCase() !== String(ingestion.contentHash || '').toLowerCase()
    ) throw failure(409, 'KNOWLEDGE_REPLAY_CONTENT_CHANGED', 'The admitted file metadata no longer matches its immutable content hash')
    const hasBinaryDescriptor = ['binaryProfile', 'binaryEncoding', 'binaryMediaType', 'serialization', 'rawByteLength']
      .some((key) => Object.hasOwn(metadata, key))
    if (hasBinaryDescriptor) {
      const validDescriptor = isKnowledgeBinaryProfile({
        binaryProfile: metadata.binaryProfile,
        binaryEncoding: metadata.binaryEncoding,
        contentType: metadata.binaryMediaType,
      })
      if (
        source.kind !== 'FILE' || !validDescriptor || metadata.serialization !== 'data-uri-base64'
        || !Number.isSafeInteger(metadata.rawByteLength) || metadata.rawByteLength < 1
        || metadata.rawByteLength > KNOWLEDGE_BINARY_MAX_BYTES
        || metadata.size !== metadata.rawByteLength
        || String(metadata.mime || '').toLowerCase() !== String(metadata.binaryMediaType || '').toLowerCase()
      ) throw failure(409, 'KNOWLEDGE_REPLAY_METADATA_INVALID', 'The admitted binary FileAsset descriptor is invalid')
      try {
        binaryBytes = decodeKnowledgeBinary(ingestion.content, {
          binaryProfile: metadata.binaryProfile,
          binaryEncoding: metadata.binaryEncoding,
          contentType: metadata.binaryMediaType,
          maxBytes: KNOWLEDGE_BINARY_MAX_BYTES,
        })
      } catch {
        throw failure(409, 'KNOWLEDGE_REPLAY_CONTENT_CHANGED', 'The immutable binary Knowledge source failed its integrity check')
      }
      if (
        binaryBytes.length !== metadata.rawByteLength
        || hashKnowledgeBinaryBytes(binaryBytes) !== String(ingestion.contentHash).toLowerCase()
      ) {
        throw failure(409, 'KNOWLEDGE_REPLAY_CONTENT_CHANGED', 'The immutable binary Knowledge source failed its integrity check')
      }
    } else if (!Number.isSafeInteger(metadata.size) || metadata.size !== Buffer.byteLength(ingestion.content, 'utf8')) {
      throw failure(409, 'KNOWLEDGE_REPLAY_METADATA_INVALID', 'The admitted FileAsset content size is invalid')
    }
  }

  if (!binaryBytes && sha256(Buffer.from(ingestion.content, 'utf8')) !== String(ingestion.contentHash).toLowerCase()) {
    throw failure(409, 'KNOWLEDGE_REPLAY_CONTENT_CHANGED', 'The immutable Knowledge source content failed its integrity check')
  }
  return { metadata, binaryBytes }
}

function resolveNow(now) {
  const value = typeof now === 'function' ? now() : now || new Date()
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) throw new Error('Invalid replay timestamp')
  return value
}

function targetAvailable(target) {
  const { ingestion, corpus, source } = target
  if (!ingestion || !corpus || !source || ingestion.corpusId !== corpus.id || source.corpusId !== corpus.id) {
    throw failure(404, 'KNOWLEDGE_INGESTION_NOT_FOUND', 'Knowledge ingestion not found')
  }
  if (corpus.deletedAt || corpus.status !== 'ACTIVE') throw failure(409, 'KNOWLEDGE_CORPUS_UNAVAILABLE', 'Knowledge corpus is unavailable')
  if (source.deletedAt || source.revokedAt) throw failure(409, 'KNOWLEDGE_SOURCE_WITHDRAWN', 'Knowledge source is withdrawn')
  if (source.desiredRevision !== ingestion.revision) throw failure(409, 'KNOWLEDGE_SOURCE_SUPERSEDED', 'A newer Knowledge source revision exists')
}

function targetFailure(target, now) {
  targetAvailable(target)
  const { ingestion } = target
  if (ingestion.status !== 'FAILED') throw failure(409, 'KNOWLEDGE_REPLAY_NOT_FAILED', 'Only a failed Knowledge admission can be retried')
  if (ingestion.snapshotId || ingestion.snapshotGeneration || ingestion.receiptHash) {
    throw failure(409, 'KNOWLEDGE_REPLAY_ALREADY_PUBLISHED', 'A published Knowledge admission cannot be retried')
  }
  if (ingestion.claimToken || ingestion.leaseExpiresAt && ingestion.leaseExpiresAt > now) {
    throw failure(409, 'KNOWLEDGE_REPLAY_LEASE_ACTIVE', 'Knowledge admission still has a worker claim')
  }
}

async function authorizeReplay(target, { db, env, viewer, authorization }) {
  const { corpus, source } = target
  if (viewer?.isApiAccess === true || !ownsBusiness(viewer, corpus.businessId)) {
    throw failure(404, 'KNOWLEDGE_ACCESS_DENIED', 'Knowledge access denied')
  }
  const args = {
    viewer,
    operation: 'write',
    businessId: corpus.businessId,
    projectId: corpus.projectId || null,
    source: { kind: source.kind, sourceKey: source.sourceKey, fileAssetId: source.fileAssetId || undefined },
  }
  if (authorization) {
    const result = await authorization(args, { db, env })
    if (result === false || result?.authorized === false) throw failure(403, 'KNOWLEDGE_ACCESS_DENIED', 'Knowledge access denied')
    return result || { authorized: true }
  }
  if (source.fileAssetId) {
    return assertKnowledgeFileWritable(viewer, source.fileAssetId, {
      businessId: corpus.businessId,
      projectId: corpus.projectId || null,
      db,
      env,
    })
  }
  return resolveKnowledgeScope({
    viewer,
    businessId: corpus.businessId,
    projectId: corpus.projectId || null,
    action: 'write',
    db,
    env,
  })
}

async function verifyCurrentFileAsset(target, access, { db, fileContentResolver, contentProof }) {
  const { ingestion, corpus, source } = target
  if (!source.fileAssetId) return null
  const { metadata, binaryBytes } = contentProof || verifyIngestionContent(target)
  const asset = access?.asset || await db.fileAsset?.findUnique?.({ where: { id: source.fileAssetId } })
  if (
    !asset || asset.id !== source.fileAssetId || asset.deletedAt || asset.status !== 'ACTIVE'
    || asset.businessId !== corpus.businessId || asset.tenantId !== corpus.tenantId
    || asset.version !== metadata.fileAssetVersion || asset.mime !== metadata.mime
    || asset.storageKind !== metadata.storageKind || metadata.fileAssetId !== asset.id
    || metadata.kind !== source.kind || !Number.isSafeInteger(metadata.size)
    || metadata.sourceVersion !== ingestion.sourceVersion
    || String(metadata.contentHash).toLowerCase() !== String(ingestion.contentHash).toLowerCase()
  ) {
    throw failure(409, 'KNOWLEDGE_REPLAY_FILE_CHANGED', 'The managed FileAsset changed after admission')
  }
  let loaded
  try {
    loaded = await fileContentResolver(asset.id, { db, visibleBusinessIds: [corpus.businessId] })
  } catch {
    throw failure(409, 'KNOWLEDGE_REPLAY_FILE_UNAVAILABLE', 'The admitted managed FileAsset is no longer readable')
  }
  const value = loaded?.content ?? loaded
  if (!(Buffer.isBuffer(value) || value instanceof Uint8Array || typeof value === 'string')) {
    throw failure(409, 'KNOWLEDGE_REPLAY_FILE_UNAVAILABLE', 'The admitted managed FileAsset is no longer readable')
  }
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const actualHash = sha256(bytes)
  const hasStructuredDescriptor = Object.hasOwn(metadata, 'structured')
  const recordedHash = hasStructuredDescriptor ? metadata.structured?.fileSha256 : metadata.contentHash
  if (
    !Number.isSafeInteger(asset.size) || asset.size !== bytes.length
    || !SHA256.test(String(recordedHash || '')) || actualHash !== String(recordedHash).toLowerCase()
    || asset.sha256 && actualHash !== String(asset.sha256).toLowerCase()
    || !hasStructuredDescriptor && actualHash !== String(ingestion.contentHash).toLowerCase()
    || binaryBytes && !bytes.equals(binaryBytes)
  ) {
    throw failure(409, 'KNOWLEDGE_REPLAY_FILE_CHANGED', 'The managed FileAsset bytes no longer match the admitted source')
  }
  return { asset, hash: actualHash }
}

function assertRuntimeBinding(target, binding) {
  let scope, policy
  try {
    scope = JSON.parse(target.corpus.scopeJson)
    policy = JSON.parse(target.corpus.policyJson)
  } catch {
    throw failure(503, 'KNOWLEDGE_RUNTIME_UNAVAILABLE', 'Knowledge runtime binding is unavailable')
  }
  if (!isDeepStrictEqual(scope, binding?.scope) || !isDeepStrictEqual(policy, binding?.policy)) {
    throw failure(503, 'KNOWLEDGE_RUNTIME_UNAVAILABLE', 'Knowledge runtime binding has changed')
  }
  return scope
}

async function stage16RetryProof(repository, run) {
  if (!run?.executionRunId) return { evidence: [], currentStageStep: null }
  const [evidence, stageSteps] = await Promise.all([
    repository.listStageEvidence?.(run.executionRunId) || [],
    run.id && repository.listPipelineStepsForStage
      ? repository.listPipelineStepsForStage(run.id, 'DPS-KI-INDEX')
      : [],
  ])
  return { evidence, currentStageStep: latestKnowledgeStageAttempt(stageSteps, run) }
}

function assertFailedPipelineRun(run, target, stageEvidence, currentStageStep) {
  const { ingestion, corpus, source } = target
  if (
    !run || run.executionRunId !== ingestion.executionRunId || run.status !== 'FAILED'
    || run.dataPipelineDefinitionId !== KNOWLEDGE_INGESTION_DEFINITION_ID
    || run.executionContractId !== KNOWLEDGE_INGESTION_CONTRACT_ID
    || run.tenantId !== corpus.tenantId || run.businessId !== corpus.businessId
    || run.sourceRef !== `knowledge-source:${source.id}`
    || run.sourceSha256 !== ingestion.contentHash || run.artifactSha256 !== ingestion.contentHash
    || ingestion.rawArtifactId && run.artifactRef !== ingestion.rawArtifactId
    || !isKnowledgeBenchmarkRetryEligible(ingestion, run, stageEvidence, { source, corpus, currentStageStep })
  ) {
    throw failure(409, 'KNOWLEDGE_REPLAY_NOT_ELIGIBLE', 'Only the terminal Stage 16 benchmark coverage failure can be retried')
  }
}

function replayKeys(ingestionId, idempotencyKey) {
  const digest = sha256(Buffer.from(JSON.stringify([ingestionId, idempotencyKey]), 'utf8'))
  return { idempotencyKey: `knowledge-replay:${digest}`, correlationId: `knowledge-replay:${digest}` }
}

function replayResponse(ingestion, replayRun, unchanged) {
  return {
    id: ingestion.id,
    admissionId: ingestion.id,
    status: ingestion.status,
    executionRunId: ingestion.executionRunId,
    replayOfExecutionRunId: replayRun?.replayOfExecutionRunId || null,
    revision: ingestion.revision,
    sourceVersion: ingestion.sourceVersion,
    contentHash: ingestion.contentHash,
    attempts: ingestion.attempts,
    failureCode: ingestion.failureCode,
    retryAvailable: false,
    unchanged,
  }
}

async function priorReplayResult(priorReplay, target, repository) {
  const priorParent = await repository.getPipelineRun(priorReplay.replayOfExecutionRunId)
  const { evidence, currentStageStep } = priorParent
    ? await stage16RetryProof(repository, priorParent)
    : { evidence: [], currentStageStep: null }
  const retryProof = priorParent && isKnowledgeBenchmarkRetryEligible(
    { ...target.ingestion, status: 'FAILED', executionRunId: priorParent.executionRunId },
    priorParent,
    evidence,
    { source: target.source, corpus: target.corpus, currentStageStep },
  )
  if (
    !['QUEUED', 'RUNNING', 'PUBLISHED', 'FAILED'].includes(target.ingestion.status)
    || target.ingestion.executionRunId !== priorReplay.executionRunId
    || priorReplay.dataPipelineDefinitionId !== KNOWLEDGE_INGESTION_DEFINITION_ID
    || priorReplay.executionContractId !== KNOWLEDGE_INGESTION_CONTRACT_ID
    || priorReplay.replayScope !== 'FULL_RUN'
    || priorReplay.replayOfExecutionRunId !== priorParent?.executionRunId
    || priorReplay.businessId !== target.corpus.businessId || priorReplay.tenantId !== target.corpus.tenantId
    || priorReplay.sourceRef !== `knowledge-source:${target.source.id}`
    || priorReplay.sourceSha256 !== target.ingestion.contentHash || priorReplay.artifactSha256 !== target.ingestion.contentHash
    || priorParent?.dataPipelineDefinitionId !== KNOWLEDGE_INGESTION_DEFINITION_ID
    || priorParent?.executionContractId !== KNOWLEDGE_INGESTION_CONTRACT_ID
    || priorParent.businessId !== target.corpus.businessId || priorParent.tenantId !== target.corpus.tenantId
    || priorParent.sourceRef !== `knowledge-source:${target.source.id}`
    || priorParent.sourceSha256 !== target.ingestion.contentHash || priorParent.artifactSha256 !== target.ingestion.contentHash
    || priorReplay.artifactRef !== priorParent.artifactRef
    || !retryProof
  ) throw failure(409, 'KNOWLEDGE_REPLAY_IDEMPOTENCY_CONFLICT', 'Replay key belongs to another Knowledge source')
  return replayResponse(target.ingestion, priorReplay, true)
}

export async function retryKnowledgeIngestion(id, input, {
  db = prisma,
  viewer,
  env = process.env,
  now = new Date(),
  repository = createKnowledgeRepository(db),
  authorization,
  runtimeResolver = resolveKnowledgeRuntimeBinding,
  fileContentResolver = defaultResolveFileAssetContent,
  pipelineReplay = requestKnowledgePipelineReplay,
} = {}) {
  const admissionId = z.string().trim().min(1).max(200).parse(id)
  const value = knowledgeReplayInput.parse(input)
  const at = resolveNow(now)
  const targetForRead = async (repo) => {
    const ingestion = await repo.getIngestion(admissionId)
    if (!ingestion) throw failure(404, 'KNOWLEDGE_INGESTION_NOT_FOUND', 'Knowledge ingestion not found')
    const [corpus, source] = await Promise.all([repo.getCorpus(ingestion.corpusId), repo.getSource(ingestion.sourceId)])
    const target = { ingestion, corpus, source }
    targetAvailable(target)
    return target
  }
  const validateCurrentTarget = async (target) => {
    const access = await authorizeReplay(target, { db, env, viewer, authorization })
    let binding
    try {
      binding = await runtimeResolver({ businessId: target.corpus.businessId, projectId: target.corpus.projectId || null }, { db, env })
    } catch {
      throw failure(503, 'KNOWLEDGE_RUNTIME_UNAVAILABLE', 'Knowledge runtime is unavailable')
    }
    const scope = assertRuntimeBinding(target, binding)
    const contentProof = verifyIngestionContent(target)
    const verifiedAsset = await verifyCurrentFileAsset(target, access, { db, fileContentResolver, contentProof })
    return { scope, verifiedAsset }
  }
  const target = await targetForRead(repository)
  const { scope, verifiedAsset } = await validateCurrentTarget(target)

  const keys = replayKeys(admissionId, value.idempotencyKey)
  const priorReplay = await repository.getPipelineRunByIdempotencyKey?.(keys.idempotencyKey)
  if (priorReplay) {
    return priorReplayResult(priorReplay, target, repository)
  }

  targetFailure(target, at)
  const originalRun = await repository.getPipelineRun(target.ingestion.executionRunId)
  const originalProof = await stage16RetryProof(repository, originalRun)
  assertFailedPipelineRun(originalRun, target, originalProof.evidence, originalProof.currentStageStep)

  try {
    return await repository.transaction(async (txRepository, transactionDb) => {
      const current = await targetForRead(txRepository)
      if (
        current.ingestion.version !== target.ingestion.version
        || current.ingestion.executionRunId !== target.ingestion.executionRunId
        || current.source.version !== target.source.version
        || current.corpus.version !== target.corpus.version
      ) throw failure(409, 'KNOWLEDGE_REPLAY_CONFLICT', 'Knowledge admission changed while retry was being prepared')
      targetFailure(current, at)
      const txDb = transactionDb || db
      const currentAccess = await authorizeReplay(current, { db: txDb, env, viewer, authorization })
      if (sourceHasFile(current.source)) {
        const currentAsset = await txRepository.getFileAsset(current.source.fileAssetId)
        if (
          !currentAsset || currentAsset.version !== verifiedAsset?.asset.version
          || currentAsset.version !== currentAccess?.asset?.version
        ) {
          throw failure(409, 'KNOWLEDGE_REPLAY_FILE_CHANGED', 'The managed FileAsset changed while retry was being prepared')
        }
      }
      const failedRun = await txRepository.getPipelineRun(current.ingestion.executionRunId)
      const failedProof = await stage16RetryProof(txRepository, failedRun)
      assertFailedPipelineRun(failedRun, current, failedProof.evidence, failedProof.currentStageStep)
      const capability = createKnowledgeExecutionAuthority(scope, 'execute', failedRun.executionRunId)
      const replay = await pipelineReplay(failedRun.executionRunId, {
        scope: 'FULL_RUN',
        ...keys,
        sourceSha256: failedRun.sourceSha256,
        artifactSha256: failedRun.artifactSha256,
      }, { db: txDb, viewer: capability, now: at })
      if (!replay?.run?.executionRunId || replay.run.replayOfExecutionRunId !== failedRun.executionRunId) {
        throw failure(409, 'KNOWLEDGE_REPLAY_RUN_MISMATCH', 'Pipeline replay did not preserve the failed run lineage')
      }
      const updated = await txRepository.retryFailedIngestion(admissionId, {
        expectedVersion: current.ingestion.version,
        expectedExecutionRunId: failedRun.executionRunId,
        executionRunId: replay.run.executionRunId,
        now: at,
      })
      if (!updated) {
        const raced = await txRepository.getIngestion(admissionId)
        if (
          raced?.executionRunId === replay.run.executionRunId
          && ['QUEUED', 'RUNNING', 'PUBLISHED', 'FAILED'].includes(raced.status)
        ) return replayResponse(raced, replay.run, true)
        throw failure(409, 'KNOWLEDGE_REPLAY_CONFLICT', 'Knowledge admission changed before retry could be queued')
      }
      await txRepository.audit?.({
        entityType: 'KNOWLEDGE_INGESTION',
        entityId: admissionId,
        action: 'KNOWLEDGE_INGESTION_REPLAY_REQUESTED',
        actorId: typeof viewer?.principal?.id === 'string' ? viewer.principal.id : null,
        payload: {
          businessId: current.corpus.businessId,
          sourceId: current.source.id,
          sourceVersion: current.ingestion.sourceVersion,
          contentHash: current.ingestion.contentHash,
          originalExecutionRunId: failedRun.executionRunId,
          replayExecutionRunId: replay.run.executionRunId,
          replayIdempotencyKey: keys.idempotencyKey,
        },
      })
      return replayResponse(updated, replay.run, false)
    })
  } catch (error) {
    if (!['P2002', 'KNOWLEDGE_REPLAY_CONFLICT'].includes(error?.code)) throw error
    const racedTarget = await targetForRead(repository)
    await validateCurrentTarget(racedTarget)
    const racedReplay = await repository.getPipelineRunByIdempotencyKey?.(keys.idempotencyKey)
    if (!racedReplay) throw error
    return priorReplayResult(racedReplay, racedTarget, repository)
  }
}

function sourceHasFile(source) {
  return Boolean(source?.fileAssetId)
}
