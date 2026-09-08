import { createHash } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { resolveFileAssetContent as defaultResolveFileAssetContent } from '@/modules/project-manager/application/file-asset-service'
import {
  canonicalGenesisRag17Json,
  hashGenesisRag17Json,
  hashGenesisRag17Text,
  parseGenesisRag17Scope,
} from './genesisrag17-contract'
import { assertKnowledgeFileWritable, resolveKnowledgeScope } from './knowledge-authorization'
import { resolveKnowledgeRuntimeBinding } from './knowledge-runtime'
import { createKnowledgeRepository } from './knowledge-repository'

// @req FR-173 — Files, Project Files, HTTP and MCP share one authorized durable
// admission boundary for immutable Text/Markdown source versions.
// @spec ADR-072, ZAI:KNOWLEDGE-ADMISSION-CONTRACT, SEC-001, SEC-008
// @tested tests/unit/knowledge-admission-service.test.js

const MAX_CONTENT_BYTES = 1024 * 1024
const MAX_LIMIT = 100
const JOB_STATUSES = Object.freeze(['QUEUED', 'RUNNING', 'PUBLISHED', 'FAILED', 'SUPERSEDED', 'WITHDRAWN'])
const SUPPORTED_MIME_TYPES = new Set([
  'text/plain',
  'text/markdown',
  'text/x-markdown',
  'application/markdown',
  'application/x-markdown',
])
const SUPPORTED_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.mdown', '.mkdn', '.mkd'])

const identifier = z.string().trim().min(1).max(200)
const textSource = z.object({
  kind: z.literal('TEXT'),
  sourceKey: identifier,
  version: identifier,
  title: identifier.optional(),
  content: z.string().min(1),
}).strict()
const fileSource = z.object({
  kind: z.literal('FILE'),
  fileAssetId: identifier,
  sourceKey: identifier.optional(),
  version: identifier.optional(),
  title: identifier.optional(),
}).strict()

export const knowledgeAdmissionInput = z.object({
  businessId: identifier,
  projectId: identifier.nullish(),
  idempotencyKey: identifier,
  source: z.union([textSource, fileSource]),
}).strict()

function failure(status, code, message = code, details) {
  const error = new Error(message)
  error.status = status
  error.code = code
  if (details !== undefined) error.details = details
  return error
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function parseJson(value, fallback = null) {
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) } catch { return fallback }
}

function equalJson(left, right) {
  try {
    return canonicalGenesisRag17Json(left) === canonicalGenesisRag17Json(right)
  } catch {
    return false
  }
}

function safePolicy(policy) {
  if (!isRecord(policy) || policy.allowEmbedding !== true || policy.allowPublication !== true) {
    throw failure(503, 'KNOWLEDGE_RUNTIME_UNAVAILABLE', 'Knowledge runtime policy is unavailable')
  }
  const keys = Object.keys(policy)
  if (keys.some((key) => !['allowEmbedding', 'allowPublication'].includes(key))) {
    throw failure(503, 'KNOWLEDGE_RUNTIME_UNAVAILABLE', 'Knowledge runtime policy is unavailable')
  }
  return { allowEmbedding: true, allowPublication: true }
}

function safeScope(scope, { businessId, projectId }, access) {
  let parsed
  try { parsed = parseGenesisRag17Scope(scope) } catch {
    throw failure(503, 'KNOWLEDGE_RUNTIME_UNAVAILABLE', 'Knowledge runtime scope is unavailable')
  }
  if (parsed.businessId !== businessId) {
    throw failure(503, 'KNOWLEDGE_RUNTIME_UNAVAILABLE', 'Knowledge runtime scope is unavailable')
  }
  if (access?.business?.tenantId && parsed.tenantId !== access.business.tenantId) {
    throw failure(503, 'KNOWLEDGE_RUNTIME_UNAVAILABLE', 'Knowledge runtime scope is unavailable')
  }
  if (access?.business?.tenant?.portfolioId && parsed.portfolioId !== access.business.tenant.portfolioId) {
    throw failure(503, 'KNOWLEDGE_RUNTIME_UNAVAILABLE', 'Knowledge runtime scope is unavailable')
  }
  // Project is Tier 1 corpus metadata and is intentionally absent from the
  // frozen six-field GenesisRAG scope. The binding still must be a valid object
  // with the requested Business; the runtime resolver checks project ancestry.
  if (projectId !== undefined && projectId !== null && typeof projectId !== 'string') {
    throw failure(400, 'KNOWLEDGE_PROJECT_INVALID', 'Project id is invalid')
  }
  return parsed
}

function contentBytes(value) {
  const bytes = Buffer.from(value, 'utf8')
  if (bytes.length === 0 || value.trim().length === 0) throw failure(422, 'KNOWLEDGE_CONTENT_EMPTY', 'Knowledge content cannot be empty')
  if (bytes.length > MAX_CONTENT_BYTES) {
    throw failure(413, 'KNOWLEDGE_CONTENT_TOO_LARGE', 'Knowledge content exceeds the 1 MiB limit')
  }
  // Buffer.from replaces lone UTF-16 surrogates. A round-trip mismatch means
  // the caller did not submit valid Unicode that can be frozen as UTF-8.
  const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  if (decoded !== value) throw failure(422, 'KNOWLEDGE_INVALID_UTF8', 'Knowledge content is not valid UTF-8')
  return bytes
}

function decodeUtf8(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value)
  if (bytes.length === 0) throw failure(422, 'KNOWLEDGE_CONTENT_EMPTY', 'Knowledge content cannot be empty')
  if (bytes.length > MAX_CONTENT_BYTES) {
    throw failure(413, 'KNOWLEDGE_CONTENT_TOO_LARGE', 'Knowledge content exceeds the 1 MiB limit')
  }
  let decoded
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)
  } catch {
    throw failure(422, 'KNOWLEDGE_INVALID_UTF8', 'Knowledge file is not valid UTF-8')
  }
  if (decoded.trim().length === 0) throw failure(422, 'KNOWLEDGE_CONTENT_EMPTY', 'Knowledge content cannot be empty')
  return decoded
}

function extensionFor(name) {
  const value = typeof name === 'string' ? name.toLowerCase() : ''
  const dot = value.lastIndexOf('.')
  return dot >= 0 ? value.slice(dot) : ''
}

function supportedFileType(asset) {
  const mime = String(asset?.mime || '').split(';', 1)[0].trim().toLowerCase()
  if (SUPPORTED_MIME_TYPES.has(mime)) return true
  // Existing FileAssets created before typed Markdown MIME values may carry a
  // generic text MIME. Extension fallback stays limited to a text-looking MIME
  // and known Markdown/plain-text suffixes; binary URLs are never admitted.
  return (mime === 'text/*' || mime === 'application/octet-stream') && SUPPORTED_EXTENSIONS.has(extensionFor(asset?.name))
}

function actorId(viewer) {
  return typeof viewer?.principal?.id === 'string' ? viewer.principal.id : null
}

function corpusKeyFor(businessId, projectId) {
  return `knowledge:${hashGenesisRag17Json({ businessId, projectId: projectId || null })}`
}

function namespacedIdempotencyKey(businessId, projectId, idempotencyKey) {
  return `knowledge:${hashGenesisRag17Json({ businessId, projectId: projectId || null, idempotencyKey })}`
}

function sourceMeta({ source, asset, content, contentHash, sourceVersion, title, projectId }) {
  return {
    kind: source.kind,
    title,
    sourceKey: source.kind === 'TEXT' ? source.sourceKey : (source.sourceKey || asset.id),
    sourceVersion,
    contentHash,
    projectId: projectId || null,
    ...(source.kind === 'FILE'
      ? {
          fileAssetId: asset.id,
          fileAssetVersion: asset.version,
          mime: asset.mime,
          size: Buffer.byteLength(content, 'utf8'),
          storageKind: asset.storageKind,
        }
      : {}),
  }
}

function sourceSummary(source) {
  if (!source) return null
  return {
    id: source.id,
    sourceKey: source.sourceKey,
    kind: source.kind,
    title: source.title,
    fileAssetId: source.fileAssetId ?? null,
    desiredRevision: source.desiredRevision,
    activeIngestionId: source.activeIngestionId ?? null,
    version: source.version,
    revoked: Boolean(source.revokedAt || source.deletedAt),
    revokedAt: source.revokedAt ?? null,
    deletedAt: source.deletedAt ?? null,
  }
}

function corpusSummary(corpus) {
  if (!corpus) return null
  return {
    id: corpus.id,
    corpusKey: corpus.corpusKey,
    businessId: corpus.businessId,
    projectId: corpus.projectId ?? null,
    generation: corpus.generation,
    version: corpus.version,
    status: corpus.status,
    deletedAt: corpus.deletedAt ?? null,
  }
}

function ingestionSummary(ingestion, { corpus, source, execution } = {}) {
  if (!ingestion) return null
  return {
    id: ingestion.id,
    admissionId: ingestion.id,
    executionRunId: ingestion.executionRunId ?? null,
    status: JOB_STATUSES.includes(ingestion.status) ? ingestion.status : ingestion.status,
    revision: ingestion.revision,
    sourceVersion: ingestion.sourceVersion,
    contentHash: ingestion.contentHash,
    source: sourceSummary(source),
    corpus: corpusSummary(corpus),
    snapshotId: ingestion.snapshotId ?? null,
    snapshotGeneration: ingestion.snapshotGeneration ?? null,
    receiptHash: ingestion.receiptHash ?? null,
    attempts: ingestion.attempts ?? 0,
    failureCode: ingestion.failureCode ?? null,
    createdAt: ingestion.createdAt ?? null,
    updatedAt: ingestion.updatedAt ?? null,
    ...(execution ? { execution } : {}),
  }
}

function pipelineSummary(run) {
  if (!run) return null
  return {
    executionRunId: run.executionRunId ?? null,
    status: run.status ?? null,
    currentStageId: run.currentStageId ?? null,
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    lastHeartbeatAt: run.lastHeartbeatAt ?? null,
    updatedAt: run.updatedAt ?? null,
  }
}

async function authorize(args, { db, env, authorization } = {}) {
  if (authorization) {
    const result = await authorization(args, { db, env })
    if (result === false || result?.authorized === false) {
      throw failure(403, 'KNOWLEDGE_ACCESS_DENIED', 'Knowledge access denied')
    }
    return result || { authorized: true }
  }
  if (args.operation === 'write' && args.source?.kind === 'FILE') {
    return assertKnowledgeFileWritable(args.viewer, args.source.fileAssetId, {
      businessId: args.businessId,
      projectId: args.projectId || null,
      db,
      env,
    })
  }
  return resolveKnowledgeScope({
    viewer: args.viewer,
    businessId: args.businessId,
    projectId: args.projectId || null,
    action: args.operation,
    db,
    env,
  })
}

async function loadFileSource(value, { db, fileContentResolver = defaultResolveFileAssetContent, asset: authorizedAsset } = {}) {
  const asset = authorizedAsset || await (db.fileAsset?.findUnique
    ? db.fileAsset.findUnique({ where: { id: value.source.fileAssetId } })
    : null)
  if (!asset || asset.deletedAt) throw failure(404, 'KNOWLEDGE_FILE_NOT_FOUND', 'File asset not found')
  if (asset.businessId !== value.businessId) throw failure(404, 'KNOWLEDGE_FILE_NOT_FOUND', 'File asset not found')
  if (value.projectId && asset.projectId !== value.projectId) {
    throw failure(404, 'KNOWLEDGE_FILE_NOT_FOUND', 'File asset not found')
  }
  if (!['LOCAL_FILE', 'MANAGED_BLOB'].includes(asset.storageKind)) {
    throw failure(415, 'KNOWLEDGE_FILE_TYPE_UNSUPPORTED', 'Only managed text and Markdown files can be admitted')
  }
  if (asset.status !== 'ACTIVE') {
    throw failure(409, 'KNOWLEDGE_FILE_UNAVAILABLE', `File asset is ${asset.status}`)
  }
  if (!supportedFileType(asset)) {
    throw failure(415, 'KNOWLEDGE_FILE_TYPE_UNSUPPORTED', 'Only plain text and Markdown files can be admitted')
  }

  let loaded
  try {
    loaded = await fileContentResolver(value.source.fileAssetId, {
      db,
      // This resolver is called only after the knowledge ACL has accepted the
      // target. It still receives a narrow visible set, never the whole viewer.
      visibleBusinessIds: [value.businessId],
    })
  } catch {
    throw failure(409, 'KNOWLEDGE_FILE_UNAVAILABLE', 'File asset content is unavailable')
  }
  let content
  try {
    content = decodeUtf8(loaded?.content ?? loaded)
  } catch (error) {
    if (error?.status) throw error
    throw failure(409, 'KNOWLEDGE_FILE_UNAVAILABLE', 'File asset content is unavailable')
  }
  const bytes = Buffer.from(content, 'utf8')
  if (Number.isInteger(asset.size) && asset.size !== bytes.length) {
    throw failure(409, 'KNOWLEDGE_FILE_SIZE_MISMATCH', 'File asset size does not match managed content')
  }
  const contentHash = createHash('sha256').update(bytes).digest('hex')
  if (asset.sha256 && asset.sha256.toLowerCase() !== contentHash) {
    throw failure(409, 'KNOWLEDGE_FILE_HASH_MISMATCH', 'File asset hash does not match managed content')
  }
  const sourceKey = value.source.sourceKey || asset.id
  const sourceVersion = value.source.version || asset.sha256 || contentHash
  const title = value.source.title || asset.name
  return {
    kind: 'FILE',
    content,
    contentHash,
    sourceKey,
    sourceVersion,
    title,
    asset,
  }
}

async function loadTextSource(source) {
  const bytes = contentBytes(source.content)
  return {
    kind: 'TEXT',
    content: source.content,
    contentHash: hashGenesisRag17Text(source.content),
    sourceKey: source.sourceKey,
    sourceVersion: source.version,
    title: source.title || source.sourceKey,
    asset: null,
    bytes,
  }
}

function requestHash({ value, source, contentHash, scope, policy }) {
  const candidate = {
    businessId: value.businessId,
    projectId: value.projectId || null,
    source: {
      kind: source.kind,
      sourceKey: source.sourceKey,
      sourceVersion: source.sourceVersion,
      title: source.title,
      fileAssetId: source.asset?.id || null,
      contentHash,
    },
    scope,
    policy,
  }
  return hashGenesisRag17Json(candidate)
}

function resultForAdmission(ingestion, { corpus, source, unchanged = false } = {}) {
  return {
    ...ingestionSummary(ingestion, { corpus, source }),
    unchanged,
  }
}

function isUniqueError(error) {
  return error?.code === 'P2002' || /unique|already exists|duplicate/i.test(error?.message || '')
}

export async function admitKnowledge(input, {
  db = prisma,
  viewer,
  env = process.env,
  now = new Date(),
  repository = createKnowledgeRepository(db),
  authorization,
  runtimeResolver = resolveKnowledgeRuntimeBinding,
  fileContentResolver = defaultResolveFileAssetContent,
} = {}) {
  const value = knowledgeAdmissionInput.parse(input)
  const sourceDescriptor = value.source.kind === 'FILE'
    ? {
        kind: 'FILE',
        fileAssetId: value.source.fileAssetId,
        sourceKey: value.source.sourceKey,
        version: value.source.version,
        title: value.source.title,
      }
    : {
        kind: 'TEXT',
        sourceKey: value.source.sourceKey,
        version: value.source.version,
        title: value.source.title,
      }

  const access = await authorize({
    viewer,
    operation: 'write',
    businessId: value.businessId,
    projectId: value.projectId || null,
    source: sourceDescriptor,
  }, { db, env, authorization })

  const source = value.source.kind === 'FILE'
    ? await loadFileSource(value, { db, fileContentResolver, asset: access?.asset })
    : await loadTextSource(value.source)

  let binding
  try {
    binding = await runtimeResolver(
      { businessId: value.businessId, projectId: value.projectId || null },
      { db, env },
    )
  } catch {
    throw failure(503, 'KNOWLEDGE_RUNTIME_UNAVAILABLE', 'Knowledge runtime is unavailable')
  }
  const scope = safeScope(binding?.scope, value, access)
  const policy = safePolicy(binding?.policy)
  const contentHash = source.contentHash
  const namespacedKey = namespacedIdempotencyKey(value.businessId, value.projectId, value.idempotencyKey)
  const requestHashValue = requestHash({ value, source, contentHash, scope, policy })
  const admittedAt = typeof now === 'function' ? now() : (now || new Date())
  const sourceMetaJson = JSON.stringify(sourceMeta({
    source: value.source,
    asset: source.asset,
    content: source.content,
    contentHash,
    sourceVersion: source.sourceVersion,
    title: source.title,
    projectId: value.projectId,
  }))

  try {
    return await repository.transaction(async (tx) => {
      let corpus = await tx.findCorpusByKey(corpusKeyFor(value.businessId, value.projectId))
      if (corpus) {
        if (corpus.deletedAt || corpus.status !== 'ACTIVE') {
          throw failure(409, 'KNOWLEDGE_CORPUS_UNAVAILABLE', 'Knowledge corpus is unavailable')
        }
        if (
          corpus.businessId !== value.businessId
          || (corpus.projectId || null) !== (value.projectId || null)
          || !equalJson(parseJson(corpus.scopeJson), scope)
          || !equalJson(parseJson(corpus.policyJson), policy)
        ) {
          throw failure(409, 'KNOWLEDGE_CORPUS_SCOPE_CONFLICT', 'Knowledge corpus scope has changed')
        }
      } else {
        corpus = await tx.createCorpus({
          corpusKey: corpusKeyFor(value.businessId, value.projectId),
          portfolioId: scope.portfolioId,
          tenantId: scope.tenantId,
          businessId: value.businessId,
          projectId: value.projectId || null,
          workspaceId: scope.workspaceId || '',
          scopeJson: JSON.stringify(scope),
          policyJson: JSON.stringify(policy),
          status: 'ACTIVE',
          generation: 0,
          version: 1,
          createdAt: admittedAt,
          updatedAt: admittedAt,
        })
      }

      const existingKey = await tx.findIngestionByKey(namespacedKey)
      if (existingKey) {
        if (existingKey.requestHash !== requestHashValue) {
          throw failure(409, 'KNOWLEDGE_IDEMPOTENCY_CONFLICT', 'Idempotency key was already used for different input')
        }
        const existingSource = await tx.getSource(existingKey.sourceId)
        return resultForAdmission(existingKey, { corpus, source: existingSource, unchanged: true })
      }

      let sourceRow = await tx.findSource(corpus.id, source.sourceKey)
      if (sourceRow) {
        const expectedFileId = source.asset?.id || null
        if (sourceRow.kind !== value.source.kind || (sourceRow.fileAssetId || null) !== expectedFileId) {
          throw failure(409, 'KNOWLEDGE_SOURCE_CONFLICT', 'Source key belongs to a different source')
        }
      } else {
        sourceRow = await tx.createSource({
          corpusId: corpus.id,
          sourceKey: source.sourceKey,
          kind: value.source.kind,
          title: source.title,
          fileAssetId: source.asset?.id || null,
          desiredRevision: 0,
          activeIngestionId: null,
          version: 1,
          revokedAt: null,
          createdAt: admittedAt,
          updatedAt: admittedAt,
        })
      }

      const existingVersion = await tx.findIngestionVersion(sourceRow.id, source.sourceVersion)
      if (existingVersion) {
        throw failure(409, 'KNOWLEDGE_SOURCE_VERSION_CONFLICT', 'Source version was already admitted with a different request')
      }

      const revision = Number(sourceRow.desiredRevision || 0) + 1
      if (sourceRow.desiredRevision === revision) {
        throw failure(409, 'KNOWLEDGE_SOURCE_REVISION_CONFLICT', 'Source revision could not be advanced')
      }
      const updatedSource = await tx.updateSource(sourceRow.id, sourceRow.version, {
        desiredRevision: revision,
        title: source.title,
        revokedAt: null,
      })
      if (!updatedSource) throw failure(409, 'KNOWLEDGE_SOURCE_REVISION_CONFLICT', 'Source changed while it was admitted')

      const ingestion = await tx.createIngestion({
        corpusId: corpus.id,
        sourceId: sourceRow.id,
        revision,
        sourceVersion: source.sourceVersion,
        contentHash,
        content: source.content,
        sourceMetaJson,
        idempotencyKey: namespacedKey,
        requestHash: requestHashValue,
        submittedById: actorId(viewer),
        status: 'QUEUED',
        executionRunId: null,
        rawArtifactId: null,
        parsedArtifactId: null,
        snapshotId: null,
        snapshotGeneration: null,
        receiptHash: null,
        claimToken: null,
        leaseExpiresAt: null,
        attempts: 0,
        failureCode: null,
        version: 1,
        createdAt: admittedAt,
        updatedAt: admittedAt,
      })
      await tx.audit?.({
        entityId: ingestion.id,
        entityType: 'KNOWLEDGE_INGESTION',
        action: 'KNOWLEDGE_ADMISSION_QUEUED',
        actorId: actorId(viewer),
        payload: {
          corpusId: corpus.id,
          sourceId: sourceRow.id,
          sourceVersion: source.sourceVersion,
          contentHash,
          revision,
        },
      })
      return resultForAdmission(ingestion, { corpus, source: updatedSource, unchanged: false })
    })
  } catch (error) {
    if (error?.status) throw error
    if (isUniqueError(error)) throw failure(409, 'KNOWLEDGE_ADMISSION_CONFLICT', 'Knowledge admission conflicts with a concurrent request')
    throw error
  }
}

async function readTargetForIngestion(id, { repository }) {
  const ingestion = await repository.getIngestion(id)
  if (!ingestion) throw failure(404, 'KNOWLEDGE_INGESTION_NOT_FOUND', 'Knowledge ingestion not found')
  const [corpus, source] = await Promise.all([
    repository.getCorpus(ingestion.corpusId),
    repository.getSource(ingestion.sourceId),
  ])
  if (
    !corpus ||
    !source ||
    corpus.deletedAt ||
    ingestion.corpusId !== corpus.id ||
    source.corpusId !== corpus.id
  ) throw failure(404, 'KNOWLEDGE_INGESTION_NOT_FOUND', 'Knowledge ingestion not found')
  if (corpus.status !== 'ACTIVE') throw failure(409, 'KNOWLEDGE_CORPUS_UNAVAILABLE', 'Knowledge corpus is unavailable')
  return { ingestion, corpus, source }
}

export async function readKnowledgeIngestion(id, {
  db = prisma,
  viewer,
  env = process.env,
  repository = createKnowledgeRepository(db),
  authorization,
} = {}) {
  if (typeof id !== 'string' || !id.trim()) throw failure(400, 'KNOWLEDGE_INGESTION_ID_REQUIRED', 'Admission id is required')
  const target = await readTargetForIngestion(id, { repository })
  await authorize({
    viewer,
    operation: 'read',
    businessId: target.corpus.businessId,
    projectId: target.corpus.projectId || null,
    source: {
      kind: target.source.kind,
      sourceKey: target.source.sourceKey,
      fileAssetId: target.source.fileAssetId || undefined,
    },
  }, { db, env, authorization })
  let execution = null
  if (target.ingestion.executionRunId && repository.getPipelineRun) {
    execution = pipelineSummary(await repository.getPipelineRun(target.ingestion.executionRunId))
  }
  return ingestionSummary(target.ingestion, {
    corpus: target.corpus,
    source: target.source,
    execution,
  })
}

export async function listKnowledgeIngestions({ businessId, projectId = null, limit = 50 }, {
  db = prisma,
  viewer,
  env = process.env,
  repository = createKnowledgeRepository(db),
  authorization,
} = {}) {
  const target = z.object({ businessId: identifier, projectId: identifier.nullish(), limit: z.coerce.number().int().min(1).max(MAX_LIMIT).default(50) }).parse({ businessId, projectId, limit })
  await authorize({
    viewer,
    operation: 'read',
    businessId: target.businessId,
    projectId: target.projectId || null,
  }, { db, env, authorization })
  const corpus = await repository.findCorpusByKey(corpusKeyFor(target.businessId, target.projectId))
  if (!corpus || corpus.deletedAt) return { corpus: null, items: [], count: 0, limit: target.limit }
  if (corpus.status !== 'ACTIVE') throw failure(409, 'KNOWLEDGE_CORPUS_UNAVAILABLE', 'Knowledge corpus is unavailable')
  const rows = await repository.listIngestions({ corpusId: corpus.id, limit: target.limit })
  const sourceIds = [...new Set(rows.map((row) => row.sourceId))]
  const sources = await Promise.all(sourceIds.map((id) => repository.getSource(id)))
  const byId = new Map(sources.filter(Boolean).map((source) => [source.id, source]))
  if (rows.some((row) => row.corpusId !== corpus.id || byId.get(row.sourceId)?.corpusId !== corpus.id)) {
    throw failure(404, 'KNOWLEDGE_INGESTION_NOT_FOUND', 'Knowledge ingestion not found')
  }
  return {
    corpus: corpusSummary(corpus),
    items: rows.map((row) => ingestionSummary(row, { corpus, source: byId.get(row.sourceId) })),
    count: rows.length,
    limit: target.limit,
  }
}

/** A small factory keeps HTTP/MCP tests on the same service while allowing the
 * production singleton functions above to use the server's default ports. */
export function createKnowledgeAdmissionService(defaults = {}) {
  return Object.freeze({
    admitKnowledge: (input, options = {}) => admitKnowledge(input, { ...defaults, ...options }),
    readKnowledgeIngestion: (id, options = {}) => readKnowledgeIngestion(id, { ...defaults, ...options }),
    listKnowledgeIngestions: (input, options = {}) => listKnowledgeIngestions(input, { ...defaults, ...options }),
  })
}

export const KNOWLEDGE_ADMISSION_STATUSES = JOB_STATUSES
export const KNOWLEDGE_ADMISSION_MAX_CONTENT_BYTES = MAX_CONTENT_BYTES
