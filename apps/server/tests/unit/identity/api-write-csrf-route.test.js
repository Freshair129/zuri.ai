import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// @req FR-252 — P2 Identity route delivers a direct no-store token and a
// stable redacted refusal envelope.
// @spec ADR-097
// @tested tests/unit/identity/api-write-csrf-route.test.js

const sessionPort = vi.hoisted(() => ({ read: vi.fn() }))
const issuer = vi.hoisted(() => ({ issueApiWriteCsrfToken: vi.fn() }))

vi.mock('@/modules/identity/session-port', () => ({
  createSessionPort: vi.fn(() => sessionPort),
}))
vi.mock('@/modules/identity/api-write-csrf', async (importOriginal) => ({
  ...(await importOriginal()),
  issueApiWriteCsrfToken: issuer.issueApiWriteCsrfToken,
}))

import { GET } from '@/app/api/auth/csrf/route'

const session = {
  state: 'AUTHENTICATED',
  principalId: 'person-1',
  sessionId: 'session-1',
  expiresAt: new Date('2026-09-17T01:00:00.000Z'),
}

function request() {
  return new Request('https://zuri.example/api/auth/csrf', {
    headers: {
      cookie: 'zuri_session=session-cookie-value',
      origin: 'https://zuri.example',
    },
  })
}

async function expectTyped(response, { status, code, message }) {
  expect(response.status).toBe(status)
  expect(response.headers.get('cache-control')).toBe('no-store')
  expect(response.headers.get('access-control-allow-origin')).toBeNull()

  const body = await response.json()
  expect(body).toMatchObject({ code, message, retryable: expect.any(Boolean) })
  expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/i)
  expect(response.headers.get('x-request-id')).toBe(body.requestId)
  return body
}

describe('FR-252-P2 GET /api/auth/csrf', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('ZURI_SESSION_SECRET', 'api-write-csrf-route-secret-that-is-long-enough-123456')
    vi.stubEnv('PUBLIC_BASE_URL', 'https://zuri.example')
    sessionPort.read.mockResolvedValue(session)
    issuer.issueApiWriteCsrfToken.mockReturnValue({
      token: 'zuri_api_csrf.opaque.signature',
      expiresAt: '2026-09-17T00:15:00.000Z',
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('returns the direct schema-shaped token with no-store and no CORS header', async () => {
    const response = await GET(request())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      token: 'zuri_api_csrf.opaque.signature',
      expiresAt: '2026-09-17T00:15:00.000Z',
    })
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
    expect(sessionPort.read).toHaveBeenCalledWith(expect.any(Request))
    expect(issuer.issueApiWriteCsrfToken).toHaveBeenCalledWith({
      request: expect.any(Request),
      session,
    })
  })

  it('returns redacted AUTH_REQUIRED without asking the issuer when no live session exists', async () => {
    sessionPort.read.mockResolvedValue({ state: 'UNAUTHENTICATED' })

    const body = await expectTyped(await GET(request()), {
      status: 401,
      code: 'AUTH_REQUIRED',
      message: 'Authentication is required.',
    })

    expect(body).not.toHaveProperty('token')
    expect(issuer.issueApiWriteCsrfToken).not.toHaveBeenCalled()
  })

  it('maps session-store and issuer configuration failures to redacted 503', async () => {
    sessionPort.read.mockRejectedValue(new Error('database host secret'))
    let body = await expectTyped(await GET(request()), {
      status: 503,
      code: 'SESSION_UNAVAILABLE',
      message: 'Session service temporarily unavailable.',
    })
    expect(JSON.stringify(body)).not.toContain('database host secret')

    sessionPort.read.mockResolvedValue(session)
    issuer.issueApiWriteCsrfToken.mockImplementation(() => {
      throw Object.assign(new Error('ZURI_SESSION_SECRET=private'), {
        status: 503,
        code: 'SESSION_UNAVAILABLE',
      })
    })
    body = await expectTyped(await GET(request()), {
      status: 503,
      code: 'SESSION_UNAVAILABLE',
      message: 'Session service temporarily unavailable.',
    })
    expect(JSON.stringify(body)).not.toContain('ZURI_SESSION_SECRET')
  })

  it('fails closed on invalid runtime secret configuration before reading a cookie', async () => {
    vi.stubEnv('ZURI_SESSION_SECRET', 'too-short')

    const body = await expectTyped(await GET(request()), {
      status: 503,
      code: 'SESSION_UNAVAILABLE',
      message: 'Session service temporarily unavailable.',
    })
    expect(sessionPort.read).not.toHaveBeenCalled()
    expect(issuer.issueApiWriteCsrfToken).not.toHaveBeenCalled()
    expect(JSON.stringify(body)).not.toContain('too-short')
  })

  it('maps issuer Origin refusal to the candidate typed 403 without leaking internals', async () => {
    issuer.issueApiWriteCsrfToken.mockImplementation(() => {
      throw Object.assign(new Error('origin=https://evil.example'), {
        status: 403,
        code: 'CSRF_INVALID',
      })
    })

    const body = await expectTyped(await GET(request()), {
      status: 403,
      code: 'CSRF_INVALID',
      message: 'CSRF validation failed.',
    })
    expect(JSON.stringify(body)).not.toContain('evil.example')
  })

  it('maps an invalid issuer result to the candidate unavailable response', async () => {
    issuer.issueApiWriteCsrfToken.mockReturnValue({ token: '', expiresAt: 'not-a-date' })

    await expectTyped(await GET(request()), {
      status: 503,
      code: 'SESSION_UNAVAILABLE',
      message: 'Session service temporarily unavailable.',
    })
  })
})
