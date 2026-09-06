import { NextResponse } from 'next/server'
import { resetPassword } from '@/modules/identity/auth-service'

// @req FR-104 — the public consume leg: a handed-over token sets a new
//   PersonCredential, burns itself, and revokes every active session. One
//   generic failure for unknown/used/expired tokens — this route must never
//   help enumerate which guesses landed.
// @spec SDD-054, SEC-008, SEC-014
// @tested tests/unit/password-reset-routes.test.js

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const body = await request.json().catch(() => ({}))
  const result = await resetPassword({ token: body?.token, newPassword: body?.newPassword })
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 })
  }
  return NextResponse.json({ success: true })
}
