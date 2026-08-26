import { afterEach, describe, expect, it, vi } from 'vitest'

const auth = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
}))

vi.mock('@/modules/identity/auth-service', () => ({
  AUTH_SESSION_COOKIE: 'zuri_session',
  SESSION_MAX_AGE_SECONDS: 60 * 60 * 24 * 7,
  authenticateUser: auth.authenticateUser,
}))

import { POST as login } from '@/app/api/auth/login/route'
import { POST as logout } from '@/app/api/auth/logout/route'

// @req FR-046 — credential login creates a signed, server-owned session cookie.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-auth-route.test.js

const request = (body = {}) => new Request('http://localhost/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
})

describe('FR-046 credential auth routes', () => {
  afterEach(() => {
    auth.authenticateUser.mockReset()
    vi.unstubAllEnvs()
  })

  it('returns the authenticated account and sets an HttpOnly session cookie', async () => {
    auth.authenticateUser.mockResolvedValue({
      success: true,
      token: 'zuri_sess.signed-token',
      user: { id: 'person-1', code: 'PER-001', displayName: 'Owner' },
    })

    const response = await login(request({ username: 'owner@example.com', password: 'correct horse battery staple' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toEqual({
      success: true,
      user: { id: 'person-1', code: 'PER-001', displayName: 'Owner' },
      redirect: '/businesses',
    })
    expect(auth.authenticateUser).toHaveBeenCalledWith({
      username: 'owner@example.com',
      password: 'correct horse battery staple',
    })
    expect(response.headers.get('set-cookie')).toContain('zuri_session=zuri_sess.signed-token')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=lax/i)
    expect(response.headers.get('set-cookie')).toContain('Max-Age=604800')
  })

  it('returns a generic 401 and never sets a cookie for invalid credentials', async () => {
    auth.authenticateUser.mockResolvedValue({ success: false, error: 'INVALID_CREDENTIALS' })

    const response = await login(request({ username: 'owner@example.com', password: 'wrong' }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ success: false, error: 'INVALID_CREDENTIALS' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('clears the session cookie on logout and marks it Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const response = await logout(new Request('http://localhost/api/auth/logout', { method: 'POST' }))
    const cookie = response.headers.get('set-cookie')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ success: true })
    expect(cookie).toContain('zuri_session=')
    expect(cookie).toContain('Max-Age=0')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
  })
})
