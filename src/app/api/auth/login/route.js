import { NextResponse } from 'next/server'
import {
  AUTH_SESSION_COOKIE,
  authenticateUser,
  SESSION_MAX_AGE_SECONDS,
} from '@/modules/identity/auth-service'

// @req FR-046 — login accepts credentials and sets a signed, HttpOnly session.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-auth-route.test.js, tests/e2e/fr046-entry-contract.spec.js

async function readCredentials(request) {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('application/json')) {
    try {
      return await request.json()
    } catch {
      return {}
    }
  }

  try {
    const form = await request.formData()
    return { username: form.get('username'), password: form.get('password'), remember: form.get('remember') }
  } catch {
    return {}
  }
}

// An unchecked checkbox sends nothing at all, so absence is the "no" and only
// the affirmative values count. Read from both body shapes because this route
// accepts a JSON fetch and a plain form post, and a flag honoured in one but
// not the other is worse than a flag in neither.
function wantsPersistentSession(value) {
  return value === true || value === 'true' || value === 'on' || value === '1'
}

export async function POST(request) {
  const credentials = await readCredentials(request)
  try {
    const result = await authenticateUser({
      username: credentials?.username,
      password: credentials?.password,
    })
    if (!result.success) {
      return NextResponse.json(result, { status: 401 })
    }

    const response = NextResponse.json({
      success: true,
      user: result.user,
      redirect: '/businesses',
    })
    // AC-046-15 — "remember me" selects the COOKIE's lifetime and nothing else.
    // The signed token still carries the same `exp`, and auth-service rejects
    // anything whose `exp - iat` exceeds SESSION_MAX_AGE_SECONDS, so the ceiling
    // is unchanged and unchangeable from here. Opting out is therefore strictly
    // shorter-lived, never longer: the cookie dies with the browser session
    // while the token it held would have expired at the same moment either way.
    //
    // The flag deliberately does not enter the token payload. A claim inside the
    // token is something the server must then trust and verify; a cookie
    // `maxAge` is a client-side storage instruction that grants nothing, and
    // keeping it on that side of the boundary means a forged "remember" buys an
    // attacker exactly nothing.
    response.cookies.set(AUTH_SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      ...(wantsPersistentSession(credentials?.remember) ? { maxAge: SESSION_MAX_AGE_SECONDS } : {}),
    })
    return response
  } catch {
    return NextResponse.json({ success: false, error: 'AUTH_UNAVAILABLE' }, { status: 503 })
  }
}
