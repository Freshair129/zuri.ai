// @req FR-293 — operator-only transfer endpoints enforce CSRF before bounded input.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-transfer.test.js
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createSessionPort } from '@/modules/identity/session-port'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { assertApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { readRecoveryJSON } from './managed-blob-recovery-contract'
import { createManagedBlobBackupTransferService } from './managed-blob-transfer-service'
import { createManagedBlobTransferTestAdmissionFromEnvironment } from './managed-blob-transfer-test-admission'
import { MANAGED_BLOB_TRANSFER_CODEC_PROFILE } from './managed-blob-transfer-profile'

const JSON_MAX_BYTES = 64 * 1024
const binding = z.string().regex(/^[A-Za-z0-9_-]{43}$/).refine(value => {
  const bytes = Buffer.from(value, 'base64url')
  return bytes.length === 32 && bytes.toString('base64url') === value
})
const positive = z.number().int().positive().safe()
const exportRequest = z.object({ format: z.literal('compact-managed-blob-backup.v1'),
  includeBinaryContent: z.boolean(), expectedGeneration: positive }).strict()
const restoreMount = z.object({ businessId: z.string().uuid(), deviceKey: z.string().min(1).max(255),
  rootPath: z.string().min(1).max(4096) }).strict()
const confirmRequest = z.object({ confirmationBinding: binding.optional(), expectedJobVersion: positive,
  remounts: z.array(restoreMount).max(128).optional() }).strict()
const inspectRequest = z.object({}).strict()
const abandonRequest = z.object({ expectedJobVersion: positive }).strict()
const transferError = (status, code) => Object.assign(new Error('Backup transfer request refused'), { status, code })
const respond = (body, status = 200, headers = {}) => Response.json(body, {
  status, headers: { 'Cache-Control': 'no-store', ...headers },
})
const errorCodes = new Set(['AUTH_REQUIRED', 'CSRF_INVALID', 'SESSION_UNAVAILABLE'])

function safeError(error) {
  const status = [400, 401, 403, 404, 409, 410, 413, 429, 503].includes(error?.status) ? error.status : 503
  const code = errorCodes.has(error?.code) ? error.code
    : /^MANAGED_BLOB_TRANSFER_[A-Z_]+$/.test(error?.code || '') ? error.code
      : status === 400 ? 'MANAGED_BLOB_TRANSFER_INVALID'
        : status === 413 ? 'MANAGED_BLOB_TRANSFER_TOO_LARGE'
          : status === 401 ? 'AUTH_REQUIRED' : status === 403 ? 'CSRF_INVALID'
            : 'MANAGED_BLOB_TRANSFER_UNAVAILABLE'
  const requestId = randomUUID()
  return respond({ code, message: 'Backup transfer request refused.', requestId, retryable: false }, status,
    { 'X-Request-ID': requestId })
}

function contentLength(request, maxBytes, { required = false } = {}) {
  const value = request.headers.get('content-length')
  if (value == null) {
    if (required) throw transferError(400, 'MANAGED_BLOB_TRANSFER_INVALID')
    return null
  }
  if (!/^\d+$/.test(value)) throw transferError(400, 'MANAGED_BLOB_TRANSFER_INVALID')
  const length = Number(value)
  if (!Number.isSafeInteger(length) || length > maxBytes) throw transferError(413, 'MANAGED_BLOB_TRANSFER_TOO_LARGE')
  if (length <= 0) throw transferError(400, 'MANAGED_BLOB_TRANSFER_INVALID')
  return length
}

function requireContentType(request, expected) {
  if (request.headers.get('content-encoding')
    || request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== expected) {
    throw transferError(400, 'MANAGED_BLOB_TRANSFER_INVALID')
  }
}

async function readJson(request, schema) {
  requireContentType(request, 'application/json')
  const declared = contentLength(request, JSON_MAX_BYTES)
  const reader = request.body?.getReader()
  if (!reader) throw transferError(400, 'MANAGED_BLOB_TRANSFER_INVALID')
  const chunks = []
  let size = 0, done = false
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) { done = true; break }
      if (!(next.value instanceof Uint8Array) || next.value.byteLength > JSON_MAX_BYTES - size) {
        throw transferError(413, 'MANAGED_BLOB_TRANSFER_TOO_LARGE')
      }
      chunks.push(Buffer.from(next.value)); size += next.value.byteLength
    }
  } finally {
    if (!done) reader.cancel().catch(() => {})
    try { reader.releaseLock() } catch {}
  }
  if (declared !== null && size !== declared) throw transferError(400, 'MANAGED_BLOB_TRANSFER_INVALID')
  let value
  try { value = readRecoveryJSON(Buffer.concat(chunks), JSON_MAX_BYTES) } catch (error) {
    throw transferError(error?.status === 413 ? 413 : 400,
      error?.status === 413 ? 'MANAGED_BLOB_TRANSFER_TOO_LARGE' : 'MANAGED_BLOB_TRANSFER_INVALID')
  }
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw transferError(400, 'MANAGED_BLOB_TRANSFER_INVALID')
  return parsed.data
}

async function* requestChunks(request) {
  const reader = request.body?.getReader()
  if (!reader) throw transferError(400, 'MANAGED_BLOB_TRANSFER_INVALID')
  let done = false
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) { done = true; return }
      if (!(next.value instanceof Uint8Array)) throw transferError(400, 'MANAGED_BLOB_TRANSFER_INVALID')
      yield Buffer.from(next.value)
    }
  } finally {
    if (!done) reader.cancel().catch(() => {})
    try { reader.releaseLock() } catch {}
  }
}

let runtimeService, runtimeKey, runtimeDb, runtimeStorageFactory
function defaultService(db, env, storageFactory) {
  const key = [env.ZURI_MANAGED_BLOB_TRANSFER_DATA_DIRECTORY, env.ZURI_BUILD_REVISION,
    env.GITHUB_SHA, env.VERCEL_GIT_COMMIT_SHA, env.ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_FILE,
    env.ZURI_MANAGED_BLOB_TRANSFER_TEST_ADMISSION_PUBLIC_KEY_FILE].join('\0')
  if (!runtimeService || runtimeKey !== key || runtimeDb !== db || runtimeStorageFactory !== storageFactory) {
    runtimeService = createManagedBlobBackupTransferRuntimeService({ db, env,
      ...(storageFactory ? { storageFactory } : {}) })
    runtimeKey = key; runtimeDb = db; runtimeStorageFactory = storageFactory
  }
  return runtimeService
}

export function createManagedBlobBackupTransferRuntimeService({ db, env = process.env, dataDirectory,
  storageFactory, sourceRevision } = {}) {
  return createManagedBlobBackupTransferService({ db, env,
    dataDirectory: dataDirectory ?? env.ZURI_MANAGED_BLOB_TRANSFER_DATA_DIRECTORY,
    ...(storageFactory ? { storageFactory } : {}), ...(sourceRevision ? { sourceRevision } : {}),
    testAdmission: createManagedBlobTransferTestAdmissionFromEnvironment(env),
  })
}

export function createManagedBlobBackupTransferHttpHandler({ db, env = process.env, service: injectedService,
  storageFactory } = {}) {
  const sessionPort = createSessionPort({ ...(db ? { db } : {}), env })
  return async function handleManagedBlobBackupTransfer(request, { action, jobId,
    requestViewerResolver = resolveRequestViewer } = {}) {
    try {
      if (!['export', 'preview', 'current', 'status', 'package', 'confirm', 'inspect', 'abandon'].includes(action)) {
        throw transferError(404, 'MANAGED_BLOB_TRANSFER_NOT_FOUND')
      }
      const expectedMethod = ['current', 'status', 'package'].includes(action) ? 'GET' : 'POST'
      if (request.method !== expectedMethod) throw transferError(404, 'MANAGED_BLOB_TRANSFER_NOT_FOUND')

      let session
      try { session = await sessionPort.read(request) } catch { throw transferError(503, 'SESSION_UNAVAILABLE') }
      if (session?.state !== 'AUTHENTICATED' || !session.sessionId || session.sessionId.startsWith('legacy-')) {
        throw transferError(401, 'AUTH_REQUIRED')
      }
      if (expectedMethod === 'POST') assertApiWriteCsrfToken({ request,
        token: request.headers.get('X-Zuri-API-Write-CSRF'), session, env })
      let viewer
      try {
        viewer = await requestViewerResolver(request, { sessionPort: { read: async () => session },
          resolve: input => resolveViewer({ ...input, ...(db ? { db } : {}) }) })
      } catch (error) { throw transferError(error?.status === 401 ? 401 : 503, error?.status === 401 ? 'AUTH_REQUIRED' : 'SESSION_UNAVAILABLE') }
      if (viewer?.principal?.id !== session.principalId) throw transferError(401, 'AUTH_REQUIRED')

      const service = injectedService || defaultService(db, env, storageFactory)
      const common = { request, viewer, session }
      if (action === 'export') {
        const input = await readJson(request, exportRequest)
        const job = await service.exportPackage({ ...common, includeBinaryContent: input.includeBinaryContent,
          expectedGeneration: input.expectedGeneration })
        return respond({ job }, 202)
      }
      if (action === 'preview') {
        requireContentType(request, 'application/x-tar')
        const declared = contentLength(request, MANAGED_BLOB_TRANSFER_CODEC_PROFILE.maxPackageBytes)
        const job = await service.previewPackage({ ...common, chunks: requestChunks(request),
          contentLength: declared, signal: request.signal })
        return respond({ job }, 200)
      }
      if (action === 'current') return respond({ jobs: await service.current(common) })
      if (typeof jobId !== 'string') throw transferError(404, 'MANAGED_BLOB_TRANSFER_NOT_FOUND')
      if (action === 'status') return respond({ job: await service.status({ ...common, jobId }) })
      if (action === 'package') {
        const value = await service.packageBytes({ ...common, jobId })
        return new Response(value.bytes, { status: 200, headers: {
          'Cache-Control': 'no-store', 'Content-Type': 'application/x-tar',
          'Content-Disposition': `attachment; filename="zuri-managed-blob-backup-${jobId}.tar"`,
          'Content-Length': String(value.bytes.byteLength), 'Digest': `sha-256=${Buffer.from(value.job.packageSha256, 'hex').toString('base64')}`,
          'X-Content-Type-Options': 'nosniff',
        } })
      }
      if (action === 'confirm') {
        const input = await readJson(request, confirmRequest)
        const started = await service.startConfirm({ ...common, jobId, input })
        return respond({ job: started.job }, 202)
      }
      if (action === 'inspect') {
        await readJson(request, inspectRequest)
        return respond({ job: await service.inspect({ ...common, jobId }) })
      }
      const input = await readJson(request, abandonRequest)
      return respond({ job: await service.abandon({ ...common, jobId, expectedJobVersion: input.expectedJobVersion }) })
    } catch (error) {
      return safeError(error)
    } finally {
      if (request.body && !request.bodyUsed) request.body.cancel().catch(() => {})
    }
  }
}

export const handleManagedBlobBackupTransfer = createManagedBlobBackupTransferHttpHandler()
