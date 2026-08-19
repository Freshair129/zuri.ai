import { NextResponse } from 'next/server'
import { resetPassword } from '@/modules/identity/auth-service'

// @req FR-082 — Reset Password Execution Endpoint.
// @spec SEC-015, SDD-024
// @tested tests/unit/auth-api.test.js

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}))
    const { token, newPassword } = body || {}

    if (!token || !newPassword) {
      return NextResponse.json({ error: 'TOKEN_AND_PASSWORD_REQUIRED' }, { status: 400 })
    }

    const result = await resetPassword({ token, newPassword })
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (error) {
    console.error('Reset password endpoint error:', error)
    return NextResponse.json({ error: 'INTERNAL_SERVER_ERROR' }, { status: 500 })
  }
}
