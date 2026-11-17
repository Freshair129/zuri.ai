// @req FR-094, FR-095 — WebAuthn Passkey login verification endpoint
// @spec ADR-045 D2, D5, SDD-052, SEC-018, SEC-026
// @tested tests/integration/passkey-lifecycle.test.js, tests/integration/passkey-login-rate-limit.test.js

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { authUnavailableResponse, rateLimitResponse } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { finishPasskeyLogin } from '@/modules/identity/passkey-service'
import { consumePasskeyLoginRateLimits, isRateLimitError } from '@/modules/identity/rate-limit'
import {
  AUTH_SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  generateSessionToken,
  persistSession,
} from '@/modules/identity/auth-service'

export const dynamic = 'force-dynamic'

export async function POST(request, options = {}) {
  const body = await request.json().catch(() => ({}))
  const credential = body?.credential

  try {
    await consumePasskeyLoginRateLimits({
      identifier: typeof credential?.id === 'string' ? credential.id : undefined,
      headers: request.headers,
      db: options.db,
      now: options.now,
    })
  } catch (error) {
    if (isRateLimitError(error)) return rateLimitResponse('PASSKEY_LOGIN_RATE_LIMITED', error.retryAfterSeconds)
    return authUnavailableResponse()
  }

  try {
    // Authenticated or guest viewer at authentication boundary
    await (options.resolveViewer ?? resolveRequestViewer)(request).catch(() => null)

    const host = request.headers.get('host') || 'localhost'
    const rpId = host.split(':')[0]
    const origin = request.headers.get('origin') || `http://${host}`

    const { person } = await finishPasskeyLogin({
      credential,
      rpId,
      origin,
      db: options.db,
    })

    const sessionId = randomUUID()
    const token = generateSessionToken(person.id, { sessionId })

    await persistSession({
      token,
      sessionId,
      personId: person.id,
      assurance: 'WEBAUTHN',
      assuranceLevel: 'AAL2',
    })

    const response = NextResponse.json({
      success: true,
      user: {
        id: person.id,
        code: person.code,
        displayName: person.displayName,
        email: person.email,
      },
      assuranceLevel: 'AAL2',
    })

    response.cookies.set(AUTH_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    })

    return response
  } catch (err) {
    const message = err?.message || 'Passkey authentication failed'
    const status = err?.status || (/invalid|not found|expired|failed/i.test(message) ? 400 : 500)
    return NextResponse.json({ error: message }, { status })
  }
}
