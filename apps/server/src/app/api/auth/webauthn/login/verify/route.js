// @req FR-094, FR-095 — WebAuthn Passkey login verification endpoint
// @spec ADR-045 D2, D5, SDD-052, SEC-018
// @tested tests/integration/passkey-lifecycle.test.js

import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { finishPasskeyLogin } from '@/modules/identity/passkey-service'
import {
  AUTH_SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  generateSessionToken,
  persistSession,
} from '@/modules/identity/auth-service'
import { handleApiError } from '@/app/api/_helpers'

export const dynamic = 'force-dynamic'

export async function POST(request, options = {}) {
  try {
    // Authenticated or guest viewer at authentication boundary
    await (options.resolveViewer ?? resolveRequestViewer)(request).catch(() => null)

    const body = await request.json().catch(() => ({}))
    const { credential } = body

    const host = request.headers.get('host') || 'localhost'
    const rpId = host.split(':')[0]
    const origin = request.headers.get('origin') || `http://${host}`

    const { person } = await finishPasskeyLogin({
      credential,
      rpId,
      origin,
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
    return handleApiError(err)
  }
}
