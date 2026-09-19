// @req FR-109, FR-173 — raw artifacts are persisted to an immutable object
// version before the lineage references it, and reads verify exact bytes.
// @spec TASK-ZAI-049 storage spec, ADR-072, FR-111
// @tested tests/unit/knowledge-artifact-storage-service.test.js

import { createHash } from 'node:crypto'

const SCOPE_KEYS = Object.freeze(['portfolioId', 'tenantId', 'businessId', 'workspaceId', 'agentId', 'visibility'])
const READY = 'READY'
const PENDING = 'PENDING'
const QUARANTINED = 'QUARANTINED'
const ERASED = 'ERASED'

function storageError(message, status = 503, code = 'KNOWLEDGE_STORAGE_UNAVAILABLE') {
  const error = new Error(message)
  error.status = status
  error.code = code
  return error
}

function scopeData(scope) {
  for (const key of SCOPE_KEYS) if (typeof scope?.[key] !== 'string') throw storageError(`Knowledge storage scope requires ${key}`, 400, 'KNOWLEDGE_STORAGE_SCOPE_INVALID')
  return Object.fromEntries(SCOPE_KEYS.map((key) => [key, scope[key]]))
}

function bytesOf(content) {
  if (Buffer.isBuffer(content)) return Buffer.from(content)
  if (content instanceof Uint8Array) return Buffer.from(content)
  if (typeof content === 'string') return Buffer.from(content, 'utf8')
  throw storageError('Knowledge storage content must be bytes or text', 400, 'KNOWLEDGE_STORAGE_CONTENT_INVALID')
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function required(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw storageError(`${label} is required`, 400, 'KNOWLEDGE_STORAGE_INPUT_INVALID')
  return value.trim()
}

function policyJson(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw storageError('Knowledge storage policy is required', 400, 'KNOWLEDGE_STORAGE_POLICY_REQUIRED')
  return JSON.stringify(policy)
}

function keyFor({ scope, rawArtifactId, sha256 }) {
  const safe = (value) => encodeURIComponent(required(value, 'Knowledge storage key component'))
  return `knowledge/raw/${safe(scope.tenantId)}/${safe(scope.businessId)}/${safe(rawArtifactId)}/${sha256}`
}

function assertStorageModel(db) {
  if (!db?.knowledgeArtifactStorage || !db?.knowledgeArtifactOperation) throw storageError('Knowledge artifact storage schema is unavailable', 503, 'KNOWLEDGE_STORAGE_SCHEMA_UNAVAILABLE')
}

function assertStorageScope(row, scope) {
  for (const key of SCOPE_KEYS) if (row?.[key] !== scope[key]) throw storageError('Knowledge storage reference is outside the requested scope', 403, 'KNOWLEDGE_STORAGE_SCOPE_DENIED')
}

async function recordOperation(db, data) {
  return db.knowledgeArtifactOperation.create({ data })
}

export async function storeKnowledgeRawArtifact({
  db,
  storage,
  scope,
  rawArtifactId,
  content,
  contentType = 'application/octet-stream',
  bindingId,
  bindingRevision,
  bucket,
  policy,
  retentionUntil = null,
  idempotencyKey = `knowledge-storage:put:${rawArtifactId}`,
  actorId = null,
  now = () => new Date(),
} = {}) {
  assertStorageModel(db)
  if (!storage || typeof storage.putImmutable !== 'function' || typeof storage.readExact !== 'function') throw storageError('Knowledge object storage port is unavailable', 503, 'KNOWLEDGE_STORAGE_PORT_UNAVAILABLE')
  const normalizedScope = scopeData(scope)
  const rawId = required(rawArtifactId, 'Raw artifact id')
  const binding = required(bindingId, 'Storage binding')
  if (!Number.isSafeInteger(bindingRevision) || bindingRevision < 1) throw storageError('Storage binding revision is invalid', 400, 'KNOWLEDGE_STORAGE_BINDING_INVALID')
  const bytes = bytesOf(content)
  const sha256 = digest(bytes)
  const key = keyFor({ scope: normalizedScope, rawArtifactId: rawId, sha256 })
  const existing = await db.knowledgeArtifactStorage.findUnique({ where: { rawArtifactId: rawId } })
  if (existing) {
    assertStorageScope(existing, normalizedScope)
    if (existing.sha256 !== sha256 || existing.objectKey !== key || existing.bindingId !== binding) throw storageError('Knowledge storage identity was reused with different immutable content', 409, 'KNOWLEDGE_STORAGE_IDENTITY_CONFLICT')
    if (existing.status === READY) return existing
  }
  const timestamp = typeof now === 'function' ? now() : now
  const row = existing || await db.knowledgeArtifactStorage.create({ data: {
    ...normalizedScope,
    rawArtifactId: rawId,
    bindingId: binding,
    bindingRevision,
    bucket: required(bucket, 'Storage bucket'),
    objectKey: key,
    sha256,
    byteLength: bytes.length,
    contentType: required(contentType, 'Storage content type'),
    policyJson: policyJson(policy),
    retentionUntil,
    status: PENDING,
    createdAt: timestamp,
    updatedAt: timestamp,
  } })
  const operation = existing
    ? await db.knowledgeArtifactOperation.findUnique({ where: { idempotencyKey } }) || await recordOperation(db, { ...normalizedScope, storageId: row.id, idempotencyKey, operation: 'PUT', status: PENDING, actorId })
    : await recordOperation(db, { ...normalizedScope, storageId: row.id, idempotencyKey, operation: 'PUT', status: PENDING, actorId })
  try {
    const uploaded = row.objectVersionId
      ? { key: row.objectKey, versionId: row.objectVersionId, sha256, byteLength: bytes.length }
      : await storage.putImmutable({ key, content: bytes, contentType, expectedSha256: sha256 })
    const read = await storage.readExact({ key, versionId: uploaded.versionId })
    if (read.sha256 !== sha256 || read.byteLength !== bytes.length || !Buffer.from(read.bytes).equals(bytes)) throw storageError('Knowledge storage readback hash mismatch', 409, 'KNOWLEDGE_STORAGE_READBACK_MISMATCH')
    const ready = await db.knowledgeArtifactStorage.update({ where: { id: row.id }, data: { objectVersionId: uploaded.versionId, status: READY, version: { increment: 1 }, updatedAt: timestamp } })
    await db.knowledgeArtifactOperation.update({ where: { id: operation.id }, data: { status: READY, attempts: { increment: 1 }, evidenceHash: sha256, updatedAt: timestamp } })
    return ready
  } catch (error) {
    const code = error?.code || 'KNOWLEDGE_STORAGE_PUT_FAILED'
    await db.knowledgeArtifactOperation.update({ where: { id: operation.id }, data: { status: 'FAILED', attempts: { increment: 1 }, errorCode: code, updatedAt: timestamp } }).catch(() => {})
    if (error?.code === 'KNOWLEDGE_STORAGE_HASH_MISMATCH' || error?.code === 'KNOWLEDGE_STORAGE_READBACK_MISMATCH') await db.knowledgeArtifactStorage.update({ where: { id: row.id }, data: { status: QUARANTINED, updatedAt: timestamp } }).catch(() => {})
    throw error
  }
}

export async function readKnowledgeRawArtifact({ db, storage, rawArtifactId, scope, authorize } = {}) {
  assertStorageModel(db)
  if (!storage || typeof storage.readExact !== 'function') throw storageError('Knowledge object storage port is unavailable', 503, 'KNOWLEDGE_STORAGE_PORT_UNAVAILABLE')
  const normalizedScope = scopeData(scope)
  const row = await db.knowledgeArtifactStorage.findUnique({ where: { rawArtifactId } })
  if (!row) throw storageError('Knowledge storage reference was not found', 404, 'KNOWLEDGE_STORAGE_NOT_FOUND')
  assertStorageScope(row, normalizedScope)
  if (typeof authorize !== 'function' || !(await authorize(row))) throw storageError('Knowledge storage read is denied', 403, 'KNOWLEDGE_STORAGE_READ_DENIED')
  if (row.status !== READY || !row.objectVersionId) throw storageError('Knowledge storage reference is not readable', 409, 'KNOWLEDGE_STORAGE_NOT_READY')
  const result = await storage.readExact({ key: row.objectKey, versionId: row.objectVersionId })
  if (result.sha256 !== row.sha256 || result.byteLength !== row.byteLength) throw storageError('Knowledge storage content failed integrity verification', 409, 'KNOWLEDGE_STORAGE_INTEGRITY_FAILURE')
  return { ...result, storageId: row.id, rawArtifactId: row.rawArtifactId, contentType: row.contentType }
}

export async function eraseKnowledgeRawArtifact({ db, storage, rawArtifactId, scope, authorize, actorId = null, reason, now = () => new Date() } = {}) {
  assertStorageModel(db)
  if (!storage || typeof storage.eraseExactVersions !== 'function') throw storageError('Knowledge object storage erasure port is unavailable', 503, 'KNOWLEDGE_STORAGE_PORT_UNAVAILABLE')
  const normalizedScope = scopeData(scope)
  const row = await db.knowledgeArtifactStorage.findUnique({ where: { rawArtifactId } })
  if (!row) throw storageError('Knowledge storage reference was not found', 404, 'KNOWLEDGE_STORAGE_NOT_FOUND')
  assertStorageScope(row, normalizedScope)
  if (typeof authorize !== 'function' || !(await authorize(row))) throw storageError('Knowledge storage erasure is denied', 403, 'KNOWLEDGE_STORAGE_ERASURE_DENIED')
  if (row.status === ERASED) return row
  if (!reason || typeof reason !== 'string' || !reason.trim()) throw storageError('Knowledge storage erasure requires a reason', 400, 'KNOWLEDGE_STORAGE_ERASURE_REASON_REQUIRED')
  if (!row.objectVersionId) throw storageError('Knowledge storage reference has no exact version for erasure', 409, 'KNOWLEDGE_STORAGE_VERSION_REQUIRED')
  const timestamp = typeof now === 'function' ? now() : now
  const idempotencyKey = `knowledge-storage:erase:${row.id}:${row.objectVersionId}`
  const operation = await db.knowledgeArtifactOperation.findUnique({ where: { idempotencyKey } }) || await recordOperation(db, { ...normalizedScope, storageId: row.id, idempotencyKey, operation: 'ERASE', status: 'PENDING', actorId, reason })
  await storage.eraseExactVersions({ key: row.objectKey, versionIds: [row.objectVersionId] })
  const erased = await db.knowledgeArtifactStorage.update({ where: { id: row.id }, data: { status: ERASED, version: { increment: 1 }, updatedAt: timestamp } })
  await db.knowledgeArtifactOperation.update({ where: { id: operation.id }, data: { status: ERASED, attempts: { increment: 1 }, reason, updatedAt: timestamp } })
  return erased
}

export function createKnowledgeStorageBindingFromEnvironment(env = process.env) {
  if (env.ZURI_KNOWLEDGE_STORAGE_ENABLED !== '1') return null
  const bindingId = env.ZURI_KNOWLEDGE_STORAGE_BINDING_ID
  const bindingRevision = Number(env.ZURI_KNOWLEDGE_STORAGE_BINDING_REVISION || 1)
  const bucket = env.ZURI_KNOWLEDGE_STORAGE_BUCKET
  if (!bindingId || !bucket || !Number.isSafeInteger(bindingRevision) || bindingRevision < 1) throw storageError('Knowledge storage binding configuration is invalid', 503, 'KNOWLEDGE_STORAGE_CONFIG_INVALID')
  return Object.freeze({ id: bindingId, revision: bindingRevision, bucket })
}

export { keyFor as buildKnowledgeRawArtifactKey, digest as hashKnowledgeArtifact }
