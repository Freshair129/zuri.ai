import { afterEach, describe, expect, it, vi } from 'vitest'
import { POST } from '@/app/api/session/demo/route'
import { requireTrustedLocalDemo } from '@/modules/identity/session-port'

// @req FR-046 — the local demo session is an explicit, non-production capability.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-session-demo-route.test.js

const request = () => new Request('http://localhost/api/session/demo', { method: 'POST' })

describe('FR-046 local demo session route authorization', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('fails closed at the shared identity seam when production receives the demo capability', () => {
    expect(() => requireTrustedLocalDemo({ env: { NODE_ENV: 'production', ZURI_LOCAL_DEMO_AUTH: '1' } }))
      .toThrow('LOCAL_DEMO_NOT_ALLOWED')
  })

  it('denies the bootstrap in production even when the demo flag is set', async () => {
    vi.stubEnv('NODE_ENV', 'production')
    vi.stubEnv('ZURI_LOCAL_DEMO_AUTH', '1')

    const response = await POST(request())

    expect(response.status).toBe(404)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('denies the bootstrap when the explicit local capability is absent', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ZURI_LOCAL_DEMO_AUTH', '0')

    const response = await POST(request())

    expect(response.status).toBe(404)
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('issues the local-only httpOnly session cookie only when the capability is enabled', async () => {
    vi.stubEnv('NODE_ENV', 'development')
    vi.stubEnv('ZURI_LOCAL_DEMO_AUTH', '1')

    const response = await POST(request())

    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://localhost/businesses')
    expect(response.headers.get('set-cookie')).toContain('zuri_local_demo_session=enabled')
    expect(response.headers.get('set-cookie')).toContain('HttpOnly')
  })
})
