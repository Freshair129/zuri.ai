// @req FR-094, FR-095 — TOTP MFA factor verification and activation
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/integration/mfa-totp-lifecycle.test.js

import { handle, httpError } from '../../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { confirmTotpEnrollment } from '@/modules/identity/mfa-service'
import { elevateSession } from '@/modules/identity/session-assurance'
import { readRequestCookie } from '@/modules/identity/session-port'
import { AUTH_SESSION_COOKIE, hashSessionToken } from '@/modules/identity/auth-service'

export const dynamic = 'force-dynamic'

export async function POST(request, options = {}) {
  return handle(async () => {
    const viewer = options.viewer ?? await (options.resolveViewer ?? resolveRequestViewer)(request)
    const personId = viewer?.personId ?? viewer?.principal?.id
    if (!personId) throw httpError(401, 'AUTHENTICATION_REQUIRED')

    const body = await request.json().catch(() => ({}))
    const { factorId, code } = body
    if (!factorId || !code) {
      throw httpError(400, 'factorId and code are required')
    }

    const result = await confirmTotpEnrollment({ personId, factorId, code })

    // Elevate current session to AAL2 upon successful factor verification
    const cookie = readRequestCookie(request, AUTH_SESSION_COOKIE)
    const tokenHash = options.tokenHash ?? (cookie ? hashSessionToken(cookie) : options.session?.tokenHash)
    if (tokenHash) {
      await elevateSession({ tokenHash, reason: 'MFA_TOTP_ENROLLED' }).catch(() => {})
    }

    return {
      success: true,
      factorId: result.factorId,
      status: result.status,
      assuranceLevel: 'AAL2',
    }
  })
}
