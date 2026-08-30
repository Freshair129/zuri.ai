import { beforeEach, describe, expect, it, vi } from 'vitest'

// @req FR-123 — the four plugin auth route handlers: what they read off the
// request, what they hand the service, and what they refuse to say back.
// @spec ADR-052, SDD-074, SEC-022
// @tested tests/unit/fr123-plugin-auth-route.test.js

const auth = vi.hoisted(() => ({
  createPluginAuthorizationCode: vi.fn(),
  exchangePluginAuthorizationCode: vi.fn(),
  getPluginCapabilities: vi.fn(),
  revokePluginToken: vi.fn(),
}))
const viewer = vi.hoisted(() => ({ resolveRequestViewer: vi.fn() }))
const db = vi.hoisted(() => ({ plugin: true }))

vi.mock('@/modules/identity/plugin-auth-service', () => auth)
vi.mock('@/modules/identity/request-viewer', () => viewer)
vi.mock('@/lib/db', () => ({ default: db }))

import { GET as authorize, POST as approve } from '@/app/api/plugin/auth/authorize/route'
import { POST as token } from '@/app/api/plugin/auth/token/route'
import { GET as capabilities } from '@/app/api/plugin/auth/capabilities/route'
import { POST as revoke } from '@/app/api/plugin/auth/revoke/route'

const authorizeUrl = 'http://localhost/api/plugin/auth/authorize?response_type=code&client_id=zuri-plugin-v1&redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback&code_challenge=QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ&code_challenge_method=S256&state=state_test_001&installation_id=install_test_001'

describe('FR-123 plugin auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // The consent gate (ADR-052 D4). GET used to mint from the browser session
  // alone; because `zuri_session` is SameSite=Lax and Lax sends the cookie on a
  // top-level GET navigation, that made any link a mint. GET now renders.
  it('answers GET with a same-origin redirect to the consent screen and mints nothing', async () => {
    viewer.resolveRequestViewer.mockResolvedValue({ principal: { id: 'person-1' } })

    const response = await authorize(new Request(authorizeUrl))

    expect(response.status).toBe(302)
    const location = new URL(response.headers.get('location'))
    expect(location.origin).toBe('http://localhost')
    expect(location.pathname).toBe('/plugin/authorize')
    expect(location.searchParams.get('client_id')).toBe('zuri-plugin-v1')
    expect(location.searchParams.get('state')).toBe('state_test_001')
    expect(auth.createPluginAuthorizationCode).not.toHaveBeenCalled()
  })

  // The destination is built from a fixed path on the request's own origin, so
  // no query parameter can steer where the browser is sent next.
  it('cannot be steered to another origin by the query string', async () => {
    const response = await authorize(new Request(`${authorizeUrl}&redirect_uri=https://evil.example/callback`))

    expect(new URL(response.headers.get('location')).origin).toBe('http://localhost')
    expect(auth.createPluginAuthorizationCode).not.toHaveBeenCalled()
  })

  it('refuses to approve without a browser session and mints nothing', async () => {
    viewer.resolveRequestViewer.mockRejectedValue(Object.assign(new Error('AUTH_REQUIRED'), { status: 401 }))

    const response = await approve(new Request('http://localhost/api/plugin/auth/authorize', { method: 'POST', body: new FormData() }))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' })
    expect(auth.createPluginAuthorizationCode).not.toHaveBeenCalled()
  })

  // `httpError` carries a status but no `code`, so a session outage arrives
  // here as a bare 503. Reporting it as AUTH_REQUIRED would tell the plugin to
  // re-authenticate against a boundary that is merely down.
  it('reports a session outage as unavailable rather than as an auth failure', async () => {
    viewer.resolveRequestViewer.mockRejectedValue(Object.assign(new Error('SESSION_UNAVAILABLE'), { status: 503 }))

    const response = await approve(new Request('http://localhost/api/plugin/auth/authorize', { method: 'POST', body: new FormData() }))

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ error: 'AUTH_UNAVAILABLE' })
    expect(auth.createPluginAuthorizationCode).not.toHaveBeenCalled()
  })

  it('returns a generic validation error for malformed token JSON', async () => {
    const response = await token(new Request('http://localhost/api/plugin/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not-json',
    }))

    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'INVALID_REQUEST' })
    expect(auth.exchangePluginAuthorizationCode).not.toHaveBeenCalled()
  })

  it('never echoes the submitted code or an internal message in a token failure', async () => {
    auth.exchangePluginAuthorizationCode.mockRejectedValue(
      Object.assign(new Error('prisma: unique constraint on codeHash abc123'), { code: 'INTERNAL', status: 500 }),
    )

    const response = await token(new Request('http://localhost/api/plugin/auth/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'authorization_code', code: 'code_secret_001' }),
    }))

    expect(response.status).toBe(503)
    const body = await response.text()
    expect(body).toBe(JSON.stringify({ error: 'AUTH_UNAVAILABLE' }))
    expect(body).not.toContain('code_secret_001')
    expect(body).not.toContain('prisma')
  })

  it('passes only the bearer credential to capability discovery and returns its server response', async () => {
    auth.getPluginCapabilities.mockResolvedValue({
      policy_snapshot_id: 'zuri-plugin-policy.v1',
      expires_at: '2026-08-30T04:05:00.000Z',
      capabilities: [],
    })

    const response = await capabilities(new Request('http://localhost/api/plugin/auth/capabilities', {
      headers: { authorization: 'Bearer opaque_plugin_token' },
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ policy_snapshot_id: 'zuri-plugin-policy.v1' }))
    expect(auth.getPluginCapabilities).toHaveBeenCalledWith(expect.objectContaining({ token: 'opaque_plugin_token', db }))
  })

  it('refuses capability discovery with no bearer header without calling the service', async () => {
    const response = await capabilities(new Request('http://localhost/api/plugin/auth/capabilities'))

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: 'AUTH_REQUIRED' })
    expect(auth.getPluginCapabilities).not.toHaveBeenCalled()
  })

  it('revokes from a JSON token body without requiring browser authentication', async () => {
    auth.revokePluginToken.mockResolvedValue({ revoked: true })

    const response = await revoke(new Request('http://localhost/api/plugin/auth/revoke', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'opaque_plugin_token', token_type_hint: 'access_token' }),
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ revoked: true })
    expect(auth.revokePluginToken).toHaveBeenCalledWith(expect.objectContaining({ token: 'opaque_plugin_token', db }))
  })

  it('marks every response no-store so a proxy never caches credential material', async () => {
    viewer.resolveRequestViewer.mockResolvedValue({ principal: { id: 'person-1' } })
    auth.getPluginCapabilities.mockResolvedValue({ capabilities: [] })
    auth.revokePluginToken.mockResolvedValue({ revoked: true })

    const responses = [
      await authorize(new Request(authorizeUrl)),
      await capabilities(new Request('http://localhost/api/plugin/auth/capabilities', {
        headers: { authorization: 'Bearer opaque_plugin_token' },
      })),
      await revoke(new Request('http://localhost/api/plugin/auth/revoke', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: 't' }),
      })),
    ]
    for (const response of responses) {
      expect(response.headers.get('cache-control')).toBe('no-store')
    }
  })
})
