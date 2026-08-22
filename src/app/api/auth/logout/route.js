import { NextResponse } from 'next/server'
import { AUTH_SESSION_COOKIE } from '@/modules/identity/auth-service'

// @req FR-046 — logout invalidates the browser session cookie.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-auth-route.test.js

export async function POST() {
  const response = NextResponse.json({ success: true })
  response.cookies.set(AUTH_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  })
  return response
}
