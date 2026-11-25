import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issueApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'

const mocks = vi.hoisted(() => ({
  createSessionPort: vi.fn(),
  resolveRequestViewer: vi.fn(),
  revokeAllSessions: vi.fn(),
}))

vi.mock('@/modules/identity/session-port', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, createSessionPort: mocks.createSessionPort }
})
vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: mocks.resolveRequestViewer,
}))
vi.mock('@/modules/identity/auth-service', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, revokeAllSessions: mocks.revokeAllSessions }
})

import { POST as logoutAll } from '@/app/api/auth/logout-all/route'

// @req FR-046, FR-095 — logout-all requires a live CSRF-bound session and revokes every active session for its Person.
// @spec ADR-124, SEC-018
// @tested tests/unit/fr046-logout-all-route.test.js, tests/integration/session-idle-multi-instance.test.js

const origin = 'http://local'
const url = `${origin}/api/auth/logout-all`
const now = Date.now()
const env = {
  NODE_ENV: 'test',
  PUBLIC_BASE_URL: origin,
  ZURI_SESSION_SECRET: 'logout-all-test-secret-with-more-than-32-characters',
}
const db = { session: {} }
const sessionCookie = 'signed-session-cookie'
const session = {
  state: 'AUTHENTICATED',
  sessionId: 'session-logout-all',
  principalId: 'person-logout-all',
  expiresAt: new Date(now + 10 * 60 * 1000),
}
const viewer = { principal: { id: session.principalId } }

function requestFor({ csrf = 'valid' } = {}) {
  const headers = new Headers({ origin, cookie: `zuri_session=${sessionCookie}` })
  const unsignedRequest = new Request(url, { method: 'POST', headers })
  const csrfToken = issueApiWriteCsrfToken({ request: unsignedRequest, session, env, now }).token
  if (csrf === 'valid') headers.set('x-csrf-token', csrfToken)
  if (csrf === 'invalid') headers.set('x-csrf-token', 'not-a-valid-token')
  return new Request(url, { method: 'POST', headers })
}

describe('FR-046 logout-all route', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createSessionPort.mockReturnValue({ read: vi.fn().mockResolvedValue(session) })
    mocks.resolveRequestViewer.mockResolvedValue(viewer)
    mocks.revokeAllSessions.mockResolvedValue(3)
  })

  it('returns 401 when the session is unauthenticated', async () => {
    mocks.createSessionPort.mockReturnValue({ read: vi.fn().mockResolvedValue({ state: 'UNAUTHENTICATED' }) })

    const response = await logoutAll(requestFor(), { db, env, now })

    expect(response.status).toBe(401)
    expect(await response.json()).toMatchObject({ error: 'AUTHENTICATION_REQUIRED' })
    expect(mocks.resolveRequestViewer).not.toHaveBeenCalled()
    expect(mocks.revokeAllSessions).not.toHaveBeenCalled()
  })

  it('maps a session store read failure to 503', async () => {
    mocks.createSessionPort.mockReturnValue({ read: vi.fn().mockRejectedValue(new Error('database unavailable')) })

    const response = await logoutAll(requestFor(), { db, env, now })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'SESSION_UNAVAILABLE' })
  })

  it.each(['missing', 'invalid'])('refuses a %s CSRF token before revoking sessions', async (csrf) => {
    const response = await logoutAll(requestFor({ csrf }), { db, env, now })

    expect(response.status).toBe(403)
    expect(mocks.revokeAllSessions).not.toHaveBeenCalled()
  })

  it('revokes all sessions for the authenticated Person and clears the cookie', async () => {
    const response = await logoutAll(requestFor(), { db, env, now })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ revoked: 3 })
    expect(mocks.revokeAllSessions).toHaveBeenCalledWith(session.principalId, {
      db,
      env,
      now,
      reason: 'LOGOUT_ALL',
    })
    expect(response.headers.get('set-cookie')).toContain('zuri_session=')
    expect(response.headers.get('set-cookie')).toMatch(/Max-Age=0/i)
    expect(response.headers.get('set-cookie')).toMatch(/HttpOnly/i)
  })

  it('returns 503 and preserves the cookie when the revocation store fails', async () => {
    mocks.revokeAllSessions.mockRejectedValue(new Error('database unavailable'))

    const response = await logoutAll(requestFor(), { db, env, now })

    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ error: 'SESSION_UNAVAILABLE' })
    expect(response.headers.get('set-cookie')).toBeNull()
  })
})
