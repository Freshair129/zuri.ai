import { httpError } from '@/app/api/_helpers'
import { resolveViewer } from './resolve-viewer'
import { createSessionPort } from './session-port'

// @req FR-046 — every protected request resolves one trusted viewer and fails closed.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-session-port.test.js

export async function resolveRequestViewer(
  request,
  { sessionPort = createSessionPort(), resolve = resolveViewer } = {}
) {
  let session
  try {
    session = await sessionPort.read(request)
  } catch {
    throw httpError(503, 'SESSION_UNAVAILABLE')
  }

  if (!session || session.state !== 'AUTHENTICATED') {
    throw httpError(401, 'AUTH_REQUIRED')
  }

  try {
    if (session.localDemo) {
      return await resolve({ platformGrant: false, allowDevelopmentFallback: true })
    }
    return await resolve({
      principalId: session.principalId,
      platformGrant: session.platformGrant === true,
      allowDevelopmentFallback: false,
    })
  } catch (error) {
    if (Number(error?.status)) throw error
    if (/principal (?:was not found|is required)/i.test(error?.message || '')) {
      throw httpError(401, 'AUTH_REQUIRED')
    }
    throw httpError(503, 'SESSION_UNAVAILABLE')
  }
}
