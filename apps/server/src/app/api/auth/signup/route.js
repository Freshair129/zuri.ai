import { NextResponse } from 'next/server'
import {
  AUTH_SESSION_COOKIE,
  authenticateUser,
} from '@/modules/identity/auth-service'
import { createAccount } from '@/modules/identity/signup-service'
import { signupRateLimiter, signupSourceKey } from '@/modules/identity/signup-rate-limit'
import { ONBOARDING_STEP_PATHS } from '@/modules/identity/onboarding-steps'

// @req FR-120 — the public door: an unauthenticated visitor creates their own
//   Person and PersonCredential, and continues into FR-066 at its PROFILE step.
// @spec BR-002, SEC-008 — signup confers no authority: no PlatformGrant, no
//   Tenant/Business/Space/Project, no WorkspaceMembership.
// @tested tests/unit/fr120-signup-route.test.js, tests/e2e/fr120-signup.spec.js

async function readBody(request) {
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
    return {
      email: form.get('email'),
      displayName: form.get('displayName'),
      password: form.get('password'),
    }
  } catch {
    return {}
  }
}

export async function POST(request) {
  // Counted before anything is read or written, so a refused caller costs a Map
  // lookup rather than a password hash — scrypt is deliberately expensive, and
  // an unauthenticated endpoint that runs it before deciding whether to serve
  // the request has handed out its own CPU as the attack.
  const limit = signupRateLimiter.check(signupSourceKey(request.headers))
  if (!limit.allowed) {
    return NextResponse.json(
      { success: false, error: 'RATE_LIMITED' },
      { status: 429, headers: { 'retry-after': String(limit.retryAfterSeconds) } },
    )
  }

  const body = await readBody(request)
  const password = typeof body?.password === 'string' ? body.password : ''

  let person
  try {
    person = await createAccount({
      email: body?.email,
      displayName: body?.displayName,
      password,
    })
  } catch (error) {
    // Only the codes the service raises deliberately reach the caller. Anything
    // else is server state and says so — a 500 reported as a validation failure
    // sends someone editing a field that was never the problem.
    if (error?.status && error?.code) {
      return NextResponse.json({ success: false, error: error.code }, { status: error.status })
    }
    return NextResponse.json({ success: false, error: 'SIGNUP_UNAVAILABLE' }, { status: 503 })
  }

  // The session comes from FR-046's minting path, called rather than
  // reimplemented: one place issues sessions, so a change to how they are
  // signed, persisted or revoked cannot apply to one door and not the other.
  //
  // Signing in here rather than returning to /login is FR-120's decision: the
  // alternative sends a person to retype the password they chose seconds ago.
  let session
  try {
    session = await authenticateUser({ username: person.email, password })
  } catch {
    session = { success: false }
  }

  // The account exists either way — it was committed above — so a failure to
  // mint a session is reported as what it is rather than rolled back into
  // "signup failed". Telling someone their account was not created, when it
  // was, sends them to try again and meet EMAIL_TAKEN on their own address.
  if (!session?.success) {
    return NextResponse.json(
      { success: true, user: person, session: false, redirect: '/login' },
      { status: 201 },
    )
  }

  const response = NextResponse.json(
    {
      success: true,
      user: { id: person.id, code: person.code, displayName: person.displayName },
      session: true,
      redirect: ONBOARDING_STEP_PATHS.PROFILE,
    },
    { status: 201 },
  )
  // No `maxAge`: AC-046-15's default is a browser-session cookie, and signup
  // carries no "remember me" tick to opt into the seven days. The signed token
  // still expires at SESSION_MAX_AGE_SECONDS either way — this chooses only how
  // long the browser keeps it.
  response.cookies.set(AUTH_SESSION_COOKIE, session.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  return response
}
