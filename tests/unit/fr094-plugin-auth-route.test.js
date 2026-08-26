import { beforeEach, describe, expect, it, vi } from 'vitest'

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

import { GET as authorize } from '@/app/api/plugin/auth/authorize/route'
import { POST as token } from '@/app/api/plugin/auth/token/route'
import { GET as capabilities } from '@/app/api/plugin/auth/capabilities/route'
import { POST as revoke } from '@/app/api/plugin/auth/revoke/route'

const authorizeUrl = 'http://localhost/api/plugin/auth/authorize?response_type=code&client_id=zuri-plugin-v1&redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2Fcallback&code_challenge=QQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQQ&code_challenge_method=S256&state=state_test_001&installation_id=install_test_001'

describe('FR-094 plugin auth routes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('authorizes only through the trusted browser viewer and redirects to the exact registered target', async () => {
    viewer.resolveRequestViewer.mockResolvedValue({ principal: { id: 'person-1' } })
    auth.createPluginAuthorizationCode.mockResolvedValue({ code: 'code_test_001' })

    const response = await authorize(new Request(authorizeUrl))

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://127.0.0.1:43123/callback?code=code_test_001&state=state_test_001')
    expect(auth.createPluginAuthorizationCode).toHaveBeenCalledWith(expect.objectContaining({
      principalId: 'person-1',
      db,
    }))
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

  it('passes only the bearer credential to capability discovery and returns its server response', async () => {
    auth.getPluginCapabilities.mockResolvedValue({
      policy_snapshot_id: 'zuri-plugin-policy.v1',
      expires_at: '2026-08-23T04:05:00.000Z',
      capabilities: [],
    })

    const response = await capabilities(new Request('http://localhost/api/plugin/auth/capabilities', {
      headers: { authorization: 'Bearer opaque_plugin_token' },
    }))

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(expect.objectContaining({ policy_snapshot_id: 'zuri-plugin-policy.v1' }))
    expect(auth.getPluginCapabilities).toHaveBeenCalledWith(expect.objectContaining({ token: 'opaque_plugin_token', db }))
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
})
