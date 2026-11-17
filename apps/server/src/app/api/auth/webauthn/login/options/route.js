// @req FR-094, FR-095 — WebAuthn Passkey login options endpoint
// @spec ADR-045 D2, D5, SDD-052, SEC-018, SEC-026
// @tested tests/integration/passkey-lifecycle.test.js, tests/integration/passkey-login-rate-limit.test.js

import { authUnavailableResponse, handle, rateLimitResponse } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { startPasskeyLogin } from '@/modules/identity/passkey-service'
import { consumePasskeyLoginRateLimits, isRateLimitError } from '@/modules/identity/rate-limit'

export const dynamic = 'force-dynamic'

export async function POST(request, options = {}) {
  const body = await request.json().catch(() => ({}))

  try {
    await consumePasskeyLoginRateLimits({
      identifier: typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined,
      headers: request.headers,
      db: options.db,
      now: options.now,
    })
  } catch (error) {
    if (isRateLimitError(error)) return rateLimitResponse('PASSKEY_LOGIN_RATE_LIMITED', error.retryAfterSeconds)
    return authUnavailableResponse()
  }

  return handle(async () => {
    // Authenticated or guest viewer at boundary
    await (options.resolveViewer ?? resolveRequestViewer)(request).catch(() => null)

    const host = request.headers.get('host') || 'localhost'
    const rpId = host.split(':')[0]

    const loginOptions = await startPasskeyLogin({ email: body.email, rpId, db: options.db })
    return { success: true, options: loginOptions }
  })
}
