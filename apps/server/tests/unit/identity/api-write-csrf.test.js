import { createHmac } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  API_WRITE_CSRF_AUDIENCE,
  API_WRITE_CSRF_TTL_SECONDS,
  assertApiWriteCsrfToken,
  issueApiWriteCsrfToken,
  zApiWriteCsrfToken,
} from '@/modules/identity/api-write-csrf'
import {
  issuePluginConsentCsrfToken,
  pluginConsentSessionBinding,
} from '@/modules/identity/plugin-consent'

// @req FR-252 — P2 API-write token has its own audience, live-session
// binding, expiry and exact configured-origin policy.
// @spec ADR-097
// @tested tests/unit/identity/api-write-csrf.test.js

const secret = 'api-write-csrf-unit-secret-that-is-long-enough-123456'
const env = { ZURI_SESSION_SECRET: secret, PUBLIC_BASE_URL: 'https://zuri.example' }
const now = Date.parse('2026-09-17T00:00:00.000Z')

function liveSession(expiresAt = new Date(now + 60 * 60 * 1000)) {
  return {
    state: 'AUTHENTICATED',
    principalId: 'person-1',
    sessionId: 'session-1',
    expiresAt,
  }
}

function requestWith(options = {}) {
  const { cookie = 'cookie-a', headers = {} } = options
  const requestHeaders = { cookie: `zuri_session=${cookie}`, ...headers }
  const origin = Object.prototype.hasOwnProperty.call(options, 'origin') ? options.origin : env.PUBLIC_BASE_URL
  if (origin !== undefined) requestHeaders.origin = origin
  return new Request('https://zuri.example/api/projects/project-1/features', { headers: requestHeaders })
}

function expectFailure(fn, expected) {
  try {
    fn()
    throw new Error('expected API-write CSRF failure')
  } catch (error) {
    expect(error).toMatchObject(expected)
  }
}

function resign(token, changes) {
  const [prefix, encoded, ignoredSignature] = token.split('.')
  void ignoredSignature
  const claims = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  const changed = Buffer.from(JSON.stringify({ ...claims, ...changes }), 'utf8').toString('base64url')
  const signature = createHmac('sha256', secret).update(changed, 'utf8').digest('base64url')
  return `${prefix}.${changed}.${signature}`
}

describe('FR-252-P2 API-write CSRF token', () => {
  it('issues and verifies a token for the same live session', () => {
    const request = requestWith()
    const session = liveSession()
    const issued = issueApiWriteCsrfToken({ request, session, env, now })

    expect(zApiWriteCsrfToken.parse(issued)).toEqual(issued)
    expect(issued.token).toMatch(/^zuri_api_csrf\./)
    expect(issued.token).not.toContain('cookie-a')
    expect(issued.token).not.toContain(secret)
    expect(new Date(issued.expiresAt).getTime()).toBe(now + API_WRITE_CSRF_TTL_SECONDS * 1000)
    expect(assertApiWriteCsrfToken({ request, token: issued.token, session, env, now })).toBe(true)
  })

  it('caps the token at the live session expiry instead of inventing a longer lifetime', () => {
    const session = liveSession(new Date(now + 5 * 60 * 1000))
    const issued = issueApiWriteCsrfToken({ request: requestWith(), session, env, now })

    expect(new Date(issued.expiresAt).getTime()).toBe(now + 5 * 60 * 1000)
  })

  it('rejects another cookie, a plugin-consent token, a wrong audience and a forged signature', () => {
    const request = requestWith()
    const session = liveSession()
    const issued = issueApiWriteCsrfToken({ request, session, env, now })

    expectFailure(
      () => assertApiWriteCsrfToken({ request: requestWith({ cookie: 'cookie-b' }), token: issued.token, session, env, now }),
      { status: 403, code: 'CSRF_INVALID' },
    )

    const pluginToken = issuePluginConsentCsrfToken({
      sessionBinding: pluginConsentSessionBinding('cookie-a'),
      env,
    })
    expectFailure(
      () => assertApiWriteCsrfToken({ request, token: pluginToken, session, env, now }),
      { status: 403, code: 'CSRF_INVALID' },
    )

    expectFailure(
      () => assertApiWriteCsrfToken({ request, token: resign(issued.token, { aud: 'zuri_plugin_consent.v1' }), session, env, now }),
      { status: 403, code: 'CSRF_INVALID' },
    )
    expectFailure(
      () => assertApiWriteCsrfToken({ request, token: `${issued.token}tampered`, session, env, now }),
      { status: 403, code: 'CSRF_INVALID' },
    )
    expectFailure(
      () => assertApiWriteCsrfToken({ request, token: `${issued.token}.extra`, session, env, now }),
      { status: 403, code: 'CSRF_INVALID' },
    )
  })

  it('rejects future-issued and expired tokens even when their HMAC is valid', () => {
    const session = liveSession()
    const future = issueApiWriteCsrfToken({ request: requestWith(), session, env, now: now + 30_000 })
    expectFailure(
      () => assertApiWriteCsrfToken({ request: requestWith(), token: future.token, session, env, now }),
      { status: 403, code: 'CSRF_INVALID' },
    )

    const expired = issueApiWriteCsrfToken({ request: requestWith(), session, env, now: now - 16 * 60 * 1000 })
    expectFailure(
      () => assertApiWriteCsrfToken({ request: requestWith(), token: expired.token, session, env, now }),
      { status: 403, code: 'CSRF_INVALID' },
    )
  })

  it('rejects an expired, revoked or unproven legacy session before issuing or verifying', () => {
    const expired = liveSession(new Date(now - 1))
    expectFailure(
      () => issueApiWriteCsrfToken({ request: requestWith(), session: expired, env, now }),
      { status: 401, code: 'AUTH_REQUIRED' },
    )

    expectFailure(
      () => issueApiWriteCsrfToken({ request: requestWith(), session: { ...liveSession(), state: 'UNAUTHENTICATED' }, env, now }),
      { status: 401, code: 'AUTH_REQUIRED' },
    )

    expectFailure(
      () => issueApiWriteCsrfToken({ request: requestWith(), session: { ...liveSession(), sessionId: 'legacy-1' }, env, now }),
      { status: 503, code: 'SESSION_UNAVAILABLE' },
    )
    expectFailure(
      () => issueApiWriteCsrfToken({ request: requestWith(), session: { ...liveSession(), expiresAt: undefined }, env, now }),
      { status: 503, code: 'SESSION_UNAVAILABLE' },
    )
  })

  it('requires a valid secret and an explicitly configured PUBLIC_BASE_URL', () => {
    const session = liveSession()
    expectFailure(
      () => issueApiWriteCsrfToken({ request: requestWith(), session, env: { PUBLIC_BASE_URL: env.PUBLIC_BASE_URL }, now }),
      { status: 503, code: 'SESSION_UNAVAILABLE' },
    )
    expectFailure(
      () => issueApiWriteCsrfToken({ request: requestWith(), session, env: { ZURI_SESSION_SECRET: secret }, now }),
      { status: 503, code: 'SESSION_UNAVAILABLE' },
    )
    expectFailure(
      () => issueApiWriteCsrfToken({ request: requestWith(), session, env: { ...env, PUBLIC_BASE_URL: 'https://zuri.example/app' }, now }),
      { status: 503, code: 'SESSION_UNAVAILABLE' },
    )
    expectFailure(
      () => issueApiWriteCsrfToken({ request: requestWith(), session, env: { ...env, PUBLIC_BASE_URL: 'not-an-origin' }, now }),
      { status: 503, code: 'SESSION_UNAVAILABLE' },
    )
  })

  it('allows only the contracted same-origin signal when issuer Origin is absent', () => {
    const session = liveSession()
    expect(issueApiWriteCsrfToken({
      request: requestWith({ origin: undefined, headers: { 'sec-fetch-site': 'same-origin' } }),
      session,
      env,
      now,
    })).toEqual(expect.objectContaining({ token: expect.any(String) }))

    expect(issueApiWriteCsrfToken({
      request: requestWith({ origin: undefined, headers: { referer: 'https://zuri.example/businesses' } }),
      session,
      env,
      now,
    })).toEqual(expect.objectContaining({ token: expect.any(String) }))

    for (const request of [
      requestWith({ origin: undefined, headers: { host: 'zuri.example' } }),
      requestWith({ origin: 'null' }),
      requestWith({ origin: 'https://evil.example' }),
      requestWith({ origin: undefined, headers: { referer: 'https://evil.example/' } }),
    ]) {
      expectFailure(
        () => issueApiWriteCsrfToken({ request, session, env, now }),
        { status: 403, code: 'CSRF_INVALID' },
      )
    }
  })

  it('requires the exact configured Origin for every mutation', () => {
    const session = liveSession()
    const issueRequest = requestWith()
    const issued = issueApiWriteCsrfToken({ request: issueRequest, session, env, now })

    expect(assertApiWriteCsrfToken({ request: issueRequest, token: issued.token, session, env, now })).toBe(true)
    for (const request of [
      requestWith({ origin: undefined, headers: { 'sec-fetch-site': 'same-origin' } }),
      requestWith({ origin: 'null' }),
      requestWith({ origin: 'https://evil.example' }),
      requestWith({ origin: undefined, headers: { host: 'zuri.example', 'x-forwarded-host': 'zuri.example' } }),
    ]) {
      expectFailure(
        () => assertApiWriteCsrfToken({ request, token: issued.token, session, env, now }),
        { status: 403, code: 'CSRF_INVALID' },
      )
    }
  })
})
