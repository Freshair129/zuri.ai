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
    return { username: form.get('username'), password: form.get('password') }
  } catch {
    return {}
  }
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
    response.cookies.set(AUTH_SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: SESSION_MAX_AGE_SECONDS,
    })
    return response
  } catch {
    return NextResponse.json({ success: false, error: 'AUTH_UNAVAILABLE' }, { status: 503 })
  }
}
