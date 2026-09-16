// @req FR-094, FR-095, FR-096 — Step-up authentication session elevation
// @spec ADR-045 D2, D4, SDD-052, SEC-018
// @tested tests/integration/mfa-totp-lifecycle.test.js

import { handle, httpError } from '../../_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { verifyMfaChallenge } from '@/modules/identity/mfa-service'
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
    const { code } = body
    if (!code) throw httpError(400, 'MFA code is required for step-up')

    const verification = await verifyMfaChallenge({ personId, code })
    if (!verification.verified) {
      throw httpError(401, 'INVALID_MFA_CHALLENGE: Code verification failed')
    }

    const cookie = readRequestCookie(request, AUTH_SESSION_COOKIE)
    const tokenHash = options.tokenHash ?? (cookie ? hashSessionToken(cookie) : options.session?.tokenHash)
    if (!tokenHash) {
      throw httpError(400, 'Active session token required for elevation')
    }

    const elevation = await elevateSession({
      tokenHash,
      ttlSeconds: body.ttlSeconds ?? 900,
      reason: 'STEP_UP_MFA_CHALLENGE',
    })

    return {
      elevated: true,
      assuranceLevel: elevation.assuranceLevel,
      elevatedUntil: elevation.elevatedUntil,
    }
  })
}
