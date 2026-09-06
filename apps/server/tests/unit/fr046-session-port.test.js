import { describe, expect, it, vi } from 'vitest'
import { generateSessionToken } from '@/modules/identity/auth-service'
import { createSessionPort } from '@/modules/identity/session-port'
import { resolveRequestViewer } from '@/modules/identity/request-viewer'

// @req FR-046 — request identity is server-owned and production fails closed.
// @spec ADR-017, SDD-024, SEC-008
// @tested tests/unit/fr046-session-port.test.js

function requestWith({ cookie = '', headers = {} } = {}) {
  return new Request('http://localhost/api/entry', { headers: { cookie, ...headers } })
}

describe('FR-046 trusted request session', () => {
  it('passes only a trusted adapter principal and platform grant to resolveViewer', async () => {
    const readTrustedSession = vi.fn(async () => ({ principalId: 'person-dev', platformGrant: true, sessionId: 'session-1' }))
    const resolve = vi.fn(async (input) => ({ principal: { id: input.principalId }, role: 'DEV' }))
    const sessionPort = createSessionPort({ readTrustedSession, env: { NODE_ENV: 'production' } })

    await resolveRequestViewer(requestWith({ headers: { 'x-principal-id': 'forged', 'x-platform-grant': 'true' } }), { sessionPort, resolve })

    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      principalId: 'person-dev',
      platformGrant: true,
    }))
    expect(JSON.stringify(resolve.mock.calls)).not.toContain('forged')
  })

  it('returns AUTH_REQUIRED before calling the viewer resolver when no session exists', async () => {
    const resolve = vi.fn()
    const sessionPort = createSessionPort({ readTrustedSession: async () => null, env: { NODE_ENV: 'production' } })

    await expect(resolveRequestViewer(requestWith(), { sessionPort, resolve })).rejects.toMatchObject({
      status: 401,
      message: 'AUTH_REQUIRED',
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('maps session-adapter failure to a non-disclosing 503 without fallback', async () => {
    const resolve = vi.fn()
    const sessionPort = createSessionPort({ readTrustedSession: async () => { throw new Error('database host secret') }, env: { NODE_ENV: 'production' } })

    await expect(resolveRequestViewer(requestWith(), { sessionPort, resolve })).rejects.toMatchObject({
      status: 503,
      message: 'SESSION_UNAVAILABLE',
    })
    expect(resolve).not.toHaveBeenCalled()
  })

  it('maps a trusted but expired or revoked principal to AUTH_REQUIRED', async () => {
    const sessionPort = createSessionPort({
      readTrustedSession: async () => ({ principalId: 'revoked-person' }),
      env: { NODE_ENV: 'production' },
    })
    const resolve = vi.fn(async () => { throw new Error('Viewer principal was not found') })

    await expect(resolveRequestViewer(requestWith(), { sessionPort, resolve })).rejects.toMatchObject({
      status: 401,
      message: 'AUTH_REQUIRED',
    })
  })

  it('resolves only a valid signed credential session cookie', async () => {
    const secret = 'test-session-secret-that-is-long-enough-123456'
    const token = generateSessionToken('person-1', { secret, now: Date.now() })
    const resolve = vi.fn(async (input) => ({ principal: { id: input.principalId }, role: 'OWNER' }))
    const sessionPort = createSessionPort({ env: { NODE_ENV: 'development', ZURI_SESSION_SECRET: secret } })

    await resolveRequestViewer(requestWith({ cookie: `zuri_session=${token}` }), { sessionPort, resolve })

    expect(resolve).toHaveBeenCalledWith(expect.objectContaining({
      principalId: 'person-1',
      platformGrant: false,
    }))
  })

  it('rejects tampered, expired, and legacy demo cookies', async () => {
    const secret = 'test-session-secret-that-is-long-enough-123456'
    const valid = generateSessionToken('person-1', { secret, now: Date.now() })
    const sessionPort = createSessionPort({
      env: { NODE_ENV: 'development', ZURI_SESSION_SECRET: secret, ZURI_LOCAL_DEMO_AUTH: '1' },
    })
    const resolve = vi.fn()

    await expect(resolveRequestViewer(requestWith({ cookie: `zuri_session=${valid}tampered` }), { sessionPort, resolve }))
      .rejects.toMatchObject({ status: 401, message: 'AUTH_REQUIRED' })
    await expect(resolveRequestViewer(requestWith({ cookie: 'zuri_local_demo_session=enabled' }), { sessionPort, resolve }))
      .rejects.toMatchObject({ status: 401, message: 'AUTH_REQUIRED' })
    expect(resolve).not.toHaveBeenCalled()
  })
})
