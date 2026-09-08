import prisma from '@/lib/db'
import {
  assertGenesisRag17ScopeEqual,
  GENESIS_RAG17_SCHEMA_VERSION,
  hashGenesisRag17Json,
  hashGenesisRag17Text,
  parseGenesisRag17Scope,
  stageIdForNumber,
  zGenesisRag17PublicationReceipt,
} from '@/modules/knowledge/genesisrag17-contract'
import {
  KNOWLEDGE_INGESTION_CONTRACT_ID,
  KNOWLEDGE_INGESTION_DEFINITION_ID,
} from '@/platform/integrations/core/pipeline-tracking-contract'
import { hasKnowledgeRunAuthority, hasKnowledgeScopeAuthority } from './knowledge-execution-authority'
import { createKnowledgeRepository } from './knowledge-repository'
import {
  assertKnowledgeBusinessCurrent,
  assertKnowledgeFileCurrent,
  assertKnowledgeFileReadable,
  assertKnowledgeProjectCurrent,
  knowledgeError,
  resolveKnowledgeScope,
} from './knowledge-authorization'

// @req FR-172 — verified per-source receipts are published into immutable
// corpus generations, and retrieval/citations are current-ACL checked reads.
// @spec ADR-072, SEC-001, SEC-008
// @tested tests/integration/knowledge-corpus.test.js

const CORPUS_SCHEMA_VERSION = 'knowledge-corpus.v1'
const RRF_K = 60
const MAX_CAS_RETRIES = 3
const SCOPE_KEYS = Object.freeze(['portfolioId', 'tenantId', 'businessId', 'workspaceId', 'agentId', 'visibility'])
const SHA256 = /^[a-f0-9]{64}$/i

function serviceError(status, message, code) {
  return knowledgeError(status, message, code)
}

function conflict(message = 'Knowledge corpus changed while the operation was in progress', code = 'KNOWLEDGE_CONCURRENCY_CONFLICT') {
  const error = serviceError(409, message, code)
  error.retryable = true
  return error
}

function isConflict(error) {
  return (error?.retryable === true && error?.status === 409) || ['P2002', 'P2034'].includes(error?.code)
}

function nowDate(now) {
  const value = typeof now === 'function' ? now() : now || new Date()
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.valueOf())) throw serviceError(400, 'Knowledge operation time is invalid', 'KNOWLEDGE_TIME_INVALID')
  return date
}

function parseJson(value, name) {
  if (value && typeof value === 'object') return value
  if (typeof value !== 'string') throw serviceError(409, `Knowledge ${name} is unreadable`, 'KNOWLEDGE_INTEGRITY_ERROR')
  try {
    return JSON.parse(value)
  } catch {
    throw serviceError(409, `Knowledge ${name} is unreadable`, 'KNOWLEDGE_INTEGRITY_ERROR')
  }
}

function requireId(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw serviceError(400, `Knowledge ${name} is required`, 'KNOWLEDGE_INPUT_INVALID')
  return value.trim()
}

function optionalId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function assertHash(value, name) {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw serviceError(409, `Knowledge ${name} is not a SHA-256 digest`, 'KNOWLEDGE_INTEGRITY_ERROR')
  }
  return value
}

function assertScope(value, name = 'scope') {
  let scope
  try {
    scope = parseGenesisRag17Scope(value)
  } catch {
    throw serviceError(409, `Knowledge ${name} is invalid`, 'KNOWLEDGE_SCOPE_INVALID')
  }
  return scope
}

function scopeFromCorpus(corpus) {
  const scope = assertScope(parseJson(corpus?.scopeJson, 'corpus scope'))
  if (scope.portfolioId !== corpus.portfolioId || scope.tenantId !== corpus.tenantId || scope.businessId !== corpus.businessId || scope.workspaceId !== corpus.workspaceId) {
    throw serviceError(409, 'Knowledge corpus scope does not match its Business identity', 'KNOWLEDGE_SCOPE_INVALID')
  }
  return scope
}

function sameScope(left, right) {
  try {
    assertGenesisRag17ScopeEqual(left, right)
    return true
  } catch {
    return false
  }
}

function repositoryFor(db, repository) {
  return repository || createKnowledgeRepository(db)
}

async function findCorpus(repository, businessId, projectId) {
  const resolvedProjectId = optionalId(projectId)
  return repository.findCorpusByScope({ businessId, projectId: resolvedProjectId })
}

function assertLiveCorpus(corpus, businessId, projectId = null) {
  if (!corpus || corpus.deletedAt || corpus.status !== 'ACTIVE') {
    throw serviceError(404, 'Knowledge corpus not found', 'KNOWLEDGE_CORPUS_NOT_FOUND')
  }
  if (corpus.businessId !== businessId || (optionalId(corpus.projectId) !== optionalId(projectId))) {
    throw serviceError(404, 'Knowledge corpus not found', 'KNOWLEDGE_CORPUS_NOT_FOUND')
  }
  requireId(corpus.tenantId, 'corpus tenantId')
  return corpus
}

async function resolveAuthorizedCorpus({ businessId, projectId = null, action = 'read', db, repository, viewer, env }) {
  const access = await resolveKnowledgeScope({ viewer, businessId, projectId, action, db, env })
  const corpus = await findCorpus(repository, businessId, projectId)
  assertLiveCorpus(corpus, businessId, projectId)
  if (corpus.tenantId !== access.business.tenantId || corpus.portfolioId !== access.business.tenant?.portfolioId) {
    throw serviceError(409, 'Knowledge corpus tenant does not match its Business', 'KNOWLEDGE_SCOPE_INVALID')
  }
  const scope = scopeFromCorpus(corpus)
  if (scope.portfolioId !== access.business.tenant?.portfolioId) throw serviceError(409, 'Knowledge corpus scope does not match its live Business', 'KNOWLEDGE_SCOPE_INVALID')
  return { ...access, corpus }
}

function emptyManifest(corpus) {
  return { schemaVersion: CORPUS_SCHEMA_VERSION, corpusId: corpus.id, generation: 0, entries: [] }
}

function validateManifest(value, corpus, expectedScope, expectedNumber) {
  const manifest = parseJson(value, 'manifest')
  if (manifest.schemaVersion !== CORPUS_SCHEMA_VERSION || manifest.corpusId !== corpus.id || manifest.generation !== expectedNumber || !Array.isArray(manifest.entries)) {
    throw serviceError(409, 'Knowledge corpus manifest identity is invalid', 'KNOWLEDGE_MANIFEST_INVALID')
  }
  const seen = new Set()
  const entries = manifest.entries.map((entry) => {
    if (!entry || typeof entry !== 'object') throw serviceError(409, 'Knowledge corpus manifest entry is invalid', 'KNOWLEDGE_MANIFEST_INVALID')
    for (const key of ['sourceId', 'ingestionId', 'sourceVersion', 'executionRunId', 'snapshotId', 'generation', 'rawArtifactId', 'parsedArtifactId']) {
      if (typeof entry[key] !== 'string' || !entry[key].trim()) throw serviceError(409, `Knowledge manifest entry ${key} is missing`, 'KNOWLEDGE_MANIFEST_INVALID')
    }
    if (!Number.isSafeInteger(entry.revision) || entry.revision < 1) throw serviceError(409, 'Knowledge manifest entry revision is invalid', 'KNOWLEDGE_MANIFEST_INVALID')
    assertHash(entry.receiptHash, 'manifest receiptHash')
    assertHash(entry.contentHash, 'manifest contentHash')
    if (!sameScope(assertScope(entry.scope, 'manifest entry scope'), expectedScope)) throw serviceError(409, 'Knowledge manifest entry scope mismatch', 'KNOWLEDGE_SCOPE_INVALID')
    if (seen.has(entry.sourceId)) throw serviceError(409, 'Knowledge corpus manifest contains duplicate sources', 'KNOWLEDGE_MANIFEST_INVALID')
    seen.add(entry.sourceId)
    return {
      sourceId: entry.sourceId,
      ingestionId: entry.ingestionId,
      sourceVersion: entry.sourceVersion,
      revision: entry.revision,
      executionRunId: entry.executionRunId,
      snapshotId: entry.snapshotId,
      generation: entry.generation,
      scope: assertScope(entry.scope, 'manifest entry scope'),
      receiptHash: entry.receiptHash,
      rawArtifactId: entry.rawArtifactId,
      parsedArtifactId: entry.parsedArtifactId,
      contentHash: entry.contentHash,
      fileAssetId: optionalId(entry.fileAssetId),
      title: typeof entry.title === 'string' ? entry.title : null,
    }
  })
  entries.sort((left, right) => left.sourceId.localeCompare(right.sourceId))
  return { schemaVersion: CORPUS_SCHEMA_VERSION, corpusId: corpus.id, generation: expectedNumber, entries }
}

function validateStoredManifest(value, corpus, expectedScope, expectedNumber, expectedHash) {
  const original = parseJson(value, 'manifest')
  const originalHash = hashGenesisRag17Json(original)
  if (originalHash !== expectedHash) {
    throw serviceError(409, 'Knowledge corpus manifest hash does not match its immutable row', 'KNOWLEDGE_MANIFEST_TAMPERED')
  }
  const manifest = validateManifest(original, corpus, expectedScope, expectedNumber)
  if (hashGenesisRag17Json(manifest) !== originalHash) {
    throw serviceError(409, 'Knowledge corpus manifest contains unrecognized or tampered fields', 'KNOWLEDGE_MANIFEST_TAMPERED')
  }
  return { manifest, manifestHash: originalHash }
}

async function loadManifest(repository, corpus) {
  const expectedScope = scopeFromCorpus(corpus)
  if (!Number.isSafeInteger(corpus.generation) || corpus.generation < 0) {
    throw serviceError(409, 'Knowledge corpus generation is invalid', 'KNOWLEDGE_MANIFEST_INVALID')
  }
  if (corpus.generation === 0) {
    const manifest = emptyManifest(corpus)
    return { row: null, manifest, manifestHash: hashGenesisRag17Json(manifest) }
  }
  const row = await repository.getGeneration(corpus.id, corpus.generation)
  if (!row || row.corpusId !== corpus.id || row.number !== corpus.generation) {
    throw serviceError(409, 'Knowledge corpus generation is missing', 'KNOWLEDGE_MANIFEST_MISSING')
  }
  const validated = validateStoredManifest(row.manifestJson, corpus, expectedScope, corpus.generation, row.manifestHash)
  return { row, ...validated }
}

async function getSource(repository, sourceId) {
  return repository.getSource(sourceId)
}

async function listSources(repository, corpusId) {
  return repository.listSources(corpusId)
}

function sourceIsRevoked(source) {
  return !source || Boolean(source.deletedAt) || Boolean(source.revokedAt)
}

function assertSourceMatchesEntry(source, entry) {
  if (!source || (source.corpusId !== undefined && source.corpusId !== entry.corpusId)) {
    throw serviceError(409, 'Knowledge manifest source identity is invalid', 'KNOWLEDGE_MANIFEST_INVALID')
  }
  if (source.id !== entry.sourceId || (optionalId(source.fileAssetId) !== optionalId(entry.fileAssetId))) {
    throw serviceError(409, 'Knowledge manifest source identity is invalid', 'KNOWLEDGE_MANIFEST_INVALID')
  }
}

function assertActiveSource(source, code = 'KNOWLEDGE_SOURCE_REVOKED') {
  if (sourceIsRevoked(source)) throw serviceError(404, 'Knowledge source is no longer available', code)
}

function assertIngestionIdentity(ingestion, source, corpus) {
  if (!ingestion || ingestion.corpusId !== corpus.id || ingestion.sourceId !== source.id) {
    throw serviceError(409, 'Knowledge ingestion/source identity is invalid', 'KNOWLEDGE_PUBLICATION_PREREQUISITE')
  }
  if (!Number.isSafeInteger(ingestion.revision) || ingestion.revision < 1 || typeof ingestion.sourceVersion !== 'string' || !ingestion.sourceVersion) {
    throw serviceError(409, 'Knowledge ingestion source version is invalid', 'KNOWLEDGE_PUBLICATION_PREREQUISITE')
  }
  assertHash(ingestion.contentHash, 'ingestion contentHash')
}

function sourceIdentityMatches(sourceId, source) {
  return sourceId === source.id
}

function publicationPrerequisite(message) {
  return serviceError(409, message, 'KNOWLEDGE_PUBLICATION_PREREQUISITE')
}

function parsePublicationReceipt(value, ingestion, scope, decisionId) {
  let receipt
  try {
    receipt = zGenesisRag17PublicationReceipt.parse(value)
  } catch {
    throw publicationPrerequisite('Knowledge publication receipt is invalid')
  }
  if (receipt.runId !== ingestion.executionRunId || !sameScope(receipt.scope, scope)) {
    throw publicationPrerequisite('Knowledge publication receipt does not match the ingestion scope')
  }
  if (decisionId && receipt.decisionId !== decisionId) {
    throw publicationPrerequisite('Knowledge publication receipt does not match the Stage 9 decision')
  }
  if ((ingestion.snapshotId && receipt.snapshotId !== ingestion.snapshotId) || (ingestion.snapshotGeneration && receipt.generation !== ingestion.snapshotGeneration) || (ingestion.receiptHash && receipt.receiptHash !== ingestion.receiptHash)) {
    throw publicationPrerequisite('Knowledge publication receipt does not match the ingestion identity')
  }
  return receipt
}

async function verifyPublicationEvidence(repository, ingestion, source, corpus) {
  assertIngestionIdentity(ingestion, source, corpus)
  requireId(ingestion.rawArtifactId, 'ingestion rawArtifactId')
  requireId(ingestion.parsedArtifactId, 'ingestion parsedArtifactId')
  const scope = scopeFromCorpus(corpus)
  if (!ingestion.executionRunId) throw publicationPrerequisite('Knowledge ingestion has no complete publication identity')

  const run = await repository.getPipelineRun(ingestion.executionRunId)
  if (!run || typeof run.id !== 'string' || !run.id || run.executionRunId !== ingestion.executionRunId || run.status !== 'SUCCEEDED' || run.dataPipelineDefinitionId !== KNOWLEDGE_INGESTION_DEFINITION_ID || run.executionContractId !== KNOWLEDGE_INGESTION_CONTRACT_ID || run.tenantId !== scope.tenantId || run.businessId !== scope.businessId) {
    throw publicationPrerequisite('Knowledge ingestion run is not a succeeded scoped knowledge run')
  }
  if (run.sourceSha256 !== undefined && run.sourceSha256 !== null && run.sourceSha256 !== ingestion.contentHash) {
    throw publicationPrerequisite('Knowledge run source hash does not match the admitted source')
  }
  if (run.artifactRef !== undefined && run.artifactRef !== null && run.artifactRef !== ingestion.rawArtifactId) {
    throw publicationPrerequisite('Knowledge run artifact does not match the admitted source')
  }

  const intent = await repository.getIntentForRun(ingestion.executionRunId)
  if (!intent || intent.runId !== run.id || intent.executionRunId !== ingestion.executionRunId || !sourceIdentityMatches(intent.sourceId, source) || !sourceIdentityMatches(intent.documentId, source) || intent.contentHash !== ingestion.contentHash || intent.rawArtifactId !== ingestion.rawArtifactId || intent.version !== ingestion.sourceVersion || intent.tenantId !== scope.tenantId || intent.businessId !== scope.businessId || intent.workspaceId !== scope.workspaceId || intent.portfolioId !== scope.portfolioId || intent.agentId !== scope.agentId || intent.visibility !== scope.visibility || !sameScope(assertScope(parseJson(intent.scopeJson, 'ingestion intent scope'), 'ingestion intent scope'), scope)) {
    throw publicationPrerequisite('Knowledge ingestion intent does not match the admitted source')
  }

  const batch = await repository.getBatchForRun(ingestion.executionRunId)
  if (!batch || typeof batch.id !== 'string' || !batch.id || batch.runId !== run.id || batch.executionRunId !== ingestion.executionRunId || typeof batch.stage9StepId !== 'string' || !batch.stage9StepId || typeof batch.stage9AttemptId !== 'string' || !batch.stage9AttemptId) {
    throw publicationPrerequisite('Knowledge Stage 9 batch identity is missing')
  }
  const request = parseJson(batch.requestJson, 'GenesisRAG17 batch request')
  const requestScope = assertScope(request?.scope, 'batch scope')
  const batchScope = assertScope(parseJson(batch.scopeJson, 'batch scope row'), 'batch scope row')
  const batchSource = request?.source
  const stages = Array.isArray(request?.stages) ? request.stages : []
  const stage9 = stages.find((stage) => stage?.stageNumber === 9)
  if (request.schemaVersion !== GENESIS_RAG17_SCHEMA_VERSION || request.runId !== ingestion.executionRunId || !sameScope(requestScope, scope) || !sameScope(batchScope, scope) || !stage9 || stage9.runId !== ingestion.executionRunId || stage9.pipelineStageId !== stageIdForNumber(9) || stage9.executionStepId !== batch.stage9StepId || stage9.attemptId !== batch.stage9AttemptId || !batchSource || !sourceIdentityMatches(batchSource.sourceId, source) || !sourceIdentityMatches(batchSource.documentId, source) || batchSource.rawArtifactId !== ingestion.rawArtifactId || batchSource.parsedArtifactId !== ingestion.parsedArtifactId || batchSource.version !== ingestion.sourceVersion || batchSource.contentHash !== ingestion.contentHash) {
    throw publicationPrerequisite('Knowledge batch source lineage does not match the admitted source')
  }

  if (!batch.decisionId) throw publicationPrerequisite('Knowledge Stage 9 batch has no decision identity')
  const receipt = parsePublicationReceipt(await repository.verifyPublication(ingestion.executionRunId, scope), ingestion, scope, batch.decisionId)
  return { run, receipt }
}

function manifestEntry({ source, ingestion, receipt, scope }) {
  return {
    sourceId: source.id,
    ingestionId: ingestion.id,
    sourceVersion: ingestion.sourceVersion,
    revision: ingestion.revision,
    executionRunId: ingestion.executionRunId,
    snapshotId: receipt.snapshotId,
    generation: receipt.generation,
    scope,
    receiptHash: receipt.receiptHash,
    rawArtifactId: ingestion.rawArtifactId,
    parsedArtifactId: ingestion.parsedArtifactId,
    contentHash: ingestion.contentHash,
    fileAssetId: optionalId(source.fileAssetId),
    title: typeof source.title === 'string' ? source.title : null,
  }
}

function mergedManifest(corpus, previous, replacement) {
  const entries = previous.entries.filter((entry) => entry.sourceId !== replacement.sourceId)
  entries.push(replacement)
  entries.sort((left, right) => left.sourceId.localeCompare(right.sourceId))
  return { schemaVersion: CORPUS_SCHEMA_VERSION, corpusId: corpus.id, generation: corpus.generation + 1, entries }
}

async function callKnowledgeAudit(repository, { entityId, action, actorId, payload }) {
  return repository.audit({ entityId, entityType: 'KNOWLEDGE_CORPUS', action, actorId, payload })
}

async function authorizePublication({ authority, initialRun, scope, db, businessId, projectId }) {
  const business = await assertKnowledgeBusinessCurrent(businessId, { db })
  if (business.tenant?.portfolioId !== scope.portfolioId) throw serviceError(409, 'Knowledge corpus scope does not match its live Business', 'KNOWLEDGE_SCOPE_INVALID')
  const runtimeAuthorized = authority !== undefined && authority !== null && hasKnowledgeScopeAuthority(authority, scope, 'execute') && hasKnowledgeRunAuthority(authority, initialRun)
  if (!runtimeAuthorized) {
    throw serviceError(403, 'Knowledge publication runtime authority is invalid for this scope and run', 'KNOWLEDGE_RUNTIME_AUTHORITY_DENIED')
  }
  if (projectId) await assertKnowledgeProjectCurrent(projectId, businessId, { db })
  return true
}

/** Publish one verified native receipt into a new immutable corpus generation. */
export async function publishVerifiedKnowledgeIngestion(
  ingestionId,
  {
    db = prisma,
    repository: suppliedRepository,
    viewer,
    env = process.env,
    now = () => new Date(),
    authority,
    claimToken = null,
  } = {},
) {
  const id = requireId(ingestionId, 'ingestionId')
  const repository = repositoryFor(db, suppliedRepository)
  const initialIngestion = await repository.getIngestion(id)
  if (!initialIngestion) throw serviceError(404, 'Knowledge ingestion not found', 'KNOWLEDGE_INGESTION_NOT_FOUND')
  const initialCorpus = await repository.getCorpus(initialIngestion.corpusId)
  if (!initialCorpus) throw serviceError(404, 'Knowledge corpus not found', 'KNOWLEDGE_CORPUS_NOT_FOUND')
  const initialScope = scopeFromCorpus(initialCorpus)
  const initialRun = initialIngestion.executionRunId ? await repository.getPipelineRun(initialIngestion.executionRunId) : null
  await authorizePublication({ authority, initialRun, scope: initialScope, db, businessId: initialCorpus.businessId, projectId: initialCorpus.projectId })
  if (claimToken !== null && (typeof claimToken !== 'string' || !claimToken || initialIngestion.claimToken !== claimToken)) throw conflict('Knowledge ingestion lease is no longer held', 'KNOWLEDGE_INGESTION_LEASE_LOST')
  const initialSource = await getSource(repository, initialIngestion.sourceId)
  if (!initialSource || initialSource.corpusId !== initialCorpus.id) throw serviceError(404, 'Knowledge source not found', 'KNOWLEDGE_SOURCE_NOT_FOUND')
  if (initialSource.fileAssetId) {
    await assertKnowledgeFileCurrent(initialSource.fileAssetId, { businessId: initialCorpus.businessId, projectId: initialCorpus.projectId, db })
  }

  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt += 1) {
    try {
      const result = await repository.transaction(async (tx) => publishInTransaction(tx, id, { db, viewer, authority, env, actorId: viewer?.principal?.id || initialIngestion.submittedById || null, now, initialScope, claimToken }))
      return result
    } catch (error) {
      if (!isConflict(error) || attempt === MAX_CAS_RETRIES - 1) throw error
    }
  }
  throw conflict()
}

async function publishInTransaction(repository, ingestionId, { db, viewer, authority, env, actorId, now, initialScope, claimToken }) {
  const ingestion = await repository.getIngestion(ingestionId)
  if (!ingestion) throw serviceError(404, 'Knowledge ingestion not found', 'KNOWLEDGE_INGESTION_NOT_FOUND')
  const corpus = await repository.getCorpus(ingestion.corpusId)
  if (!corpus || corpus.deletedAt || corpus.status !== 'ACTIVE') throw serviceError(404, 'Knowledge corpus not found', 'KNOWLEDGE_CORPUS_NOT_FOUND')
  const source = await getSource(repository, ingestion.sourceId)
  if (!source || source.corpusId !== corpus.id) throw serviceError(404, 'Knowledge source not found', 'KNOWLEDGE_SOURCE_NOT_FOUND')
  assertIngestionIdentity(ingestion, source, corpus)
  const scope = scopeFromCorpus(corpus)
  if (!sameScope(scope, initialScope)) throw conflict('Knowledge corpus scope changed during publication')
  const liveBusiness = await assertKnowledgeBusinessCurrent(corpus.businessId, { db })
  if (liveBusiness.tenant?.portfolioId !== scope.portfolioId) throw serviceError(409, 'Knowledge corpus scope does not match its live Business', 'KNOWLEDGE_SCOPE_INVALID')
  if (!authority || !hasKnowledgeScopeAuthority(authority, scope, 'execute') || !hasKnowledgeRunAuthority(authority, await repository.getPipelineRun(ingestion.executionRunId))) {
    throw serviceError(403, 'Knowledge publication runtime authority is invalid for this scope and run', 'KNOWLEDGE_RUNTIME_AUTHORITY_DENIED')
  }
  if (claimToken !== null && ingestion.claimToken !== claimToken) throw conflict('Knowledge ingestion lease is no longer held', 'KNOWLEDGE_INGESTION_LEASE_LOST')

  if (sourceIsRevoked(source)) {
    if (['QUEUED', 'RUNNING'].includes(ingestion.status)) {
      const updated = await repository.updateIngestion(ingestion.id, { status: 'WITHDRAWN', failureCode: 'KNOWLEDGE_SOURCE_REVOKED' }, { expectedVersion: ingestion.version, ...(claimToken !== null ? { claimToken } : {}) })
      if (!updated) throw conflict('Knowledge ingestion changed while withdrawal was being applied')
      return { status: 'WITHDRAWN', ingestion: updated, source, corpus }
    }
    if (ingestion.status === 'WITHDRAWN') return { status: 'WITHDRAWN', ingestion, source, corpus }
    throw serviceError(409, 'A revoked source cannot be republished', 'KNOWLEDGE_SOURCE_REVOKED')
  }
  if (ingestion.status === 'PUBLISHED') {
    const current = await loadManifest(repository, corpus)
    return { status: 'UNCHANGED', ingestion, source, corpus, generation: current.row, manifest: current.manifest, manifestHash: current.manifestHash }
  }
  if (ingestion.status === 'SUPERSEDED') return { status: 'SUPERSEDED', ingestion, source, corpus }
  if (ingestion.status !== 'QUEUED' && ingestion.status !== 'RUNNING') {
    throw serviceError(409, 'Knowledge ingestion is not publishable in its current state', 'KNOWLEDGE_PUBLICATION_PREREQUISITE')
  }
  if (source.desiredRevision !== ingestion.revision) {
    const updated = await repository.updateIngestion(ingestion.id, { status: 'SUPERSEDED', failureCode: 'KNOWLEDGE_SOURCE_REVISION_SUPERSEDED' }, { expectedVersion: ingestion.version, ...(claimToken !== null ? { claimToken } : {}) })
    if (!updated) throw conflict('Knowledge ingestion changed while superseding a stale revision')
    return { status: 'SUPERSEDED', ingestion: updated, source, corpus }
  }

  if (corpus.projectId) await assertKnowledgeProjectCurrent(corpus.projectId, corpus.businessId, { db })
  if (source.fileAssetId) {
    await assertKnowledgeFileCurrent(source.fileAssetId, { businessId: corpus.businessId, projectId: corpus.projectId, db })
  }
  const evidence = await verifyPublicationEvidence(repository, ingestion, source, corpus)
  const current = await loadManifest(repository, corpus)
  const replacement = manifestEntry({ source, ingestion, receipt: evidence.receipt, scope })
  const manifest = mergedManifest(corpus, current.manifest, replacement)
  const manifestHash = hashGenesisRag17Json(manifest)
  const created = await repository.createGeneration({
    corpusId: corpus.id,
    number: manifest.generation,
    manifestJson: JSON.stringify(manifest),
    manifestHash,
    createdAt: nowDate(now),
  })
  const sourceUpdated = await repository.updateSource(source.id, source.version, { activeIngestionId: ingestion.id })
  if (!sourceUpdated) throw conflict('Knowledge source changed while publishing its generation')
  const corpusUpdated = await repository.updateCorpus(corpus.id, corpus.version, { generation: manifest.generation, status: 'ACTIVE', deletedAt: null })
  if (!corpusUpdated) throw conflict('Knowledge corpus changed while publishing its generation')
  const ingestionUpdated = await repository.updateIngestion(ingestion.id, {
    status: 'PUBLISHED',
    snapshotId: evidence.receipt.snapshotId,
    snapshotGeneration: evidence.receipt.generation,
    receiptHash: evidence.receipt.receiptHash,
    failureCode: null,
  }, { expectedVersion: ingestion.version, ...(claimToken !== null ? { claimToken } : {}) })
  if (!ingestionUpdated) throw conflict('Knowledge ingestion changed while publishing its generation')
  await callKnowledgeAudit(repository, {
    entityId: corpus.id,
    action: 'KNOWLEDGE_CORPUS_GENERATION_PUBLISHED',
    actorId,
    payload: { sourceId: source.id, ingestionId: ingestion.id, generation: manifest.generation, manifestHash },
  })
  return { status: 'PUBLISHED', ingestion: ingestionUpdated, source: sourceUpdated, corpus: corpusUpdated, generation: created, manifest, manifestHash }
}

function validateQueryInput({ businessId, query, topK }) {
  requireId(businessId, 'businessId')
  if (typeof query !== 'string' || !query.trim() || query.length > 16000) throw serviceError(400, 'Knowledge query is invalid', 'KNOWLEDGE_QUERY_INVALID')
  const limit = topK === undefined ? 5 : topK
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw serviceError(400, 'Knowledge query topK is invalid', 'KNOWLEDGE_QUERY_INVALID')
  return { query, topK: limit }
}

function verifyLineage(lineage, citation, entry, scope) {
  if (!lineage || lineage.sourceId !== entry.sourceId || lineage.documentId !== entry.sourceId || lineage.version !== entry.sourceVersion || lineage.rawArtifactId !== entry.rawArtifactId || lineage.parsedArtifactId !== entry.parsedArtifactId || lineage.chunkId !== citation.chunkId || lineage.contentHash !== entry.contentHash || typeof lineage.text !== 'string' || hashGenesisRag17Text(lineage.text) !== citation.contentHash) {
    throw serviceError(502, 'Knowledge query returned a chunk outside the admitted lineage', 'KNOWLEDGE_LINEAGE_MISMATCH')
  }
  if (!Number.isSafeInteger(lineage.startOffset) || !Number.isSafeInteger(lineage.endOffset) || lineage.startOffset < 0 || lineage.endOffset < lineage.startOffset) {
    throw serviceError(502, 'Knowledge query returned invalid chunk offsets', 'KNOWLEDGE_LINEAGE_MISMATCH')
  }
  for (const key of SCOPE_KEYS) {
    if (lineage[key] !== undefined && lineage[key] !== scope[key]) throw serviceError(502, 'Knowledge query returned a chunk outside the requested scope', 'KNOWLEDGE_LINEAGE_MISMATCH')
  }
  return lineage
}

function queryResponseError(message, code = 'KNOWLEDGE_SNAPSHOT_MISMATCH') {
  return serviceError(502, message, code)
}

function assertSnapshotResponse(response, entry, scope) {
  if (!response || response.schemaVersion !== GENESIS_RAG17_SCHEMA_VERSION || response.snapshotId !== entry.snapshotId || response.generation !== entry.generation || !sameScope(response.scope, scope) || !Array.isArray(response.results)) {
    throw queryResponseError('Knowledge snapshot response does not match the pinned manifest')
  }
}

function citationReference({ corpusId, corpusGeneration, sourceId, ingestionId, chunkId }) {
  const value = JSON.stringify({ corpusId, corpusGeneration, sourceId, ingestionId, chunkId })
  return `kc1.${Buffer.from(value, 'utf8').toString('base64url')}`
}

function decodeCitationReference(value) {
  if (typeof value !== 'string' || !value.startsWith('kc1.')) throw serviceError(400, 'Knowledge citation id is invalid', 'KNOWLEDGE_CITATION_INVALID')
  let parsed
  try {
    parsed = JSON.parse(Buffer.from(value.slice(4), 'base64url').toString('utf8'))
  } catch {
    throw serviceError(400, 'Knowledge citation id is invalid', 'KNOWLEDGE_CITATION_INVALID')
  }
  if (!parsed || typeof parsed !== 'object' || !requireId(parsed.corpusId, 'citation corpusId') || !Number.isSafeInteger(parsed.corpusGeneration) || parsed.corpusGeneration < 1 || !requireId(parsed.sourceId, 'citation sourceId') || !requireId(parsed.ingestionId, 'citation ingestionId') || !requireId(parsed.chunkId, 'citation chunkId')) {
    throw serviceError(400, 'Knowledge citation id is invalid', 'KNOWLEDGE_CITATION_INVALID')
  }
  return parsed
}

async function resolveQueryFunction(options) {
  if (typeof options.querySnapshot === 'function') return options.querySnapshot
  if (typeof options.runtime?.querySnapshot === 'function') return options.runtime.querySnapshot
  try {
    const bridge = await import('./knowledge-runtime.js')
    if (typeof bridge.queryKnowledgeSnapshot !== 'function') throw new Error('queryKnowledgeSnapshot is unavailable')
    return (input) => bridge.queryKnowledgeSnapshot(input, {
      db: options.db,
      env: options.env,
      transport: options.transport,
      runtime: options.runtime,
      capability: options.runtimeCapability,
    })
  } catch (error) {
    if (error?.status) throw error
    throw serviceError(503, 'Knowledge snapshot query runtime is unavailable', 'KNOWLEDGE_RUNTIME_UNAVAILABLE')
  }
}

/** Query one pinned corpus manifest through explicit native snapshots. */
export async function queryKnowledgeCorpus(
  input,
  {
    db = prisma,
    repository: suppliedRepository,
    viewer,
    env = process.env,
    querySnapshot,
    runtime,
    runtimeCapability,
    transport,
    resolveCurrentViewer,
  } = {},
) {
  const { businessId, projectId = null } = input || {}
  const { query, topK } = validateQueryInput({ businessId, query: input?.query, topK: input?.topK })
  const repository = repositoryFor(db, suppliedRepository)
  const access = await resolveAuthorizedCorpus({ businessId, projectId, action: 'read', db, repository, viewer, env })
  const { corpus } = access
  const initialCorpusId = corpus.id
  const initialScope = scopeFromCorpus(corpus)
  const current = await loadManifest(repository, corpus)
  const sources = await listSources(repository, corpus.id)
  const sourceById = new Map(sources.map((source) => [source.id, source]))
  const entriesBySnapshot = new Map()
  for (const entry of current.manifest.entries) {
    const source = sourceById.get(entry.sourceId)
    if (!source) throw serviceError(404, 'Knowledge source is no longer available', 'KNOWLEDGE_SOURCE_REVOKED')
    assertSourceMatchesEntry({ ...source, corpusId: corpus.id }, { ...entry, corpusId: corpus.id })
    assertActiveSource(source)
    if (source.fileAssetId) await assertKnowledgeFileReadable(viewer, source.fileAssetId, { businessId, projectId, db, env })
    if (!sameScope(assertScope(entry.scope, 'manifest entry scope'), initialScope)) throw serviceError(409, 'Knowledge manifest scope is invalid', 'KNOWLEDGE_SCOPE_INVALID')
    const group = entriesBySnapshot.get(entry.snapshotId) || { snapshotId: entry.snapshotId, generation: entry.generation, scope: entry.scope, entries: [] }
    if (group.generation !== entry.generation || !sameScope(group.scope, entry.scope)) throw serviceError(409, 'Knowledge corpus has conflicting snapshot identity', 'KNOWLEDGE_MANIFEST_INVALID')
    group.entries.push(entry)
    entriesBySnapshot.set(entry.snapshotId, group)
  }
  if (!entriesBySnapshot.size) {
    return { corpusId: initialCorpusId, corpusGeneration: current.manifest.generation, manifestHash: current.manifestHash, ranking: 'rrf-k60', results: [] }
  }
  const queryFn = await resolveQueryFunction({ db, env, querySnapshot, runtime, runtimeCapability, transport })
  const fused = new Map()
  for (const group of entriesBySnapshot.values()) {
    const response = await queryFn({ scope: initialScope, query, topK, snapshotId: group.snapshotId })
    assertSnapshotResponse(response, group.entries[0], initialScope)
    const entryBySource = new Map(group.entries.map((entry) => [entry.sourceId, entry]))
    const seen = new Set()
    for (let index = 0; index < response.results.length; index += 1) {
      const row = response.results[index]
      if (!row || typeof row.id !== 'string' || !row.id || typeof row.text !== 'string' || typeof row.score !== 'number' || !Number.isFinite(row.score) || !row.citation) throw queryResponseError('Knowledge snapshot response contains an invalid result', 'KNOWLEDGE_QUERY_RESPONSE_INVALID')
      const citation = row.citation
      for (const key of ['sourceId', 'rawArtifactId', 'parsedArtifactId', 'chunkId', 'contentHash']) if (typeof citation[key] !== 'string' || !citation[key]) throw queryResponseError('Knowledge snapshot response contains an incomplete citation')
      assertHash(citation.contentHash, 'query citation contentHash')
      const entry = entryBySource.get(citation.sourceId)
      if (!entry || entry.snapshotId !== response.snapshotId || entry.generation !== response.generation || entry.rawArtifactId !== citation.rawArtifactId || entry.parsedArtifactId !== citation.parsedArtifactId) {
        throw queryResponseError('Knowledge snapshot response citation is outside the pinned manifest')
      }
      const lineage = await repository.resolveLineage({
        scope: initialScope,
        sourceId: entry.sourceId,
        documentId: entry.sourceId,
        version: entry.sourceVersion,
        rawArtifactId: citation.rawArtifactId,
        parsedArtifactId: citation.parsedArtifactId,
        chunkId: citation.chunkId,
      })
      verifyLineage(lineage, citation, entry, initialScope)
      if (lineage.text !== row.text) throw queryResponseError('Knowledge snapshot response text does not match its immutable chunk', 'KNOWLEDGE_LINEAGE_MISMATCH')
      const identity = `${entry.sourceId}\u0000${entry.ingestionId}\u0000${citation.chunkId}`
      if (seen.has(identity)) throw queryResponseError('Knowledge snapshot response contains a duplicate chunk', 'KNOWLEDGE_QUERY_RESPONSE_INVALID')
      seen.add(identity)
      const currentHit = fused.get(identity)
      const rankFusionScore = (currentHit?.rankFusionScore || 0) + 1 / (RRF_K + index + 1)
      if (!currentHit) {
        fused.set(identity, {
          sourceId: entry.sourceId,
          ingestionId: entry.ingestionId,
          snapshotId: entry.snapshotId,
          generation: entry.generation,
          chunkId: citation.chunkId,
          contentHash: entry.contentHash,
          rankFusionScore,
          snapshotScore: row.score,
          text: row.text,
          citationId: citationReference({ corpusId: corpus.id, corpusGeneration: current.manifest.generation, sourceId: entry.sourceId, ingestionId: entry.ingestionId, chunkId: citation.chunkId }),
        })
      } else {
        currentHit.rankFusionScore = rankFusionScore
      }
    }
  }
  // A query may take long enough for a membership or ACL change to race it.
  // Check live access and every selected source immediately before disclosure.
  const currentViewer = typeof resolveCurrentViewer === 'function' ? await resolveCurrentViewer() : viewer
  await resolveAuthorizedCorpus({ businessId, projectId, action: 'read', db, repository, viewer: currentViewer, env })
  const afterSources = await listSources(repository, corpus.id)
  const afterById = new Map(afterSources.map((source) => [source.id, source]))
  for (const entry of current.manifest.entries) {
    const source = afterById.get(entry.sourceId)
    if (!source || source.corpusId !== corpus.id) {
      throw serviceError(404, 'Knowledge source is no longer available', 'KNOWLEDGE_SOURCE_REVOKED')
    }
    assertSourceMatchesEntry(source, { ...entry, corpusId: corpus.id })
    assertActiveSource(source)
    if (source.fileAssetId) await assertKnowledgeFileReadable(currentViewer, source.fileAssetId, { businessId, projectId, db, env })
  }
  const results = [...fused.values()]
    .sort((left, right) => right.rankFusionScore - left.rankFusionScore || left.sourceId.localeCompare(right.sourceId) || left.chunkId.localeCompare(right.chunkId) || left.ingestionId.localeCompare(right.ingestionId))
    .slice(0, topK)
  return { corpusId: initialCorpusId, corpusGeneration: current.manifest.generation, manifestHash: current.manifestHash, ranking: 'rrf-k60', results }
}

/** Resolve a version-bound citation against immutable lineage and live ACL. */
export async function resolveKnowledgeCitation(
  citationId,
  {
    db = prisma,
    repository: suppliedRepository,
    viewer,
    env = process.env,
    resolveCurrentViewer,
  } = {},
) {
  const reference = decodeCitationReference(citationId)
  const repository = repositoryFor(db, suppliedRepository)
  const corpus = await repository.getCorpus(reference.corpusId)
  if (!corpus || corpus.deletedAt || corpus.status !== 'ACTIVE') throw serviceError(404, 'Knowledge corpus not found', 'KNOWLEDGE_CORPUS_NOT_FOUND')
  const access = await resolveKnowledgeScope({ viewer, businessId: corpus.businessId, projectId: corpus.projectId, action: 'read', db, env })
  if (corpus.tenantId !== access.business.tenantId || corpus.portfolioId !== access.business.tenant?.portfolioId) throw serviceError(404, 'Knowledge corpus not found', 'KNOWLEDGE_CORPUS_NOT_FOUND')
  const scope = scopeFromCorpus(corpus)
  if (scope.portfolioId !== access.business.tenant?.portfolioId) throw serviceError(404, 'Knowledge corpus not found', 'KNOWLEDGE_CORPUS_NOT_FOUND')
  const generation = await repository.getGeneration(corpus.id, reference.corpusGeneration)
  if (!generation) throw serviceError(404, 'Knowledge citation generation not found', 'KNOWLEDGE_CITATION_NOT_FOUND')
  const { manifest } = validateStoredManifest(generation.manifestJson, corpus, scope, reference.corpusGeneration, generation.manifestHash)
  const entry = manifest.entries.find((candidate) => candidate.sourceId === reference.sourceId && candidate.ingestionId === reference.ingestionId)
  if (!entry) throw serviceError(404, 'Knowledge citation is not in the immutable corpus generation', 'KNOWLEDGE_CITATION_NOT_FOUND')
  const source = await getSource(repository, reference.sourceId)
  if (!source || source.corpusId !== corpus.id) throw serviceError(404, 'Knowledge source is no longer available', 'KNOWLEDGE_SOURCE_REVOKED')
  assertSourceMatchesEntry(source, { ...entry, corpusId: corpus.id })
  assertActiveSource(source)
  if (source.fileAssetId) await assertKnowledgeFileReadable(viewer, source.fileAssetId, { businessId: corpus.businessId, projectId: corpus.projectId, db, env })
  const ingestion = await repository.getIngestion(reference.ingestionId)
  if (!ingestion || ingestion.id !== entry.ingestionId || ingestion.sourceId !== source.id || ingestion.corpusId !== corpus.id || ingestion.sourceVersion !== entry.sourceVersion || ingestion.contentHash !== entry.contentHash || ingestion.rawArtifactId !== entry.rawArtifactId || ingestion.parsedArtifactId !== entry.parsedArtifactId) {
    throw serviceError(409, 'Knowledge citation lineage is invalid', 'KNOWLEDGE_LINEAGE_MISMATCH')
  }
  const lineage = await repository.resolveLineage({
    scope,
    sourceId: entry.sourceId,
    documentId: entry.sourceId,
    version: entry.sourceVersion,
    rawArtifactId: entry.rawArtifactId,
    parsedArtifactId: entry.parsedArtifactId,
    chunkId: reference.chunkId,
  })
  const lineageContentHash = lineage && typeof lineage.text === 'string' ? hashGenesisRag17Text(lineage.text) : null
  verifyLineage(lineage, { chunkId: reference.chunkId, contentHash: lineageContentHash }, entry, scope)
  // Recheck the same live authority after all potentially slow lineage reads.
  const currentViewer = typeof resolveCurrentViewer === 'function' ? await resolveCurrentViewer() : viewer
  const currentCorpus = await repository.getCorpus(reference.corpusId)
  if (!currentCorpus || currentCorpus.deletedAt || currentCorpus.status !== 'ACTIVE' || currentCorpus.businessId !== corpus.businessId || optionalId(currentCorpus.projectId) !== optionalId(corpus.projectId)) {
    throw serviceError(404, 'Knowledge corpus not found', 'KNOWLEDGE_CORPUS_NOT_FOUND')
  }
  const currentScope = scopeFromCorpus(currentCorpus)
  if (!sameScope(currentScope, scope)) throw serviceError(404, 'Knowledge corpus not found', 'KNOWLEDGE_CORPUS_NOT_FOUND')
  const currentAccess = await resolveKnowledgeScope({ viewer: currentViewer, businessId: currentCorpus.businessId, projectId: currentCorpus.projectId, action: 'read', db, env })
  if (currentCorpus.tenantId !== currentAccess.business.tenantId || currentCorpus.portfolioId !== currentAccess.business.tenant?.portfolioId) {
    throw serviceError(404, 'Knowledge corpus not found', 'KNOWLEDGE_CORPUS_NOT_FOUND')
  }
  const currentSource = await getSource(repository, reference.sourceId)
  if (!currentSource || currentSource.corpusId !== currentCorpus.id) {
    throw serviceError(404, 'Knowledge source is no longer available', 'KNOWLEDGE_SOURCE_REVOKED')
  }
  assertSourceMatchesEntry(currentSource, { ...entry, corpusId: currentCorpus.id })
  assertActiveSource(currentSource)
  if (currentSource.fileAssetId) await assertKnowledgeFileReadable(currentViewer, currentSource.fileAssetId, { businessId: currentCorpus.businessId, projectId: currentCorpus.projectId, db, env })
  return {
    citationId,
    corpusId: corpus.id,
    corpusGeneration: reference.corpusGeneration,
    sourceId: source.id,
    sourceVersion: entry.sourceVersion,
    ingestionId: ingestion.id,
    snapshotId: entry.snapshotId,
    generation: entry.generation,
    rawArtifactId: entry.rawArtifactId,
    parsedArtifactId: entry.parsedArtifactId,
    chunkId: lineage.chunkId,
    contentHash: entry.contentHash,
    title: entry.title,
    fileAssetId: entry.fileAssetId,
    text: lineage.text,
    startOffset: lineage.startOffset,
    endOffset: lineage.endOffset,
  }
}

/**
 * Revoke one source and atomically publish a generation without its entry.
 * The operation owns only corpus/source membership rows, so it keeps the
 * corpus Business/Project write gate but does not require the referenced
 * FileAsset to remain live in order to remove that membership.
 */
export async function withdrawKnowledgeSource(
  sourceId,
  { expectedVersion },
  {
    db = prisma,
    repository: suppliedRepository,
    viewer,
    env = process.env,
    now = () => new Date(),
  } = {},
) {
  const id = requireId(sourceId, 'sourceId')
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) throw serviceError(400, 'Knowledge source expectedVersion is invalid', 'KNOWLEDGE_SOURCE_VERSION_INVALID')
  const repository = repositoryFor(db, suppliedRepository)
  const initialSource = await getSource(repository, id)
  if (!initialSource) throw serviceError(404, 'Knowledge source not found', 'KNOWLEDGE_SOURCE_NOT_FOUND')
  const initialCorpus = await repository.getCorpus(initialSource.corpusId)
  if (!initialCorpus) throw serviceError(404, 'Knowledge corpus not found', 'KNOWLEDGE_CORPUS_NOT_FOUND')
  const scope = scopeFromCorpus(initialCorpus)
  await resolveKnowledgeScope({ viewer, businessId: initialCorpus.businessId, projectId: initialCorpus.projectId, action: 'write', db, env })
  for (let attempt = 0; attempt < MAX_CAS_RETRIES; attempt += 1) {
    try {
      const result = await repository.transaction((tx) => withdrawInTransaction(tx, id, expectedVersion, { now, actorId: viewer?.principal?.id || null, initialScope: scope, viewer, db, env }))
      return result
    } catch (error) {
      if (!isConflict(error) || attempt === MAX_CAS_RETRIES - 1) throw error
    }
  }
  throw conflict()
}

async function withdrawInTransaction(repository, sourceId, expectedVersion, { now, actorId, initialScope, viewer, db, env }) {
  const source = await getSource(repository, sourceId)
  if (!source) throw serviceError(404, 'Knowledge source not found', 'KNOWLEDGE_SOURCE_NOT_FOUND')
  const corpus = await repository.getCorpus(source.corpusId)
  if (!corpus || corpus.deletedAt || corpus.status !== 'ACTIVE') throw serviceError(404, 'Knowledge corpus not found', 'KNOWLEDGE_CORPUS_NOT_FOUND')
  const scope = scopeFromCorpus(corpus)
  if (!sameScope(scope, initialScope)) throw conflict('Knowledge corpus scope changed during withdrawal')
  if (source.version !== expectedVersion) throw conflict('Knowledge source version no longer matches', 'KNOWLEDGE_SOURCE_VERSION_CONFLICT')
  if (source.deletedAt) throw serviceError(404, 'Knowledge source not found', 'KNOWLEDGE_SOURCE_NOT_FOUND')
  if (source.revokedAt) return { status: 'UNCHANGED', source, corpus }
  const current = await loadManifest(repository, corpus)
  const entries = current.manifest.entries.filter((entry) => entry.sourceId !== source.id)
  const manifest = { schemaVersion: CORPUS_SCHEMA_VERSION, corpusId: corpus.id, generation: corpus.generation + 1, entries }
  const manifestHash = hashGenesisRag17Json(manifest)
  const created = await repository.createGeneration({ corpusId: corpus.id, number: manifest.generation, manifestJson: JSON.stringify(manifest), manifestHash, createdAt: nowDate(now) })
  const sourceUpdated = await repository.updateSource(source.id, source.version, { revokedAt: nowDate(now), activeIngestionId: null })
  if (!sourceUpdated) throw conflict('Knowledge source changed while withdrawing it')
  if (source.activeIngestionId) {
    const activeIngestion = await repository.getIngestion(source.activeIngestionId)
    if (activeIngestion && ['QUEUED', 'RUNNING', 'PUBLISHED'].includes(activeIngestion.status)) {
      const withdrawn = await repository.updateIngestion(activeIngestion.id, { status: 'WITHDRAWN', failureCode: 'KNOWLEDGE_SOURCE_WITHDRAWN' }, { expectedVersion: activeIngestion.version })
      if (!withdrawn) throw conflict('Knowledge ingestion changed while withdrawing its source')
    }
  }
  const corpusUpdated = await repository.updateCorpus(corpus.id, corpus.version, { generation: manifest.generation, status: 'ACTIVE', deletedAt: null })
  if (!corpusUpdated) throw conflict('Knowledge corpus changed while withdrawing its source')
  await callKnowledgeAudit(repository, {
    entityId: corpus.id,
    action: 'KNOWLEDGE_SOURCE_WITHDRAWN',
    actorId,
    payload: { sourceId: source.id, generation: manifest.generation, manifestHash },
  })
  return { status: 'WITHDRAWN', source: sourceUpdated, corpus: corpusUpdated, generation: created, manifest, manifestHash }
}

export { CORPUS_SCHEMA_VERSION, RRF_K, citationReference, decodeCitationReference }
