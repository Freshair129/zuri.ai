import { NextResponse } from 'next/server'
import { handle, httpError } from '@/app/api/_helpers'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'
import { createSessionPort } from '@/modules/identity/session-port'
import { assertApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { AUTH_SESSION_COOKIE, revokeAllSessions } from '@/modules/identity/auth-service'

// @req FR-046, FR-095 — logout-all revokes every active session for the authenticated Person.
// @spec ADR-124, SEC-018
// @tested tests/unit/fr046-logout-all-route.test.js, tests/integration/session-idle-multi-instance.test.js

export const dynamic = 'force-dynamic'

function clearCookie(response) {
  response.cookies.set(AUTH_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  })
}

export async function POST(request, options = {}) {
  return handle(async () => {
    const nowMs = typeof options.now === 'function' ? options.now() : options.now
    let sessionClock
    if (typeof options.now === 'function') sessionClock = options.now
    else if (options.now != null) sessionClock = () => options.now
    const sessionPort = (options.createSessionPort ?? createSessionPort)({
      db: options.db,
      env: options.env,
      now: sessionClock,
    })
    let session
    try {
      session = await sessionPort.read(request)
    } catch {
      throw httpError(503, 'SESSION_UNAVAILABLE')
    }
    if (!session || session.state !== 'AUTHENTICATED') {
      throw httpError(401, 'AUTHENTICATION_REQUIRED')
    }

    const viewer = await (options.resolveRequestViewer ?? resolveRequestViewer)(request, {
      sessionPort: { read: async () => session },
    })
    const assertCsrf = options.assertApiWriteCsrfToken ?? assertApiWriteCsrfToken
    assertCsrf({
      request,
      token: request.headers.get('x-csrf-token'),
      session,
      env: options.env,
      now: nowMs,
    })

    let revoked
    try {
      revoked = await (options.revokeAllSessions ?? revokeAllSessions)(viewer.principal.id, {
        db: options.db,
        env: options.env,
        now: nowMs,
        reason: 'LOGOUT_ALL',
      })
    } catch {
      throw httpError(503, 'SESSION_UNAVAILABLE')
    }

    const response = NextResponse.json({ revoked })
    clearCookie(response)
    return response
  })
}
