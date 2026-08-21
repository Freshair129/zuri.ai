import { NextResponse } from 'next/server'
import { LOCAL_DEMO_COOKIE, LIVE_SESSION_COOKIE, LIVE_OWNER_PRINCIPAL_ID, requireTrustedLocalDemo } from '@/modules/identity/session-port'

// @req FR-046 — local demo entry is explicit and impossible in production.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-api-ui-contract.test.js, tests/e2e/fr046-entry-contract.spec.js

export async function POST(request) {
  try {
    requireTrustedLocalDemo()
  } catch {
    return NextResponse.json({ error: 'NOT_FOUND' }, { status: 404 })
  }

  const response = NextResponse.redirect(new URL('/businesses', request.url), 303)
  response.cookies.set(LOCAL_DEMO_COOKIE, 'enabled', {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    path: '/',
  })
  return response
}
