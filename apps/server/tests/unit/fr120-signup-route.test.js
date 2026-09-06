import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createAccount: vi.fn(),
  authenticateUser: vi.fn(),
  check: vi.fn(),
}))

vi.mock('@/modules/identity/signup-service', () => ({ createAccount: mocks.createAccount }))
vi.mock('@/modules/identity/auth-service', () => ({
  AUTH_SESSION_COOKIE: 'zuri_session',
  authenticateUser: mocks.authenticateUser,
}))
vi.mock('@/modules/identity/signup-rate-limit', () => ({
  signupRateLimiter: { check: mocks.check },
  signupSourceKey: (headers) => headers?.get?.('x-forwarded-for') || 'unknown',
}))

import { POST } from '@/app/api/auth/signup/route'
import { ONBOARDING_STEP_PATHS } from '@/modules/identity/onboarding-steps'

// @req FR-120 — the public signup route: creates the account, mints the session
// through FR-046's path, and continues into FR-066 at its PROFILE step.
// @spec BR-002, SEC-008
// @tested tests/unit/fr120-signup-route.test.js

const PERSON = { id: 'per-new', code: 'PSN-X', displayName: 'คนใหม่', email: 'new@example.com' }

const request = (body = {}, headers = {}) => new Request('http://localhost/api/auth/signup', {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
})

const VALID = { displayName: 'คนใหม่', email: 'new@example.com', password: 'a-good-enough-password' }

function allowLimit() {
  mocks.check.mockReturnValue({ allowed: true, remaining: 19, retryAfterSeconds: 900 })
}

describe('FR-120 signup route', () => {
  afterEach(() => {
    mocks.createAccount.mockReset()
    mocks.authenticateUser.mockReset()
    mocks.check.mockReset()
  })

  it('creates the account, signs the caller in, and sends them to the profile step', async () => {
    allowLimit()
    mocks.createAccount.mockResolvedValue(PERSON)
    mocks.authenticateUser.mockResolvedValue({ success: true, token: 'zuri_sess.signed', user: PERSON })

    const response = await POST(request(VALID))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toEqual({
      success: true,
      user: { id: 'per-new', code: 'PSN-X', displayName: 'คนใหม่' },
      session: true,
      redirect: ONBOARDING_STEP_PATHS.PROFILE,
    })
    expect(body.redirect).toBe('/onboarding/profile')
  })

  it('mints the session through FR-046\'s own path rather than a second one', async () => {
    allowLimit()
    mocks.createAccount.mockResolvedValue(PERSON)
    mocks.authenticateUser.mockResolvedValue({ success: true, token: 'zuri_sess.signed', user: PERSON })

    await POST(request(VALID))

    // Authenticating with the STORED email, not the typed one: the service
    // normalizes it, and passing the raw input here would fail to resolve an
    // address the caller typed with a capital letter.
    expect(mocks.authenticateUser).toHaveBeenCalledWith({
      username: PERSON.email,
      password: VALID.password,
    })
  })

  it('sets an HttpOnly browser-session cookie with no Max-Age', async () => {
    allowLimit()
    mocks.createAccount.mockResolvedValue(PERSON)
    mocks.authenticateUser.mockResolvedValue({ success: true, token: 'zuri_sess.signed', user: PERSON })

    const response = await POST(request(VALID))
    const cookie = response.headers.get('set-cookie')

    expect(cookie).toContain('zuri_session=zuri_sess.signed')
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toMatch(/SameSite=lax/i)
    // AC-046-15's default. Signup carries no "remember me" tick, so it must not
    // quietly opt itself into the seven days the ticked box buys.
    expect(cookie).not.toMatch(/Max-Age/i)
  })

  it('reports the account as created even when the session cannot be minted', async () => {
    // The account was committed. Reporting "signup failed" here would send the
    // person to try again and meet EMAIL_TAKEN on their own address.
    allowLimit()
    mocks.createAccount.mockResolvedValue(PERSON)
    mocks.authenticateUser.mockResolvedValue({ success: false, error: 'INVALID_CREDENTIALS' })

    const response = await POST(request(VALID))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body.success).toBe(true)
    expect(body.session).toBe(false)
    expect(body.redirect).toBe('/login')
    expect(response.headers.get('set-cookie')).toBeNull()
  })

  it('survives authenticateUser throwing, not only returning a failure', async () => {
    // A missing ZURI_SESSION_SECRET throws rather than returning `{success:false}`,
    // and an unhandled throw here would be a 500 on a request that succeeded.
    allowLimit()
    mocks.createAccount.mockResolvedValue(PERSON)
    mocks.authenticateUser.mockRejectedValue(new Error('SESSION_SECRET_REQUIRED'))

    const response = await POST(request(VALID))
    const body = await response.json()

    expect(response.status).toBe(201)
    expect(body).toMatchObject({ success: true, session: false, redirect: '/login' })
  })

  it('passes the service\'s deliberate refusals through with their own status', async () => {
    for (const [code, status] of [['EMAIL_TAKEN', 409], ['EMAIL_INVALID', 400], ['PASSWORD_INVALID', 400], ['DISPLAY_NAME_REQUIRED', 400]]) {
      allowLimit()
      const error = Object.assign(new Error(code), { status, code })
      mocks.createAccount.mockRejectedValue(error)

      const response = await POST(request(VALID))
      expect(response.status).toBe(status)
      expect(await response.json()).toEqual({ success: false, error: code })
    }
  })

  it('reports an unexpected failure as server state, never as a bad field', async () => {
    allowLimit()
    mocks.createAccount.mockRejectedValue(new Error('SQLITE_BUSY'))

    const response = await POST(request(VALID))
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ success: false, error: 'SIGNUP_UNAVAILABLE' })
  })

  it('refuses a rate-limited caller with 429 and a Retry-After', async () => {
    mocks.check.mockReturnValue({ allowed: false, remaining: 0, retryAfterSeconds: 420 })

    const response = await POST(request(VALID))
    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('420')
    expect(await response.json()).toEqual({ success: false, error: 'RATE_LIMITED' })
  })

  it('counts the attempt before reading the body or hashing anything', async () => {
    // scrypt is deliberately expensive. An unauthenticated route that runs it
    // before deciding whether to serve the request has handed out its own CPU
    // as the attack, and the check is worthless once the work is already done.
    mocks.check.mockReturnValue({ allowed: false, remaining: 0, retryAfterSeconds: 1 })

    await POST(request(VALID))
    expect(mocks.check).toHaveBeenCalledTimes(1)
    expect(mocks.createAccount).not.toHaveBeenCalled()
    expect(mocks.authenticateUser).not.toHaveBeenCalled()
  })

  it('keys the limit on the forwarded client address', async () => {
    allowLimit()
    mocks.createAccount.mockResolvedValue(PERSON)
    mocks.authenticateUser.mockResolvedValue({ success: true, token: 't', user: PERSON })

    await POST(request(VALID, { 'x-forwarded-for': '203.0.113.7' }))
    expect(mocks.check).toHaveBeenCalledWith('203.0.113.7')
  })

  it('accepts a plain form post as well as a JSON fetch', async () => {
    // The page posts JSON; this is about the route, not the page. It reads both
    // shapes because `/api/auth/login` does, and a flag or field honoured in one
    // shape but not the other is worse than one honoured in neither — the exact
    // reason the login route reads `remember` from both.
    //
    // Stated precisely so it is not mistaken for a no-JavaScript fallback: the
    // signup form carries no `action`/`method`, and this route answers a form
    // post with JSON rather than a redirect, so a browser without JavaScript
    // would be shown the response body. That is the same gap `/api/auth/login`
    // has, not something this slice closes.
    allowLimit()
    mocks.createAccount.mockResolvedValue(PERSON)
    mocks.authenticateUser.mockResolvedValue({ success: true, token: 't', user: PERSON })

    const form = new FormData()
    form.set('email', 'new@example.com')
    form.set('displayName', 'คนใหม่')
    form.set('password', 'a-good-enough-password')

    await POST(new Request('http://localhost/api/auth/signup', { method: 'POST', body: form }))

    expect(mocks.createAccount).toHaveBeenCalledWith({
      email: 'new@example.com',
      displayName: 'คนใหม่',
      password: 'a-good-enough-password',
    })
  })

  it('does not crash on a malformed body, and never creates an account from one', async () => {
    allowLimit()
    // The real service refuses an absent address; this stands in for it so the
    // assertion is about the route surviving the parse, not about the service.
    mocks.createAccount.mockRejectedValue(Object.assign(new Error('EMAIL_INVALID'), { status: 400, code: 'EMAIL_INVALID' }))

    const response = await POST(new Request('http://localhost/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: 'not json at all',
    }))

    expect(mocks.createAccount).toHaveBeenCalledWith({ email: undefined, displayName: undefined, password: '' })
    expect(response.status).toBe(400)
    expect(mocks.authenticateUser).not.toHaveBeenCalled()
  })
})
