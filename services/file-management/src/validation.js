// @spec ADR-107 - strict scope, provenance, idempotency and payload validation.
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { basename } from 'node:path'
import { fail } from './errors.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SHA256 = /^[a-f0-9]{64}$/i
const MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i
const PROVENANCE_TYPES = new Set(['BROWSER_UPLOAD', 'LINE_CAPTURE', 'KNOWLEDGE_EXPORT', 'GIT_SNAPSHOT', 'API_IMPORT', 'OTHER'])

export function requireUuid(value, field) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('FILE_REQUEST_INVALID', 400, `${field} must be a UUID`)
  return value.toLowerCase()
}

export function requireIdempotencyKey(value) {
  if (typeof value !== 'string' || value.trim().length < 8 || value.trim().length > 200 || /[\r\n\0]/.test(value)) {
    fail('FILE_IDEMPOTENCY_KEY_INVALID', 400, 'Idempotency-Key must be 8 to 200 safe characters')
  }
  return value.trim()
}

export function normalizeFileName(value) {
  if (typeof value !== 'string') fail('FILE_METADATA_INVALID', 400, 'File name is required')
  const name = basename(value.replaceAll('\\', '/')).normalize('NFC').trim()
  if (!name || name === '.' || name === '..' || name.length > 255 || /[\r\n\0]/.test(name)) {
    fail('FILE_METADATA_INVALID', 400, 'File name is invalid')
  }
  return name
}

export function normalizeContentType(value) {
  const contentType = typeof value === 'string' ? value.split(';', 1)[0].trim().toLowerCase() : ''
  if (!MIME.test(contentType)) fail('FILE_METADATA_INVALID', 400, 'Content-Type is invalid')
  return contentType
}

export function normalizeSha256(value) {
  if (typeof value !== 'string' || !SHA256.test(value)) fail('FILE_HASH_INVALID', 400, 'X-Content-SHA256 must be a SHA-256 hex digest')
  return value.toLowerCase()
}

export function normalizeProvenance(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !PROVENANCE_TYPES.has(value.kind)) {
    fail('FILE_PROVENANCE_INVALID', 400, 'File provenance kind is invalid')
  }
  const allowed = new Set(['kind', 'sourceId', 'sourceRevision', 'capturedAt', 'producer', 'channelBindingId', 'providerMessageId', 'attachmentOrdinal', 'contentProviderType'])
  if (Object.keys(value).some((key) => !allowed.has(key))) fail('FILE_PROVENANCE_INVALID', 400, 'File provenance has unsupported fields')
  const result = { kind: value.kind }
  for (const key of ['sourceId', 'sourceRevision', 'producer', 'channelBindingId', 'providerMessageId']) {
    if (value[key] !== undefined) {
      if (typeof value[key] !== 'string' || value[key].length > 300 || /[\r\n\0]/.test(value[key])) fail('FILE_PROVENANCE_INVALID', 400, `File provenance ${key} is invalid`)
      result[key] = value[key]
    }
  }
  if (value.capturedAt !== undefined) {
    const date = new Date(value.capturedAt)
    if (Number.isNaN(date.valueOf())) fail('FILE_PROVENANCE_INVALID', 400, 'File provenance capturedAt is invalid')
    result.capturedAt = date.toISOString()
  }
  if (value.attachmentOrdinal !== undefined) {
    if (!Number.isSafeInteger(value.attachmentOrdinal) || value.attachmentOrdinal < 0) fail('FILE_PROVENANCE_INVALID', 400, 'File provenance attachmentOrdinal is invalid')
    result.attachmentOrdinal = value.attachmentOrdinal
  }
  if (value.contentProviderType !== undefined) {
    if (!['line', 'external'].includes(value.contentProviderType)) fail('FILE_PROVENANCE_INVALID', 400, 'File provenance contentProviderType is unsupported')
    result.contentProviderType = value.contentProviderType
  }
  if (value.kind === 'LINE_CAPTURE') {
    if (![result.sourceId, result.channelBindingId, result.providerMessageId].every((field) => typeof field === 'string' && field.trim()) || !Number.isSafeInteger(result.attachmentOrdinal) || !result.contentProviderType) {
      fail('FILE_PROVENANCE_INVALID', 400, 'LINE_CAPTURE requires stable channel, message, attachment and content-provider identity')
    }
  } else if (['channelBindingId', 'providerMessageId', 'attachmentOrdinal', 'contentProviderType'].some((key) => value[key] !== undefined)) {
    fail('FILE_PROVENANCE_INVALID', 400, 'LINE capture metadata is only valid for LINE_CAPTURE provenance')
  }
  return result
}

export async function inspectUploadFile(path, expected) {
  const hash = createHash('sha256')
  let byteLength = 0
  for await (const chunk of createReadStream(path)) {
    byteLength += chunk.length
    hash.update(chunk)
  }
  const sha256 = hash.digest('hex')
  if (!byteLength) fail('FILE_EMPTY', 400, 'Empty files are not accepted')
  if (expected.byteLength !== byteLength || expected.sha256 !== sha256) {
    fail('FILE_CONTENT_MISMATCH', 409, 'Uploaded bytes do not match the declared size and SHA-256')
  }
  return { byteLength, sha256 }
}

export function requestDigest({ operationId, correlationId, operationType, tenantId, businessId, fileId, fileName, contentType, byteLength, sha256, provenance }) {
  return createHash('sha256').update(JSON.stringify({
    operationId,
    correlationId,
    operationType,
    tenantId,
    businessId,
    fileId: fileId || null,
    fileName,
    contentType,
    byteLength,
    sha256,
    provenance,
  })).digest('hex')
}

export function normalizeFileListOptions({ limit, cursor, query } = {}) {
  const pageSize = limit === undefined || limit === null || limit === '' ? 25 : Number(limit)
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) fail('FILE_PAGE_SIZE_INVALID', 400, 'File page size must be between 1 and 100')
  let parsedCursor = null
  if (cursor !== undefined && cursor !== null && cursor !== '') {
    if (typeof cursor !== 'string' || cursor.length > 512 || !/^[A-Za-z0-9_-]+$/.test(cursor)) fail('FILE_CURSOR_INVALID', 400, 'File list cursor is invalid')
    try {
      const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'))
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== 'id,updatedAt' || !UUID.test(value.id) || Number.isNaN(Date.parse(value.updatedAt))) throw new Error('invalid cursor')
      parsedCursor = { id: value.id.toLowerCase(), updatedAt: new Date(value.updatedAt).toISOString() }
    } catch {
      fail('FILE_CURSOR_INVALID', 400, 'File list cursor is invalid')
    }
  }
  const search = query === undefined || query === null || query === '' ? null : typeof query === 'string' ? query.trim() : null
  if (query !== undefined && query !== null && typeof query !== 'string') fail('FILE_SEARCH_INVALID', 400, 'File search query is invalid')
  if (search && (search.length > 200 || /[\r\n\0]/.test(search))) fail('FILE_SEARCH_INVALID', 400, 'File search query is invalid')
  return { limit: pageSize, cursor: parsedCursor, query: search || null }
}

export function isUuid(value) {
  return typeof value === 'string' && UUID.test(value)
}
