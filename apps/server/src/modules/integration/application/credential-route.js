import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createCredentialWriteGuard } from '@/modules/identity/credential-write-gate'

// @req FR-224 — the one request path every credential route takes: a bounded body
//   parsed without echoing it, a trusted viewer, the write gate composed as the
//   service's ports, and a response that is never cached.
// @req FR-223 — nothing a credential route returns may be stored by a browser or proxy.
// @spec ADR-089 D2, D4; SEC-030 (design §4.6 transport: ≤ 16 KiB, no-store)
// @tested tests/integration/line-channel-credential-routes.test.js, tests/unit/integration/credential-route-body-cap.test.js

export const CREDENTIAL_BODY_LIMIT_BYTES = 16 * 1024

function refuse(status, code) {
  const error = new Error(code)
  error.status = status
  return error
}

function cancelRequestBody(request) {
  try {
    const cancellation = request.body?.cancel()
    cancellation?.catch?.(() => {})
  } catch {
    // A body may already be locked or consumed; cancellation is best effort.
  }
}

function cancelReader(reader) {
  try {
    const cancellation = reader.cancel()
    cancellation?.catch?.(() => {})
  } catch {
    // The stream may already be errored or closed.
  }
}

export async function readBoundedRequestText(request, limitBytes = CREDENTIAL_BODY_LIMIT_BYTES) {
  const contentLength = request.headers?.get?.('content-length')
  if (/^\d+$/.test(contentLength ?? '') && BigInt(contentLength) > BigInt(limitBytes)) {
    throw refuse(413, 'CREDENTIAL_INPUT_TOO_LARGE')
  }
  if (!request.body) return ''

  let reader
  try {
    reader = request.body.getReader()
  } catch {
    throw refuse(400, 'CREDENTIAL_INPUT_INVALID')
  }

  const bytes = new Uint8Array(limitBytes)
  let totalBytes = 0
  try {
    while (true) {
      let result
      try {
        result = await reader.read()
      } catch {
        cancelReader(reader)
        throw refuse(400, 'CREDENTIAL_INPUT_INVALID')
      }
      if (result.done) break

      const chunk = result.value
      if (!(chunk instanceof Uint8Array)) {
        cancelReader(reader)
        throw refuse(400, 'CREDENTIAL_INPUT_INVALID')
      }
      if (totalBytes + chunk.byteLength > limitBytes) {
        cancelReader(reader)
        throw refuse(413, 'CREDENTIAL_INPUT_TOO_LARGE')
      }

      bytes.set(chunk, totalBytes)
      totalBytes += chunk.byteLength
    }
  } finally {
    reader.releaseLock()
  }

  let text
  try {
    text = new TextDecoder('utf-8').decode(bytes.subarray(0, totalBytes))
  } catch {
    throw refuse(400, 'CREDENTIAL_INPUT_INVALID')
  }
  return text
}

async function readBody(request) {
  const text = await readBoundedRequestText(request, CREDENTIAL_BODY_LIMIT_BYTES)
  if (text.trim() === '') return {}
  try {
    return JSON.parse(text)
  } catch {
    throw refuse(400, 'CREDENTIAL_INPUT_INVALID')
  }
}

/**
 * @param {Request} request
 * @param {(body, ctx: {viewer, ports}) => Promise<object>} work
 * @param {object} [options] test seams: resolveViewer, guard
 */
export async function handleCredentialRequest(request, work, { resolveViewer = resolveRequestViewer, guard = null } = {}) {
  const response = await handle(async () => {
    try {
      const viewer = await resolveViewer(request)
      const body = await readBody(request)
      const ports = guard ?? createCredentialWriteGuard({ request })
      return await work(body, { viewer, ports })
    } catch (error) {
      cancelRequestBody(request)
      throw error
    }
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
