// @spec ADR-107 - Business-scoped file lifecycle and exact-version receipts.
// @tested tests/file-service.test.js, tests/http-server.test.js
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { Transform } from 'node:stream'
import { fail, FileManagementError } from './errors.js'
import {
  isUuid,
  normalizeContentType,
  normalizeFileName,
  normalizeProvenance,
  normalizeSha256,
  requireIdempotencyKey,
  requireUuid,
  requestDigest,
  normalizeFileListOptions,
  inspectUploadFile,
} from './validation.js'

const PERMISSIONS = Object.freeze({ create: 'files:create', append: 'files:write', read: 'files:read', history: 'files:read' })
const PROVENANCE_PERMISSIONS = Object.freeze({
  LINE_CAPTURE: 'files:line-capture',
  GIT_SNAPSHOT: 'files:sot-snapshot',
  KNOWLEDGE_EXPORT: 'files:knowledge-artifact',
  API_IMPORT: 'files:system-import',
})

function validGrant(grant, requested, permission) {
  if (!grant || !isUuid(grant.actorId) || !isUuid(grant.tenantId) || !isUuid(grant.businessId) ||
      grant.tenantId.toLowerCase() !== requested.tenantId || grant.businessId.toLowerCase() !== requested.businessId ||
      !Array.isArray(grant.permissions) || !grant.permissions.includes(permission)) {
    fail('FILE_AUTHORITY_DENIED', 403, 'The current authority does not grant this file operation')
  }
  return Object.freeze({ actorId: grant.actorId.toLowerCase(), tenantId: grant.tenantId.toLowerCase(), businessId: grant.businessId.toLowerCase(), permissions: [...grant.permissions] })
}

function statusError(error, code, message) {
  if (error instanceof FileManagementError) return error
  return new FileManagementError(code, 503, message)
}

function integrityStream(body, expected) {
  const hash = createHash('sha256')
  let byteLength = 0
  let failed = false
  const stream = new Transform({
    transform(chunk, encoding, callback) {
      byteLength += chunk.length
      hash.update(chunk)
      callback(null, chunk)
    },
    flush(callback) {
      const digest = hash.digest('hex')
      if (byteLength !== expected.byteLength || digest !== expected.sha256) {
        failed = true
        callback(new FileManagementError('FILE_CONTENT_MISMATCH', 503, 'Stored bytes failed integrity verification'))
        return
      }
      callback()
    },
  })
  body.on('error', (error) => { if (!failed) stream.destroy(statusError(error, 'FILE_STORAGE_READ_FAILED', 'Stored file could not be read')) })
  body.pipe(stream)
  return stream
}

export function createFileService({ repository, storage, authority, maxUploadBytes = 512 * 1024 * 1024, now = () => new Date(), makeId = randomUUID } = {}) {
  if (!repository || !storage) throw new TypeError('File service requires repository and storage ports')
  const grantActions = new WeakMap()

  async function authorize({ bearerToken, action, tenantId, businessId, provenance: requestedProvenance }) {
    const requested = { tenantId: requireUuid(tenantId, 'tenantId'), businessId: requireUuid(businessId, 'businessId') }
    if (!Object.values(PERMISSIONS).includes(action)) fail('FILE_ACTION_INVALID', 400, 'Requested file action is not supported')
    if (typeof bearerToken !== 'string' || !bearerToken.trim()) fail('FILE_AUTHENTICATION_REQUIRED', 401, 'A bearer token is required')
    if (bearerToken.length > 8192) fail('FILE_AUTHENTICATION_INVALID', 400, 'Bearer token exceeds its limit')
    if (typeof authority?.authorize !== 'function') fail('FILE_AUTHORITY_UNAVAILABLE', 503, 'File authority is not configured')
    const provenance = requestedProvenance === undefined ? undefined : normalizeProvenance(requestedProvenance)
    let grant
    try {
      grant = await authority.authorize({ bearerToken, action, ...requested, ...(provenance ? { provenance } : {}) })
    } catch (error) {
      if (error instanceof FileManagementError) throw error
      fail('FILE_AUTHORITY_UNAVAILABLE', 503, 'File authority could not confirm this operation')
    }
    const permission = Object.entries(PERMISSIONS).find(([, expected]) => expected === action)?.[1] || action
    const validated = validGrant(grant, requested, permission)
    const provenancePermission = PROVENANCE_PERMISSIONS[provenance?.kind]
    if (provenancePermission && !validated.permissions.includes(provenancePermission)) fail('FILE_PROVENANCE_DENIED', 403, 'Authority does not permit this source provenance')
    grantActions.set(validated, action)
    return validated
  }

  function assertGrantAction(grant, action) {
    if (!grant || grantActions.get(grant) !== action) fail('FILE_AUTHORITY_DENIED', 403, 'A current authority grant for this file action is required')
  }

  async function assertFileScope(fileId, grant, action = 'files:read') {
    assertGrantAction(grant, action)
    const record = await repository.getFile(fileId)
    if (!record || record.tenantId !== grant.tenantId || record.businessId !== grant.businessId || record.deletedAt || record.status !== 'ACTIVE') {
      fail('FILE_NOT_FOUND', 404, 'File was not found')
    }
    return record
  }

  async function assertAppendTarget(grant, fileId) {
    const scoped = await assertFileScope(requireUuid(fileId, 'fileId'), grant, 'files:write')
    if (scoped.status !== 'ACTIVE') fail('FILE_NOT_WRITABLE', 409, 'File is not active')
  }

  async function prepareOperation({ grant, operationId, correlationId, deadlineAt: requestedDeadline, fileId, operationType, idempotencyKey, fileName, contentType, sha256, byteLength, provenance }) {
    const writeAction = PERMISSIONS[operationType === 'CREATE' ? 'create' : 'append']
    assertGrantAction(grant, writeAction)
    const actorGrant = validGrant(grant, { tenantId: grant.tenantId, businessId: grant.businessId }, writeAction)
    const normalized = {
      operationId: requireUuid(operationId, 'operationId'),
      correlationId: requireUuid(correlationId, 'correlationId'),
      operationType,
      tenantId: actorGrant.tenantId,
      businessId: actorGrant.businessId,
      fileId: fileId ? requireUuid(fileId, 'fileId') : null,
      idempotencyKey: requireIdempotencyKey(idempotencyKey),
      fileName: normalizeFileName(fileName),
      contentType: normalizeContentType(contentType),
      sha256: normalizeSha256(sha256),
      byteLength,
      provenance: normalizeProvenance(provenance),
    }
    const deadlineAt = new Date(requestedDeadline)
    const nowMs = new Date(now()).valueOf()
    if (Number.isNaN(deadlineAt.valueOf()) || deadlineAt.valueOf() <= nowMs || deadlineAt.valueOf() - nowMs > 3600000) {
      fail('FILE_DEADLINE_INVALID', 408, 'File operation deadline is expired or outside the allowed window')
    }
    const provenancePermission = PROVENANCE_PERMISSIONS[normalized.provenance.kind]
    if (provenancePermission && !actorGrant.permissions.includes(provenancePermission)) {
      fail('FILE_PROVENANCE_DENIED', 403, 'Authority does not permit this source provenance')
    }
    if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > maxUploadBytes) fail('FILE_SIZE_INVALID', 413, 'File size is outside the configured limit')
    let storageReady
    try { storageReady = await storage.health() } catch { fail('FILE_STORAGE_UNAVAILABLE', 503, 'Versioned private storage is unavailable') }
    if (storageReady !== true) fail('FILE_STORAGE_UNAVAILABLE', 503, 'Versioned private storage is unavailable')
    let storageBinding
    try { storageBinding = await storage.binding() } catch { fail('FILE_STORAGE_BINDING_UNAVAILABLE', 503, 'File storage identity is unavailable') }
    if (!storageBinding || storageBinding.provider !== 'S3_COMPATIBLE' || typeof storageBinding.bindingId !== 'string' || !storageBinding.bindingId || typeof storageBinding.bucket !== 'string' || !storageBinding.bucket) {
      fail('FILE_STORAGE_BINDING_UNAVAILABLE', 503, 'File storage identity is invalid')
    }

    const digest = requestDigest(normalized)
    const proposed = { ...normalized, fileId: normalized.fileId || makeId(), versionId: makeId(), storageProvider: storageBinding.provider, storageBindingId: storageBinding.bindingId, storageBucket: storageBinding.bucket, actorId: actorGrant.actorId, requestDigest: digest, createdAt: now() }
    let operation
    try {
      operation = await repository.beginOperation(proposed)
    } catch (error) {
      throw statusError(error, 'FILE_METADATA_UNAVAILABLE', 'File operation could not be recorded')
    }
    if (operation.requestDigest !== digest || operation.operationType !== operationType || operation.fileId !== proposed.fileId && operationType === 'APPEND') {
      fail('FILE_IDEMPOTENCY_CONFLICT', 409, 'Idempotency-Key was already used for a different file request')
    }
    if (operation.storageProvider !== storageBinding.provider || operation.storageBindingId !== storageBinding.bindingId || operation.storageBucket !== storageBinding.bucket) {
      fail('FILE_STORAGE_BINDING_CHANGED', 503, 'The pending file operation belongs to a different storage binding')
    }
    if (operation.status === 'COMMITTED') return { normalized, operation, result: operation.result }
    if (operation.status !== 'PENDING') fail('FILE_OPERATION_NOT_RETRYABLE', 409, 'File operation is not in a retryable state')
    return { normalized, operation, result: null }
  }

  async function writeVersion(input, operationType) {
    const prepared = await prepareOperation({ ...input, operationType })
    await inspectUploadFile(input.bodyPath, { byteLength: prepared.normalized.byteLength, sha256: prepared.normalized.sha256 })
    if (prepared.result) return prepared.result
    const { normalized, operation } = prepared
    const key = 'originals/' + operation.tenantId + '/' + operation.businessId + '/' + operation.fileId + '/' + operation.operationId
    let stored
    try {
      stored = await storage.putImmutable({
        key,
        bodyPath: input.bodyPath,
        operationId: operation.operationId,
        sha256: normalized.sha256,
        byteLength: normalized.byteLength,
        contentType: normalized.contentType,
      })
    } catch (error) {
      if (error instanceof FileManagementError) throw error
      fail('FILE_STORAGE_WRITE_UNCERTAIN', 503, 'File storage outcome is not yet confirmed', { operationId: operation.operationId })
    }
    if (!stored || stored.provider !== operation.storageProvider || stored.bindingId !== operation.storageBindingId || stored.bucket !== operation.storageBucket || typeof stored.versionId !== 'string' || !stored.versionId || stored.versionId === 'null' || stored.sha256 !== normalized.sha256 || stored.byteLength !== normalized.byteLength) {
      fail('FILE_STORAGE_VERSION_UNAVAILABLE', 503, 'Storage did not confirm the exact immutable object version', { operationId: operation.operationId })
    }
    try {
      return await repository.commitOperation({ operation, stored, now: now() })
    } catch {
      fail('FILE_OPERATION_PENDING', 503, 'Original bytes are stored; file metadata is pending reconciliation', { operationId: operation.operationId })
    }
  }

  return Object.freeze({
    authorize,
    async prepareCreateFile(input) {
      return (await prepareOperation({ ...input, operationType: 'CREATE' })).result
    },
    async prepareAppendVersion(input) {
      const grant = input.grant
      const fileId = requireUuid(input.fileId, 'fileId')
      await assertAppendTarget(grant, fileId)
      return (await prepareOperation({ ...input, fileId, operationType: 'APPEND' })).result
    },
    async createFile(input) {
      return writeVersion(input, 'CREATE')
    },
    async appendVersion(input) {
      const fileId = requireUuid(input.fileId, 'fileId')
      await assertAppendTarget(input.grant, fileId)
      return writeVersion({ ...input, fileId }, 'APPEND')
    },
    async preflightAppend({ grant, fileId }) {
      await assertAppendTarget(grant, fileId)
      return true
    },
    async getFile({ grant, fileId }) {
      await assertFileScope(requireUuid(fileId, 'fileId'), grant)
      const file = await repository.getFile(fileId)
      if (!file) fail('FILE_NOT_FOUND', 404, 'File was not found')
      return file
    },
    async listFiles({ grant, limit, cursor, query } = {}) {
      assertGrantAction(grant, 'files:read')
      const options = normalizeFileListOptions({ limit, cursor, query })
      const rows = await repository.listFiles({ tenantId: grant.tenantId, businessId: grant.businessId, limit: options.limit + 1, cursor: options.cursor, query: options.query })
      const hasMore = rows.length > options.limit
      const files = hasMore ? rows.slice(0, options.limit) : rows
      const last = files.at(-1)
      const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ id: last.id, updatedAt: new Date(last.updatedAt).toISOString() })).toString('base64url') : null
      return { files, nextCursor }
    },
    async listVersions({ grant, fileId }) {
      const scopedFileId = requireUuid(fileId, 'fileId')
      await assertFileScope(scopedFileId, grant)
      return repository.listVersions(scopedFileId)
    },
    async readVersion({ grant, fileId, versionId }) {
      const scopedFileId = requireUuid(fileId, 'fileId')
      const scopedVersionId = requireUuid(versionId, 'versionId')
      await assertFileScope(scopedFileId, grant)
      const version = await repository.getVersion(scopedFileId, scopedVersionId)
      if (!version) fail('FILE_VERSION_NOT_FOUND', 404, 'File version was not found')
      if (version.safetyState === 'BLOCKED' || version.safetyState === 'UNKNOWN') fail('FILE_SAFETY_BLOCKED', 423, 'File version is not available for download')
      let stored
      try {
        stored = await storage.readExact({ provider: version.storageProvider, bindingId: version.storageBindingId, bucket: version.storageBucket, key: version.storageKey, versionId: version.storageVersionId })
      } catch (error) {
        if (error instanceof FileManagementError) throw error
        fail('FILE_STORAGE_READ_FAILED', 503, 'Exact file version could not be read')
      }
      if (stored.versionId !== version.storageVersionId || stored.byteLength !== version.byteLength) {
        stored.body?.destroy?.()
        fail('FILE_CONTENT_MISMATCH', 503, 'Stored file version metadata does not match its receipt')
      }
      return { version, body: integrityStream(stored.body, version) }
    },
    async readiness() {
      const checks = await Promise.allSettled([
        repository.health(),
        storage.health(),
        typeof authority?.health === 'function' ? authority.health() : Promise.reject(new Error('authority unavailable')),
      ])
      return { ready: checks.every((check) => check.status === 'fulfilled' && check.value === true), dependencies: { repository: checks[0].status === 'fulfilled' && checks[0].value === true, storage: checks[1].status === 'fulfilled' && checks[1].value === true, authority: checks[2].status === 'fulfilled' && checks[2].value === true } }
    },
  })
}
