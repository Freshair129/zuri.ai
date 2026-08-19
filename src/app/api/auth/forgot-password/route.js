import { NextResponse } from 'next/server'
import { createPasswordResetToken } from '@/modules/identity/auth-service'

// @req FR-082 — Forgot Password Request Endpoint.
// @spec SEC-015, SDD-024
// @tested tests/unit/auth-api.test.js

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const emailOrUsername = body?.email || body?.username || body?.emailOrUsername

    if (!emailOrUsername) {
      return NextResponse.json({ error: 'EMAIL_REQUIRED' }, { status: 400 })
    }

    const result = await createPasswordResetToken({ emailOrUsername })
    return NextResponse.json(result)
  } catch (error) {
    console.error('Forgot password endpoint error:', error)
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 })
  }
}
