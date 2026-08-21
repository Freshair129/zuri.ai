import { NextResponse } from 'next/server'
import { LIVE_SESSION_COOKIE, LIVE_OWNER_PRINCIPAL_ID } from '@/modules/identity/session-port'

// @req FR-046 — login creates the trusted live owner session.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const response = NextResponse.redirect(new URL('/businesses', request.url), 303)
  response.cookies.set(LIVE_SESSION_COOKIE, LIVE_OWNER_PRINCIPAL_ID, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  })
  return response
}
