// @req FR-094, FR-095, FR-096, FR-297 — TOTP MFA factor verification and activation
// @spec ADR-045 D2, D4, D5, SDD-052, SEC-018
// @tested tests/integration/mfa-totp-lifecycle.test.js, tests/integration/auth-rate-limit.test.js

import { authUnavailableResponse, handle, httpError, rateLimitResponse } from '../../../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { confirmTotpEnrollment } from '@/modules/identity/mfa-service'
import { consumeTotpVerificationRateLimit, isRateLimitError } from '@/modules/identity/rate-limit'
import { elevateSession } from '@/modules/identity/session-assurance'
import { assertFactorEnrollmentAssurance, resolveSessionTokenHash } from '@/modules/identity/credential-write-gate'

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

    const tokenHash = resolveSessionTokenHash({ request, tokenHash: options.tokenHash, viewer })
    await assertFactorEnrollmentAssurance({
      personId,
      request,
      tokenHash,
    })

    try {
      await consumeTotpVerificationRateLimit({ personId })
    } catch (error) {
      if (isRateLimitError(error)) return rateLimitResponse('MFA_RATE_LIMITED', error.retryAfterSeconds)
      return authUnavailableResponse()
    }

    const result = await confirmTotpEnrollment({ personId, factorId, code })

    // Elevate current session to AAL2 upon successful factor verification
    if (tokenHash) {
      await elevateSession({ tokenHash, personId, reason: 'MFA_TOTP_ENROLLED' }).catch(() => {})
    }

    return {
      success: true,
      factorId: result.factorId,
      status: result.status,
      assuranceLevel: 'AAL2',
    }
  })
}
