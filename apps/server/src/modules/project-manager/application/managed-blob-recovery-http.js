// @req FR-292, FR-293 — private bounded operator request workflow, activation held.
// @spec ADR-115, SEC-008
// @tested tests/integration/managed-blob-recovery-http.test.js
import { randomUUID } from 'node:crypto'
import { setImmediate as yieldLoop } from 'node:timers/promises'
import { createSessionPort } from '@/modules/identity/session-port'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { assertApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { parseRecoveryDescriptor, parseRecoveryRequest, readRecoveryJSON, recoveryError,
  RECOVERY_DESCRIPTOR_MAX_BYTES, RECOVERY_CONTENT_MAX_BYTES } from './managed-blob-recovery-contract'

// Same bound as OR2's preview worker lease, never an extension of that lease.
export const RECOVERY_REQUEST_DEADLINE_MS = 30_000
const actions = new Set(['prepare', 'preview', 'stage', 'confirm', 'status', 'inspect', 'abandon'])
const errors = { 400: 'MANAGED_BLOB_RECOVERY_INVALID', 401: 'AUTH_REQUIRED', 403: 'CSRF_INVALID',
  404: 'MANAGED_BLOB_RECOVERY_NOT_FOUND', 409: 'MANAGED_BLOB_RECOVERY_CONFLICT',
  410: 'MANAGED_BLOB_RECOVERY_EXPIRED', 413: 'MANAGED_BLOB_RECOVERY_TOO_LARGE',
  429: 'MANAGED_BLOB_RECOVERY_CAPACITY', 503: 'MANAGED_BLOB_RECOVERY_UNAVAILABLE' }
const respond = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

// Own the reader AND the deadline: a stalled read or endless empty chunks must
// not extend custody. Cancellation never waits on an uncooperative producer.
function boundedBody(request, maxBytes) {
  if (request.headers.get('content-encoding')) throw recoveryError()
  const length = request.headers.get('content-length')
  if (length != null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) throw recoveryError(413)
  if (!request.body) throw recoveryError()
  const reader = request.body.getReader(), controller = new AbortController()
  let timer, rejectDeadline, size = 0, count = 0, closed = false
  const expired = new Promise((resolve, reject) => { rejectDeadline = reject })
  // A rejection is also observed if abort happens between read calls.
  expired.catch(() => {})
  const abort = () => { controller.abort(); rejectDeadline(recoveryError(410)) }
  timer = setTimeout(abort, RECOVERY_REQUEST_DEADLINE_MS)
  request.signal.addEventListener('abort', abort, { once: true })
  if (request.signal.aborted) abort()
  return {
    signal: controller.signal,
    async next() {
      if (controller.signal.aborted) throw recoveryError(410)
      // Yield even when hostile streams synchronously return empty chunks.
      if (++count % 64 === 0) await Promise.race([yieldLoop(), expired])
      const next = await Promise.race([reader.read(), expired])
      if (next.done) { closed = true; return null }
      if (!(next.value instanceof Uint8Array)) throw recoveryError()
      size += next.value.byteLength
      if (size > maxBytes) throw recoveryError(413)
      return Buffer.from(next.value)
    },
    close() {
      clearTimeout(timer); request.signal.removeEventListener('abort', abort)
      if (!closed) reader.cancel().catch(() => {})
      else reader.releaseLock()
    },
  }
}
async function jsonBody(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') throw recoveryError()
  const body = boundedBody(request, RECOVERY_DESCRIPTOR_MAX_BYTES)
  try {
    const chunks = []
    for (;;) { const next = await body.next(); if (next === null) break; chunks.push(next) }
    return readRecoveryJSON(Buffer.concat(chunks))
  } finally { body.close() }
}

// One descriptor then one original. No general multipart/archive extractor,
// filenames, paths or uploaded refs become routing inputs. Parsing stays lazy:
// OR2 reserves the expected spool bytes before the first reader.read().
async function* multipartContent(request, expected) {
  const match = /^multipart\/form-data;\s*boundary=(?:"([A-Za-z0-9'()+_,.\/:=? -]{1,70})"|([A-Za-z0-9'()+_,.\/:=?-]{1,70}))$/i.exec(request.headers.get('content-type') || '')
  if (!match) throw recoveryError()
  const boundary = match[1] || match[2]
  const body = boundedBody(request, RECOVERY_CONTENT_MAX_BYTES + RECOVERY_DESCRIPTOR_MAX_BYTES + 8192)
  let buffer = Buffer.alloc(0), eof = false
  async function more() {
    const next = await body.next()
    if (next === null) eof = true
    else buffer = Buffer.concat([buffer, next])
  }
  async function takeUntil(separator, limit) {
    for (;;) {
      const index = buffer.indexOf(separator)
      if (index >= 0) {
        if (index > limit) throw recoveryError(413)
        const value = buffer.subarray(0, index); buffer = buffer.subarray(index + separator.length); return value
      }
      if (buffer.length > limit + separator.length) throw recoveryError(413)
      if (eof) throw recoveryError()
      await more()
    }
  }
  const separator = Buffer.from('\r\n--' + boundary)
  try {
    const start = await takeUntil(Buffer.from('\r\n'), 74)
    if (start.toString() !== '--' + boundary) throw recoveryError()
    const descriptorHeaders = (await takeUntil(Buffer.from('\r\n\r\n'), 4096)).toString('utf8')
    if (descriptorHeaders.toLowerCase() !== 'content-disposition: form-data; name="descriptor"') throw recoveryError()
    const descriptor = parseRecoveryDescriptor(await takeUntil(separator, RECOVERY_DESCRIPTOR_MAX_BYTES))
    if (Object.keys(expected).some(key => descriptor[key] !== expected[key])) throw recoveryError(409)
    const prefix = await takeUntil(Buffer.from('\r\n'), 2)
    if (prefix.length) throw recoveryError()
    const headers = (await takeUntil(Buffer.from('\r\n\r\n'), 4096)).toString('utf8').split('\r\n')
    if (!/^content-disposition: form-data; name="content"; filename="[^"\r\n]{0,255}"$/i.test(headers[0])
      || headers.length > 2 || headers[1] && !/^content-type: [a-z0-9!#$&^_.+/-]+$/i.test(headers[1])) throw recoveryError()
    for (;;) {
      const index = buffer.indexOf(separator)
      if (index >= 0) {
        if (index) yield buffer.subarray(0, index)
        buffer = buffer.subarray(index + separator.length)
        // Read only a bounded closing delimiter; any third part is invalid.
        while (!eof) { if (buffer.length > 4) throw recoveryError(); await more() }
        if (!buffer.equals(Buffer.from('--\r\n')) && !buffer.equals(Buffer.from('--'))) throw recoveryError()
        return
      }
      if (eof) throw recoveryError()
      const available = buffer.length - separator.length
      if (available > 0) { yield buffer.subarray(0, available); buffer = buffer.subarray(available) }
      await more()
    }
  } finally { body.close() }
}

// No environment/caller TEST flag enables this. The ordinary composition has
// no service until FR-293's supported transfer round trip is qualified. Tests
// may compose the same request handler with real isolated custody explicitly;
// that is transport evidence, never release or restore admission.
export function createRecoveryHttpHandler({ db, env = process.env, service } = {}) {
  const sessionPort = createSessionPort({ ...(db ? { db } : {}), env })
  return async (request, { fileId, operationId, action }) => {
    try {
      const session = await sessionPort.read(request)
      if (session?.state !== 'AUTHENTICATED' || !session.sessionId || session.sessionId.startsWith('legacy-')) throw recoveryError(401)
      if (request.method !== (action === 'status' ? 'GET' : 'POST') || !actions.has(action)) throw recoveryError(404)
      if (request.method === 'POST') assertApiWriteCsrfToken({ request,
        token: request.headers.get('X-Zuri-API-Write-CSRF'), session, env })
      let viewer
      try {
        viewer = await resolveRequestViewer(request, { sessionPort: { read: async () => session },
          resolve: input => resolveViewer({ ...input, ...(db ? { db } : {}) }) })
      } catch (error) { throw recoveryError(error?.status === 401 ? 401 : 503) }
      if (viewer?.principal?.id !== session.principalId) throw recoveryError(401)
      if (!service) return respond({ code: 'MANAGED_BLOB_RECOVERY_NOT_QUALIFIED',
        message: 'Recovery is unavailable pending backup transfer qualification.', requestId: randomUUID(), retryable: false }, 503)
      const args = { request, fileId, ...(operationId ? { operationId } : {}) }
      if (action === 'status') return respond(await service.status(args))
      const { descriptor } = await service.authorize(args)
      // The trusted Viewer is a denial-only request boundary; platform grants
      // can never replace the persisted OWNER witness in either OR2 fence.
      if (!ownsBusiness(viewer, descriptor.businessId)) throw recoveryError(404)
      let value
      if (action === 'preview') value = await service.preview({ ...args, descriptor: JSON.stringify(descriptor),
        chunks: multipartContent(request, descriptor), signal: request.signal })
      else {
        const input = parseRecoveryRequest(action, await jsonBody(request))
        value = await service[action]({ ...args, input })
      }
      return respond(value, ['STAGING', 'UNKNOWN'].includes(value.state) ? 202 : 200)
    } catch (error) {
      const status = error?.message === 'Recovery request refused' || error?.name === 'ApiWriteCsrfError'
        ? (Object.hasOwn(errors, error.status) ? error.status : 503) : 503
      return respond({ code: errors[status], message: 'Recovery request refused.', requestId: randomUUID(), retryable: false }, status)
    } finally {
      // Refusal cancels the transport without acquiring a reader or accepting
      // application bytes. Do not await a hostile producer's cancel callback.
      if (request.body && !request.bodyUsed) request.body.cancel().catch(() => {})
    }
  }
}
// Thin routes name the delegated identity boundary explicitly. This function
// really resolves the trusted Viewer above; no preflight exemption is needed.
export const resolveRequestViewerAndHandleRecovery = createRecoveryHttpHandler()
