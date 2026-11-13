// @req FR-195
// @spec BR-016, SEC-014, SDD-094, ADR-079
// @tested tests/unit/access-invite-routes.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issueApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'
import { makeViewer } from '../factories/viewer'

const mocks = vi.hoisted(() => ({
  createSessionPort: vi.fn(),
  resolveRequestViewer: vi.fn(),
  mintAccessInvite: vi.fn(),
  acceptAccessInvite: vi.fn(),
  declineAccessInvite: vi.fn(),
  revokeAccessInvite: vi.fn(),
}))

vi.mock('@/modules/identity/session-port', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, createSessionPort: mocks.createSessionPort }
})
vi.mock('@/modules/identity/request-viewer', () => ({
  resolveRequestViewer: mocks.resolveRequestViewer,
}))
vi.mock('@/modules/identity/access-invite-service', () => ({
  mintAccessInvite: mocks.mintAccessInvite,
  acceptAccessInvite: mocks.acceptAccessInvite,
  declineAccessInvite: mocks.declineAccessInvite,
  revokeAccessInvite: mocks.revokeAccessInvite,
}))

import { POST as mintRoute } from '@/app/api/access-invites/route'
import { POST as acceptRoute } from '@/app/api/access-invites/accept/route'
import { POST as declineRoute } from '@/app/api/access-invites/decline/route'
import { DELETE as revokeRoute } from '@/app/api/access-invites/[id]/route'

const origin = 'http://local'
const sessionCookie = 'session-cookie-for-access-invite-tests'
const principalId = 'person-from-session'
const viewer = makeViewer({ principal: { id: principalId, code: 'PER-ROUTE', displayName: 'Route Principal' } })
const mintResult = {
  inviteId: 'invite-id', inviteToken: 'raw-invite-token', scopeType: 'TENANT',
  tenantId: '11111111-1111-4111-8111-111111111111', businessId: null,
  role: 'MEMBER', expiresAt: '2026-11-20T00:00:00.000Z',
}
const session = {
  state: 'AUTHENTICATED',
  sessionId: 'session-access-invite-test',
  principalId,
  expiresAt: new Date(Date.now() + 5 * 60 * 1000),
}

function requestFor(url, { method = 'POST', body, csrf = 'valid', authenticated = true } = {}) {
  const headers = new Headers({
    origin,
    cookie: `zuri_session=${sessionCookie}`,
  })
  if (body !== undefined) headers.set('content-type', 'application/json')

  const init = { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }
  const tokenRequest = new Request(url, init)
  const csrfToken = issueApiWriteCsrfToken({ request: tokenRequest, session }).token
  if (csrf === 'valid') headers.set('x-csrf-token', csrfToken)
  else if (csrf === 'invalid') headers.set('x-csrf-token', 'not-a-session-bound-token')

  const request = new Request(url, init)
  if (authenticated) request.__viewer = viewer
  return request
}

function postBody(url, body, options) {
  return requestFor(url, { ...options, body })
}

async function json(response) {
  return response.json()
}

describe('FR-195 AccessInvite HTTP route contract', () => {
  beforeEach(() => {
    vi.stubEnv('ZURI_SESSION_SECRET', 'access-invite-route-test-secret-long-enough-123456789')
    vi.stubEnv('PUBLIC_BASE_URL', origin)
    mocks.createSessionPort.mockReturnValue({ read: vi.fn(async () => session) })
    mocks.resolveRequestViewer.mockImplementation(async (request) => {
      if (!request.__viewer) throw Object.assign(new Error('AUTH_REQUIRED'), { status: 401 })
      return request.__viewer
    })
    mocks.mintAccessInvite.mockResolvedValue(mintResult)
    mocks.acceptAccessInvite.mockResolvedValue({ status: 'ACCEPTED', membershipId: 'membership-id' })
    mocks.declineAccessInvite.mockResolvedValue({ status: 'DECLINED', inviteId: 'invite-id' })
    mocks.revokeAccessInvite.mockResolvedValue({ status: 'REVOKED', inviteId: 'invite-id' })
  })

  afterEach(() => {
    vi.clearAllMocks()
    vi.unstubAllEnvs()
  })

  it('requires a viewer before invoking a service', async () => {
    const response = await mintRoute(postBody(`${origin}/api/access-invites`, {
      scopeType: 'TENANT', tenantId: '11111111-1111-4111-8111-111111111111', invitedEmail: 'new@example.com',
    }, { authenticated: false }))

    expect(response.status).toBe(401)
    expect(mocks.mintAccessInvite).not.toHaveBeenCalled()
  })

  it.each([
    ['mint', mintRoute, mocks.mintAccessInvite, `${origin}/api/access-invites`, {
      scopeType: 'TENANT', tenantId: '11111111-1111-4111-8111-111111111111', invitedEmail: 'new@example.com',
    }, 'POST'],
    ['accept', acceptRoute, mocks.acceptAccessInvite, `${origin}/api/access-invites/accept`, { token: 'one-use-token' }, 'POST'],
    ['decline', declineRoute, mocks.declineAccessInvite, `${origin}/api/access-invites/decline`, { token: 'one-use-token' }, 'POST'],
    ['revoke', revokeRoute, mocks.revokeAccessInvite, `${origin}/api/access-invites/invite-123`, undefined, 'DELETE'],
  ])('%s refuses missing and invalid CSRF tokens before service execution', async (name, route, service, url, body, method) => {
    for (const csrf of ['missing', 'invalid']) {
      const request = requestFor(url, { method, body, csrf })
      const response = await route(request, name === 'revoke' ? { params: { id: 'invite-123' } } : undefined)
      expect(response.status).toBe(403)
    }
    expect(service).not.toHaveBeenCalled()
  })

  it('checks CSRF before parsing a malformed mint body', async () => {
    const request = new Request(`${origin}/api/access-invites`, {
      method: 'POST',
      headers: new Headers({
        origin,
        cookie: `zuri_session=${sessionCookie}`,
        'content-type': 'application/json',
      }),
      body: '{',
    })
    request.__viewer = viewer

    const response = await mintRoute(request)

    expect(response.status).toBe(403)
    expect(mocks.mintAccessInvite).not.toHaveBeenCalled()
  })

  it('rejects whitespace-only LINE addressee before calling the mint service', async () => {
    const response = await mintRoute(postBody(`${origin}/api/access-invites`, {
      scopeType: 'TENANT', tenantId: '11111111-1111-4111-8111-111111111111', invitedLineUserId: '   ',
    }))

    expect(response.status).toBe(400)
    expect(mocks.mintAccessInvite).not.toHaveBeenCalled()
  })

  it('strictly validates the mint body and trims the invited email', async () => {
    const url = `${origin}/api/access-invites`
    const invalid = await mintRoute(postBody(url, {
      scopeType: 'TENANT', tenantId: '11111111-1111-4111-8111-111111111111',
      invitedEmail: 'new@example.com', personId: 'forged',
    }))
    expect(invalid.status).toBe(400)
    expect(mocks.mintAccessInvite).not.toHaveBeenCalled()

    const response = await mintRoute(postBody(url, {
      scopeType: 'TENANT', tenantId: '11111111-1111-4111-8111-111111111111',
      invitedEmail: '  New.Person@example.com  ', reason: '  one reason  ', domainKeys: [' people '],
    }))
    const body = await json(response)
    expect(response.status).toBe(200)
    expect(body).toEqual(mintResult)
    expect(body.inviteToken).toBe(mintResult.inviteToken)
    expect(JSON.stringify(body).match(new RegExp(mintResult.inviteToken, 'g'))).toHaveLength(1)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(mocks.mintAccessInvite).toHaveBeenCalledWith(expect.objectContaining({
      viewer,
      scopeType: 'TENANT',
      tenantId: '11111111-1111-4111-8111-111111111111',
      role: 'MEMBER',
      invitedEmail: 'New.Person@example.com',
      reason: 'one reason',
      domainKeys: ['people'],
    }))
  })

  it('lets the service refuse OWNER as INVITE_ROLE_NOT_ALLOWED', async () => {
    mocks.mintAccessInvite.mockRejectedValue(Object.assign(new Error('INVITE_ROLE_NOT_ALLOWED'), { status: 400 }))
    const response = await mintRoute(postBody(`${origin}/api/access-invites`, {
      scopeType: 'TENANT', tenantId: '11111111-1111-4111-8111-111111111111',
      invitedEmail: 'new@example.com', role: 'OWNER',
    }))

    expect(response.status).toBe(400)
    expect(await json(response)).toMatchObject({ error: 'INVITE_ROLE_NOT_ALLOWED' })
    expect(mocks.mintAccessInvite).toHaveBeenCalledWith(expect.objectContaining({ role: 'OWNER' }))
  })

  it.each([
    ['accept', acceptRoute, mocks.acceptAccessInvite],
    ['decline', declineRoute, mocks.declineAccessInvite],
  ])('rejects personId and unknown body keys on %s', async (name, route, service) => {
    const withPerson = await route(postBody(`${origin}/api/access-invites/${name}`, {
      token: 'one-use-token', personId: 'attacker',
    }))
    const withUnknown = await route(postBody(`${origin}/api/access-invites/${name}`, {
      token: 'one-use-token', extra: true,
    }))

    expect(withPerson.status).toBe(400)
    expect(withUnknown.status).toBe(400)
    expect(service).not.toHaveBeenCalled()
  })

  it('always binds acceptance to the session principal', async () => {
    const response = await acceptRoute(postBody(`${origin}/api/access-invites/accept`, { token: 'one-use-token' }))

    expect(response.status).toBe(200)
    expect(mocks.acceptAccessInvite).toHaveBeenCalledWith({ token: 'one-use-token', personId: principalId })
  })

  it('always binds decline to the session principal', async () => {
    const response = await declineRoute(postBody(`${origin}/api/access-invites/decline`, { token: 'one-use-token' }))

    expect(response.status).toBe(200)
    expect(mocks.declineAccessInvite).toHaveBeenCalledWith({ token: 'one-use-token', personId: principalId })
  })

  it('passes DELETE params.id and maps service status through unchanged', async () => {
    mocks.revokeAccessInvite.mockRejectedValue(Object.assign(new Error('INVITE_NOT_PENDING'), { status: 409 }))
    const response = await revokeRoute(requestFor(`${origin}/api/access-invites/invite-123`, { method: 'DELETE' }), {
      params: { id: 'invite-123' },
    })

    expect(response.status).toBe(409)
    expect(await json(response)).toMatchObject({ error: 'INVITE_NOT_PENDING' })
    expect(mocks.revokeAccessInvite).toHaveBeenCalledWith({ viewer, inviteId: 'invite-123' })
  })

  it('resolves Next 15 Promise params before revoking an invite', async () => {
    const response = await revokeRoute(requestFor(`${origin}/api/access-invites/inv-1`, { method: 'DELETE' }), {
      params: Promise.resolve({ id: 'inv-1' }),
    })

    expect(response.status).toBe(200)
    expect(mocks.revokeAccessInvite).toHaveBeenCalledWith({ viewer, inviteId: 'inv-1' })
  })

  it('passes an absent id from resolved params to the service without throwing', async () => {
    const response = await revokeRoute(requestFor(`${origin}/api/access-invites/without-id`, { method: 'DELETE' }), {
      params: Promise.resolve({}),
    })

    expect(response.status).toBe(200)
    expect(mocks.revokeAccessInvite).toHaveBeenCalledWith({ viewer, inviteId: undefined })
  })
})
