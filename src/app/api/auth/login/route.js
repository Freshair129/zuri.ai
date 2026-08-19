import { NextResponse } from 'next/server'
import { authenticateUser, AUTH_SESSION_COOKIE } from '@/modules/identity/auth-service'

// @req FR-082 — Production Login Endpoint.
// @spec SEC-015, SDD-024
// @tested tests/unit/auth-api.test.js

export async function POST(request) {
  try {
    let body = {}
    const contentType = request.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      body = await request.json().catch(() => ({}))
    } else {
      const formData = await request.formData()
      body = {
        username: formData.get('username'),
        password: formData.get('password'),
      }
    }

    const { username, password } = body || {}
    const result = await authenticateUser({ username, password })

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'INVALID_CREDENTIALS' }, { status: 401 })
    }

    const response = NextResponse.json({
      success: true,
      user: result.person,
      redirect: '/businesses',
    })

    response.cookies.set(AUTH_SESSION_COOKIE, result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: false,
      path: '/',
      maxAge: 7 * 24 * 60 * 60,
    })

    return response
  } catch (error) {
    console.error('Login endpoint error:', error)
    const message = process.env.NODE_ENV !== 'production' ? error.message : 'INTERNAL_SERVER_ERROR'
    return NextResponse.json({ error: message || 'INTERNAL_SERVER_ERROR' }, { status: 500 })
  }
}
