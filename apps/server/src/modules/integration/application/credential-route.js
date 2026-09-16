import { handle } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createCredentialWriteGuard } from '@/modules/identity/credential-write-gate'

// @req FR-224 — the one request path every credential route takes: a bounded body
//   parsed without echoing it, a trusted viewer, the write gate composed as the
//   service's ports, and a response that is never cached.
// @req FR-223 — nothing a credential route returns may be stored by a browser or proxy.
// @spec ADR-089 D2, D4; SEC-030 (design §4.6 transport: ≤ 16 KiB, no-store)
// @tested tests/integration/line-channel-credential-routes.test.js

export const CREDENTIAL_BODY_LIMIT_BYTES = 16 * 1024

function refuse(status, code) {
  const error = new Error(code)
  error.status = status
  return error
}

async function readBody(request) {
  let text
  try {
    text = await request.text()
  } catch {
    throw refuse(400, 'CREDENTIAL_INPUT_INVALID')
  }
  if (Buffer.byteLength(text, 'utf8') > CREDENTIAL_BODY_LIMIT_BYTES) throw refuse(413, 'CREDENTIAL_INPUT_TOO_LARGE')
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
    const body = await readBody(request)
    const viewer = await resolveViewer(request)
    const ports = guard ?? createCredentialWriteGuard({ request })
    return work(body, { viewer, ports })
  })
  response.headers.set('Cache-Control', 'no-store')
  return response
}
