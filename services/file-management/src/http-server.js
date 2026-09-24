// @spec ADR-107 - bounded HTTP contract; operation intent precedes body streaming.
// @tested tests/http-server.test.js
import { createServer } from 'node:http'
import { createHash, randomUUID } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { asPublicError, FileManagementError } from './errors.js'
import { requireUuid, normalizeProvenance } from './validation.js'

const AUTHORIZATION = /^Bearer ([^\s]+)$/i

function requestBearer(request) {
  const match = AUTHORIZATION.exec(String(request.headers.authorization || ''))
  return match?.[1] || null
}

function json(response, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': String(body.length), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
  response.end(body)
}

function headerText(request, name, maxLength = 512) {
  const value = request.headers[name]
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\r\n\0]/.test(value)) {
    throw new FileManagementError('FILE_REQUEST_INVALID', 400, `${name} header is required`)
  }
  return value
}

function decodedFileName(request) {
  try { return decodeURIComponent(headerText(request, 'x-file-name', 1024)) } catch (error) {
    if (error instanceof FileManagementError) throw error
    throw new FileManagementError('FILE_METADATA_INVALID', 400, 'X-File-Name is not correctly encoded')
  }
}

function provenanceHeader(request) {
  const encoded = headerText(request, 'x-file-provenance', 8192)
  let value
  try { value = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) } catch {
    throw new FileManagementError('FILE_PROVENANCE_INVALID', 400, 'X-File-Provenance must be base64url JSON')
  }
  return normalizeProvenance(value)
}

async function receiveBody(request, { expectedSha256, expectedBytes, maxBytes, uploadTimeoutMs }) {
  const contentLength = Number(request.headers['content-length'])
  if (!Number.isSafeInteger(contentLength) || contentLength < 1) throw new FileManagementError('FILE_LENGTH_REQUIRED', 411, 'Content-Length is required')
  if (contentLength > maxBytes) throw new FileManagementError('FILE_TOO_LARGE', 413, 'File exceeds the configured upload limit')
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes !== contentLength) throw new FileManagementError('FILE_CONTENT_MISMATCH', 409, 'Declared byte length does not match Content-Length')

  const directory = await mkdtemp(join(tmpdir(), 'zuri-file-upload-'))
  const bodyPath = join(directory, 'content')
  const hash = createHash('sha256')
  let byteLength = 0
  const timeoutSignal = AbortSignal.timeout(uploadTimeoutMs)
  const meter = new Transform({
    transform(chunk, encoding, callback) {
      byteLength += chunk.length
      if (byteLength > maxBytes || byteLength > contentLength) {
        callback(new FileManagementError('FILE_TOO_LARGE', 413, 'File exceeds the declared upload size'))
        return
      }
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  try {
    await pipeline(request, meter, createWriteStream(bodyPath, { flags: 'wx', mode: 0o600 }), { signal: timeoutSignal })
    if (byteLength !== contentLength || hash.digest('hex') !== expectedSha256) throw new FileManagementError('FILE_CONTENT_MISMATCH', 409, 'Uploaded bytes do not match Content-Length or X-Content-SHA256')
    return { bodyPath, byteLength, directory }
  } catch (error) {
    await cleanupUpload(directory)
    if (timeoutSignal.aborted) throw new FileManagementError('FILE_UPLOAD_TIMEOUT', 408, 'Upload exceeded its time limit')
    throw error
  }
}

async function cleanupUpload(directory) {
  const resolvedRoot = resolve(tmpdir())
  const resolvedDirectory = resolve(directory)
  if (dirname(resolvedDirectory) !== resolvedRoot || !resolvedDirectory.startsWith(`${resolvedRoot}${process.platform === 'win32' ? '\\' : '/'}`) || !resolvedDirectory.split(/[\\/]/).at(-1).startsWith('zuri-file-upload-')) {
    throw new Error('temporary upload path failed ownership validation')
  }
  await rm(resolvedDirectory, { recursive: true, force: true })
}

function decodePath(pathname) {
  try { return pathname.split('/').map(decodeURIComponent).join('/') } catch {
    throw new FileManagementError('FILE_REQUEST_INVALID', 400, 'Request path is invalid')
  }
}

function requestScope(request) {
  return {
    tenantId: requireUuid(request.headers['x-tenant-id'], 'X-Tenant-Id'),
    businessId: requireUuid(request.headers['x-business-id'], 'X-Business-Id'),
  }
}

function requestOperation(request) {
  const operationId = requireUuid(headerText(request, 'x-operation-id', 36), 'X-Operation-Id')
  const correlationId = requireUuid(headerText(request, 'x-correlation-id', 36), 'X-Correlation-Id')
  const deadlineText = headerText(request, 'x-deadline', 64)
  const deadlineAt = new Date(deadlineText)
  const remainingMs = deadlineAt.valueOf() - Date.now()
  if (Number.isNaN(deadlineAt.valueOf()) || remainingMs <= 0 || remainingMs > 3600000) {
    throw new FileManagementError('FILE_DEADLINE_INVALID', 408, 'X-Deadline is expired or outside the allowed window')
  }
  return { operationId, correlationId, deadlineAt: deadlineAt.toISOString(), remainingMs }
}

function contentDisposition(fileName) {
  const fallback = fileName.replace(/[^\x20-\x7e]|["\\]/g, '_').slice(0, 120) || 'download'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
}

function publicVersion(version) {
  if (!version) return null
  const { storageProvider, storageBindingId, storageBucket, storageKey, ...safe } = version
  return safe
}

function publicFile(file) {
  return { ...file, currentVersion: publicVersion(file.currentVersion) }
}

export function createFileHttpServer({ service, maxUploadBytes = 512 * 1024 * 1024, maxConcurrentUploads = 1, uploadTimeoutMs = 600000, onError = () => {} } = {}) {
  if (!service) throw new TypeError('File HTTP server requires the file service')
  if (!Number.isInteger(maxConcurrentUploads) || maxConcurrentUploads < 1) throw new TypeError('maxConcurrentUploads must be a positive integer')
  if (!Number.isInteger(uploadTimeoutMs) || uploadTimeoutMs < 1 || uploadTimeoutMs > 3600000) throw new TypeError('uploadTimeoutMs must be between 1ms and 1 hour')
  let activeUploads = 0
  return createServer(async (request, response) => {
    let temporaryUpload = null
    let uploadSlot = false
    try {
      const url = new URL(request.url || '/', 'http://file-service.invalid')
      const path = decodePath(url.pathname)
      if (request.method === 'GET' && path === '/health/live') return json(response, 200, { status: 'live' })
      if (request.method === 'GET' && path === '/health/ready') {
        const result = await service.readiness()
        return json(response, result.ready ? 200 : 503, result)
      }

      const scope = requestScope(request)
      const bearerToken = requestBearer(request)
      const createMatch = request.method === 'POST' && path === '/v1/files'
      const appendMatch = request.method === 'POST' && /^\/v1\/files\/[0-9a-f-]+\/versions$/i.test(path)
      if (createMatch || appendMatch) {
        const fileId = appendMatch ? requireUuid(path.split('/')[3], 'fileId') : undefined
        const provenance = provenanceHeader(request)
        const grant = await service.authorize({ bearerToken, action: createMatch ? 'files:create' : 'files:write', provenance, ...scope })
        const operation = requestOperation(request)
        const sha256 = headerText(request, 'x-content-sha256', 64).toLowerCase()
        const byteLength = Number(headerText(request, 'x-content-length', 16))
        const contentType = headerText(request, 'content-type', 200)
        const fileName = decodedFileName(request)
        const idempotencyKey = headerText(request, 'idempotency-key', 200)
        const contentLength = Number(request.headers['content-length'])
        if (!Number.isSafeInteger(contentLength) || contentLength < 1) throw new FileManagementError('FILE_LENGTH_REQUIRED', 411, 'Content-Length is required')
        if (contentLength > maxUploadBytes) throw new FileManagementError('FILE_TOO_LARGE', 413, 'File exceeds the configured upload limit')
        if (!Number.isSafeInteger(byteLength) || byteLength !== contentLength) throw new FileManagementError('FILE_CONTENT_MISMATCH', 409, 'Declared byte length does not match Content-Length')
        if (activeUploads >= maxConcurrentUploads) {
          response.setHeader('connection', 'close')
          response.setHeader('retry-after', '1')
          return json(response, 429, { code: 'FILE_UPLOAD_CAPACITY', message: 'File upload capacity is temporarily full' })
        }
        activeUploads += 1
        uploadSlot = true
        const input = { grant, ...operation, fileName, contentType, sha256, byteLength, provenance, idempotencyKey }
        if (createMatch) await service.prepareCreateFile(input)
        else await service.prepareAppendVersion({ ...input, fileId })
        temporaryUpload = await receiveBody(request, { expectedSha256: sha256, expectedBytes: byteLength, maxBytes: maxUploadBytes, uploadTimeoutMs: Math.min(uploadTimeoutMs, operation.remainingMs) })
        const writeInput = { ...input, bodyPath: temporaryUpload.bodyPath }
        const result = createMatch ? await service.createFile(writeInput) : await service.appendVersion({ ...writeInput, fileId })
        return json(response, createMatch ? 201 : 200, result)
      }

      const fileMatch = /^\/v1\/files\/([0-9a-f-]+)$/i.exec(path)
      if (request.method === 'GET' && path === '/v1/files') {
        const grant = await service.authorize({ bearerToken, action: 'files:read', ...scope })
        const page = await service.listFiles({
          grant,
          limit: url.searchParams.get('limit') ?? undefined,
          cursor: url.searchParams.get('cursor') ?? undefined,
          query: url.searchParams.get('q') ?? undefined,
        })
        return json(response, 200, { files: page.files.map(publicFile), nextCursor: page.nextCursor })
      }
      if (request.method === 'GET' && fileMatch) {
        const grant = await service.authorize({ bearerToken, action: 'files:read', ...scope })
        const file = await service.getFile({ grant, fileId: fileMatch[1] })
        return json(response, 200, publicFile(file))
      }
      const historyMatch = /^\/v1\/files\/([0-9a-f-]+)\/versions$/i.exec(path)
      if (request.method === 'GET' && historyMatch) {
        const grant = await service.authorize({ bearerToken, action: 'files:read', ...scope })
        const versions = await service.listVersions({ grant, fileId: historyMatch[1] })
        return json(response, 200, { versions: versions.map(publicVersion) })
      }
      const contentMatch = /^\/v1\/files\/([0-9a-f-]+)\/versions\/([0-9a-f-]+)\/content$/i.exec(path)
      if (request.method === 'GET' && contentMatch) {
        const grant = await service.authorize({ bearerToken, action: 'files:read', ...scope })
        const result = await service.readVersion({ grant, fileId: contentMatch[1], versionId: contentMatch[2] })
        response.writeHead(200, {
          'content-type': result.version.contentType,
          'content-length': String(result.version.byteLength),
          'content-disposition': contentDisposition(result.version.fileName),
          'cache-control': 'private, no-store',
          'x-content-sha256': result.version.sha256,
          'x-content-version': result.version.id,
          'x-content-type-options': 'nosniff',
        })
        result.body.on('error', (error) => {
          onError({ code: error.code || 'FILE_STREAM_FAILED' })
          response.destroy()
        })
        result.body.pipe(response)
        return
      }
      json(response, 404, { code: 'FILE_ROUTE_NOT_FOUND', message: 'File route was not found' })
    } catch (error) {
      onError({ code: error?.code || 'FILE_SERVICE_ERROR' })
      if (!response.headersSent) {
        if (request.method === 'POST') response.setHeader('connection', 'close')
        const safe = asPublicError(error)
        json(response, safe.status, { code: safe.code, message: safe.message, ...(safe.details ? { details: safe.details } : {}) })
      } else {
        response.destroy()
      }
    } finally {
      if (uploadSlot) activeUploads -= 1
      if (temporaryUpload) {
        try { await cleanupUpload(temporaryUpload.directory) } catch (error) { onError({ code: 'FILE_TEMP_CLEANUP_FAILED' }) }
      }
    }
  })
}
