import { NextResponse } from 'next/server'
import { LOCAL_DEMO_COOKIE, LIVE_SESSION_COOKIE, LIVE_OWNER_PRINCIPAL_ID } from '@/modules/identity/session-port'

// @req FR-046 — login creates a server-owned session; local demo capability is
// explicit and limited to non-production.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const response = NextResponse.redirect(new URL('/businesses', request.url), 303)
  const localDemo = process.env.NODE_ENV !== 'production' && process.env.ZURI_LOCAL_DEMO_AUTH === '1'
  if (localDemo) {
    response.cookies.set(LOCAL_DEMO_COOKIE, 'enabled', {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    })
  } else {
    response.cookies.set(LIVE_SESSION_COOKIE, LIVE_OWNER_PRINCIPAL_ID, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
    })
  }
  return response
}
