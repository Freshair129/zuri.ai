import { NextResponse } from 'next/server'
import { AUTH_SESSION_COOKIE, revokeSessionToken } from '@/modules/identity/auth-service'

// @req FR-046, FR-095 — logout revokes the live session and clears its browser transport.
// @spec ADR-017, ADR-045 D2, SDD-024, SDD-052, SEC-008, SEC-018
// @tested tests/unit/fr046-auth-route.test.js, tests/unit/iam-session.test.js

function readCookie(request) {
  if (request?.cookies?.get) {
    const cookie = request.cookies.get(AUTH_SESSION_COOKIE)
    if (typeof cookie === 'string') return cookie
    if (cookie?.value) return cookie.value
  }
  const header = request?.headers?.get?.('cookie') || ''
  for (const part of header.split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key === AUTH_SESSION_COOKIE) return decodeURIComponent(value.join('='))
  }
  return null
}

function clearCookie(response) {
  response.cookies.set(AUTH_SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  })
}

export async function POST(request) {
  const token = readCookie(request)
  try {
    if (token) await revokeSessionToken(token)
  } catch {
    const response = NextResponse.json({ success: false, error: 'AUTH_UNAVAILABLE' }, { status: 503 })
    clearCookie(response)
    return response
  }

  const response = NextResponse.json({ success: true })
  clearCookie(response)
  return response
}
