import { NextResponse } from 'next/server'
import { AUTH_SESSION_COOKIE } from '@/modules/identity/auth-service'

// @req FR-082 — Production Logout Endpoint.
// @spec SEC-015, SDD-024
// @tested tests/unit/auth-api.test.js

export async function POST() {
  const response = NextResponse.json({ success: true, message: 'Logged out successfully' })
  response.cookies.set(AUTH_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
    expires: new Date(0),
  })
  return response
}
