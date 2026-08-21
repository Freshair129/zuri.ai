import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/session/login/route'
import { LOCAL_DEMO_COOKIE, LIVE_SESSION_COOKIE } from '@/modules/identity/session-port'

// @req FR-046 — the owner entry creates a server-owned session cookie.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-session-demo-route.test.js

const request = () => new Request('http://localhost/api/session/login', { method: 'POST' })

describe('FR-046 owner session route', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('redirects to Business Routing and issues an HttpOnly session cookie', async () => {
    const response = await POST(request())

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/businesses')
    expect(response.headers.get('set-cookie')).toContain(`${LIVE_SESSION_COOKIE}=`)
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
    expect(response.headers.get('set-cookie')).toMatch(/SameSite=lax/i)
  })

  it('marks the session cookie Secure in production', async () => {
    vi.stubEnv('NODE_ENV', 'production')

    const response = await POST(request())

    expect(response.headers.get('set-cookie')).toContain('Secure')
  })

  it('uses the local-demo session only when the explicit non-production capability is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ZURI_LOCAL_DEMO_AUTH', '1')

    const response = await POST(request())
    const cookie = response.headers.get('set-cookie')

    expect(cookie).toContain(`${LOCAL_DEMO_COOKIE}=enabled`)
    expect(cookie).not.toContain(`${LIVE_SESSION_COOKIE}=`)
  })
})
