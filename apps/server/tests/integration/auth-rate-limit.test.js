// @req FR-296, FR-297 — password login and TOTP verification use durable
//   per-identifier, per-address and per-Person windows before credential/code checks.
// @spec SEC-026, SEC-008, FR-224
// Security context: SEC-026 and FR-191 require authentication refusals not to reveal account existence.
// @tested tests/integration/auth-rate-limit.test.js
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { consumeRateLimit, passwordLoginRateLimitKeys } from '@/modules/identity/rate-limit'
import { POST as login } from '@/app/api/auth/login/route'
import { POST as verifyTotp } from '@/app/api/auth/mfa/totp/verify/route'
import { POST as stepUp } from '@/app/api/auth/step-up/route'
import { POST as webauthnStepUp } from '@/app/api/auth/webauthn/step-up/route'
import { makeViewer } from '../factories/viewer'

const fakes = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  confirmTotpEnrollment: vi.fn(),
  verifyMfaChallenge: vi.fn(),
  consumeTotpVerificationRateLimit: vi.fn(),
  consumeTotpVerificationRateLimitFallback: null,
  stepUpWithPasskey: vi.fn(),
}))

vi.mock('@/modules/identity/auth-service', () => ({
  AUTH_SESSION_COOKIE: 'zuri_session',
  SESSION_MAX_AGE_SECONDS: 7 * 24 * 60 * 60,
  authenticateUser: fakes.authenticateUser,
  hashSessionToken: vi.fn(() => 'session-token-hash'),
}))

vi.mock('@/modules/identity/mfa-service', () => ({
  confirmTotpEnrollment: fakes.confirmTotpEnrollment,
  verifyMfaChallenge: fakes.verifyMfaChallenge,
}))

vi.mock('@/modules/identity/rate-limit', async importOriginal => {
  const actual = await importOriginal()
  fakes.consumeTotpVerificationRateLimitFallback = actual.consumeTotpVerificationRateLimit
  return {
    ...actual,
    consumeTotpVerificationRateLimit: fakes.consumeTotpVerificationRateLimit,
  }
})

vi.mock('@/modules/identity/passkey-service', () => ({
  stepUpWithPasskey: fakes.stepUpWithPasskey,
}))

const buckets = new Set()
const people = new Set()
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex')

function loginHeaders(address, { withForwardedFor = true, forwardedFor } = {}) {
  const headers = new Headers({ 'content-type': 'application/json' })
  if (withForwardedFor) headers.set('x-forwarded-for', forwardedFor ?? `203.0.113.254, ${address}`)
  return headers
}

function loginKeys(username, address, options) {
  return passwordLoginRateLimitKeys(username, loginHeaders(address, options))
}

function totpKey(personId) {
  return `AUTH_RATE_LIMIT:MFA:TOTP_PERSON:${digest(personId)}`
}

function rememberLogin(username, address, options) {
  const keys = loginKeys(username, address, options)
  Object.values(keys).filter(Boolean).forEach(key => buckets.add(key))
  return keys
}

function loginRequest(username, address = '198.51.100.111', options) {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: loginHeaders(address, options),
    body: JSON.stringify({ username, password: 'test-password' }),
  })
}

function totpRequest(path, body) {
  return new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const invalidCredentials = { success: false, error: 'INVALID_CREDENTIALS' }
const authenticated = {
  success: true,
  token: 'zuri_sess.test-token',
  user: { id: 'person-test', code: 'PER-TEST', displayName: 'Test Person' },
}

describe('durable authentication rate limits (FR-296 and FR-297)', () => {
  beforeEach(() => {
    buckets.clear()
    people.clear()
    vi.stubEnv('ZURI_TRUSTED_PROXY_HOPS', '1')
    fakes.authenticateUser.mockReset().mockResolvedValue(invalidCredentials)
    fakes.confirmTotpEnrollment.mockReset().mockResolvedValue({ factorId: 'factor-test', status: 'ACTIVE' })
    fakes.verifyMfaChallenge.mockReset().mockResolvedValue({ verified: false })
    fakes.consumeTotpVerificationRateLimit.mockReset().mockImplementation((...args) => (
      fakes.consumeTotpVerificationRateLimitFallback(...args)
    ))
    fakes.stepUpWithPasskey.mockReset().mockResolvedValue({
      elevated: true,
      assuranceLevel: 'AAL2',
      elevatedUntil: new Date('2026-11-08T00:15:00.000Z'),
    })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    if (buckets.size) await prisma.rateLimitBucket.deleteMany({ where: { key: { in: [...buckets] } } })
    if (people.size) await prisma.person.deleteMany({ where: { id: { in: [...people] } } })
  })

  it('refuses the eleventh password attempt for the same normalized identifier and address', async () => {
    const username = `person-${randomUUID()}@example.test`
    const address = '198.51.100.31'
    rememberLogin(username, address)

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await login(loginRequest(username, address))
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual(invalidCredentials)
    }

    const response = await login(loginRequest(`  ${username.toUpperCase()}  `, address))
    const body = await response.json()
    expect(response.status).toBe(429)
    expect(body).toMatchObject({ success: false, error: 'LOGIN_RATE_LIMITED' })
    expect(body.retryAfterSeconds).toBeGreaterThan(0)
    expect(response.headers.get('retry-after')).toBe(String(body.retryAfterSeconds))
    expect(fakes.authenticateUser).toHaveBeenCalledTimes(10)
  })

  it('allows a different address until the normalized identifier bucket is exhausted', async () => {
    const username = `distributed-${randomUUID()}@example.test`
    const addresses = Array.from({ length: 51 }, (_, index) => `203.0.113.${index + 1}`)
    addresses.forEach(address => rememberLogin(username, address))

    for (const address of addresses.slice(0, 50)) {
      const response = await login(loginRequest(username, address))
      expect(response.status).toBe(401)
    }

    const response = await login(loginRequest(username, addresses[50]))
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ success: false, error: 'LOGIN_RATE_LIMITED' })
    expect(fakes.authenticateUser).toHaveBeenCalledTimes(50)
  })

  it('stops after the first refused bucket so one address cannot exhaust another address for the identifier', async () => {
    const username = `short-circuit-${randomUUID()}@example.test`
    const firstAddress = '198.51.100.45'
    const secondAddress = '198.51.100.46'
    rememberLogin(username, firstAddress)
    rememberLogin(username, secondAddress)

    for (let attempt = 0; attempt < 50; attempt += 1) {
      const response = await login(loginRequest(username, firstAddress))
      expect(response.status).toBe(attempt < 10 ? 401 : 429)
    }

    const response = await login(loginRequest(username, secondAddress))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(invalidCredentials)
    expect(fakes.authenticateUser).toHaveBeenCalledTimes(11)
  })

  it('uses the proxy-appended address regardless of a spoofed leftmost forwarded hop', async () => {
    const username = `spoofed-hop-${randomUUID()}@example.test`
    const address = '198.51.100.47'
    rememberLogin(username, address)

    for (let attempt = 0; attempt < 10; attempt += 1) {
      const response = await login(loginRequest(username, address, {
        forwardedFor: `203.0.113.${attempt + 1}, ${address}`,
      }))
      expect(response.status).toBe(401)
    }

    const response = await login(loginRequest(username, address, {
      forwardedFor: `192.0.2.99, ${address}`,
    }))
    expect(response.status).toBe(429)
    expect(fakes.authenticateUser).toHaveBeenCalledTimes(10)
  })

  it('uses the configured trusted-proxy hop count and treats a short chain as unknown', async () => {
    vi.stubEnv('ZURI_TRUSTED_PROXY_HOPS', '2')
    const username = `proxy-hops-${randomUUID()}@example.test`
    const chain = '203.0.113.201, 198.51.100.77, 10.0.0.1'
    const options = { forwardedFor: chain }
    const keys = rememberLogin(username, '', options)

    expect((await login(loginRequest(username, '', options))).status).toBe(401)
    expect((await prisma.rateLimitBucket.findUnique({ where: { key: keys.address } })).count).toBe(1)

    const oneHopKeys = passwordLoginRateLimitKeys(username, loginHeaders('', options), { ZURI_TRUSTED_PROXY_HOPS: '1' })
    const defaultHopKeys = passwordLoginRateLimitKeys(username, loginHeaders('', options), {})
    expect(defaultHopKeys.address).toBe(oneHopKeys.address)
    expect(await prisma.rateLimitBucket.findUnique({ where: { key: oneHopKeys.address } })).toBeNull()

    const shortChainKeys = passwordLoginRateLimitKeys(username, loginHeaders('', { forwardedFor: '198.51.100.77' }))
    expect(shortChainKeys.identifierAddress).toBeNull()
    expect(shortChainKeys.address).toBeNull()
  })

  it('does not share an address bucket when forwarded client address is missing', async () => {
    for (let attempt = 0; attempt < 201; attempt += 1) {
      const username = `junk-${randomUUID()}@example.test`
      rememberLogin(username, '', { withForwardedFor: false })
      const response = await login(loginRequest(username, '', { withForwardedFor: false }))
      expect(response.status).toBe(401)
    }

    const target = `target-${randomUUID()}@example.test`
    const targetKeys = rememberLogin(target, '', { withForwardedFor: false })
    expect(targetKeys.identifierAddress).toBeNull()
    expect(targetKeys.address).toBeNull()
    const response = await login(loginRequest(target, '', { withForwardedFor: false }))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual(invalidCredentials)
    expect(fakes.authenticateUser).toHaveBeenCalledTimes(202)
  })

  it('returns the same 429 body for known, disabled, and unknown identifiers after each reaches authentication', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const now = new Date('2026-11-08T00:00:00.000Z')
    vi.setSystemTime(now)
    const known = `known-${randomUUID()}@example.test`
    const unknown = `missing-${randomUUID()}@example.test`
    const disabled = `disabled-${randomUUID()}@example.test`
    const address = '198.51.100.88'
    const disabledPerson = await prisma.person.create({
      data: {
        code: `PSN-DISABLED-${randomUUID()}`,
        displayName: 'Disabled Login Person',
        email: disabled,
        accessDisabledAt: now,
      },
    })
    people.add(disabledPerson.id)
    rememberLogin(known, address)
    rememberLogin(unknown, address)
    rememberLogin(disabled, address)

    fakes.authenticateUser.mockImplementation(async ({ username }) => {
      if (username === disabled) {
        const row = await prisma.person.findUnique({ where: { id: disabledPerson.id }, select: { accessDisabledAt: true } })
        expect(row.accessDisabledAt).toEqual(now)
      }
      return username === known ? authenticated : invalidCredentials
    })

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await login(loginRequest(known, address))).status).toBe(200)
      expect((await login(loginRequest(disabled, address))).status).toBe(401)
      expect((await login(loginRequest(unknown, address))).status).toBe(401)
    }
    expect(fakes.authenticateUser).toHaveBeenCalledTimes(30)

    const knownResponse = await login(loginRequest(known, address))
    const disabledResponse = await login(loginRequest(disabled, address))
    const unknownResponse = await login(loginRequest(unknown, address))
    const knownBody = await knownResponse.json()
    const disabledBody = await disabledResponse.json()
    const unknownBody = await unknownResponse.json()

    expect(knownResponse.status).toBe(429)
    expect(disabledResponse.status).toBe(429)
    expect(unknownResponse.status).toBe(429)
    expect(knownBody).toEqual({ success: false, error: 'LOGIN_RATE_LIMITED', retryAfterSeconds: 900 })
    expect(disabledBody).toEqual(knownBody)
    expect(unknownBody).toEqual(knownBody)
    expect(unknownResponse.headers.get('retry-after')).toBe(knownResponse.headers.get('retry-after'))
    expect(disabledResponse.headers.get('retry-after')).toBe(knownResponse.headers.get('retry-after'))
    expect(fakes.authenticateUser).toHaveBeenCalledTimes(30)
  })

  it('opens all three password windows after fifteen minutes', async () => {
    const username = `window-${randomUUID()}@example.test`
    const address = '198.51.100.44'
    const keys = rememberLogin(username, address)

    for (let attempt = 0; attempt < 10; attempt += 1) await login(loginRequest(username, address))
    expect((await login(loginRequest(username, address))).status).toBe(429)

    await prisma.rateLimitBucket.updateMany({
      where: { key: { in: Object.values(keys) } },
      data: { windowStart: new Date(Date.now() - 901_000) },
    })

    const response = await login(loginRequest(username, address))
    expect(response.status).toBe(401)
    for (const key of Object.values(keys)) {
      expect((await prisma.rateLimitBucket.findUnique({ where: { key } })).count).toBe(1)
    }
  })

  it('counts successful password logins before returning the session', async () => {
    const username = `success-${randomUUID()}@example.test`
    const address = '198.51.100.64'
    rememberLogin(username, address)
    fakes.authenticateUser.mockResolvedValue(authenticated)

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect((await login(loginRequest(username, address))).status).toBe(200)
    }

    const response = await login(loginRequest(username, address))
    expect(response.status).toBe(429)
    expect(await response.json()).toMatchObject({ success: false, error: 'LOGIN_RATE_LIMITED' })
    expect(fakes.authenticateUser).toHaveBeenCalledTimes(10)
  })

  it('shares the five-attempt TOTP window across enrollment confirmation and TOTP step-up', async () => {
    const personId = randomUUID()
    buckets.add(totpKey(personId))
    const viewer = makeViewer({
      principal: { id: personId, code: 'PER-MFA-TEST', displayName: 'MFA Test Person' },
    })

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await verifyTotp(totpRequest('/api/auth/mfa/totp/verify', {
        factorId: 'factor-test', code: '123456',
      }), { viewer })
      expect(response.status).toBe(200)
    }

    const response = await stepUp(totpRequest('/api/auth/step-up', { code: '123456' }), { viewer })
    const body = await response.json()
    expect(response.status).toBe(429)
    expect(body).toMatchObject({ success: false, error: 'MFA_RATE_LIMITED' })
    expect(body.retryAfterSeconds).toBeGreaterThan(0)
    expect(response.headers.get('retry-after')).toBe(String(body.retryAfterSeconds))
    expect(fakes.verifyMfaChallenge).not.toHaveBeenCalled()
  })

  it('returns 503 when the TOTP enrollment limiter fails for a non-rate-limit reason', async () => {
    const personId = randomUUID()
    const viewer = makeViewer({ principal: { id: personId, code: 'PER-MFA-FAIL', displayName: 'MFA Failure' } })
    fakes.consumeTotpVerificationRateLimit.mockRejectedValueOnce(new Error('database unavailable'))

    const response = await verifyTotp(totpRequest('/api/auth/mfa/totp/verify', {
      factorId: 'factor-test', code: '123456',
    }), { viewer })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ success: false, error: 'AUTH_UNAVAILABLE' })
    expect(fakes.confirmTotpEnrollment).not.toHaveBeenCalled()
  })

  it('returns 503 when the TOTP step-up limiter fails for a non-rate-limit reason', async () => {
    const personId = randomUUID()
    const viewer = makeViewer({ principal: { id: personId, code: 'PER-MFA-STEP-FAIL', displayName: 'MFA Step Failure' } })
    fakes.consumeTotpVerificationRateLimit.mockRejectedValueOnce(new Error('database unavailable'))

    const response = await stepUp(totpRequest('/api/auth/step-up', { code: '123456' }), { viewer })

    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ success: false, error: 'AUTH_UNAVAILABLE' })
    expect(fakes.verifyMfaChallenge).not.toHaveBeenCalled()
  })

  it('does not consume the TOTP bucket during WebAuthn step-up', async () => {
    const personId = randomUUID()
    const key = totpKey(personId)
    const viewer = makeViewer({ principal: { id: personId, code: 'PER-PASSKEY-TEST', displayName: 'Passkey Test' } })
    buckets.add(key)
    await consumeRateLimit({ key, limit: 5, windowSeconds: 900, weight: 5 })

    const response = await webauthnStepUp(totpRequest('/api/auth/webauthn/step-up', { credential: {} }), {
      viewer,
      tokenHash: 'passkey-session-token-hash',
    })

    expect(response.status).toBe(200)
    expect(fakes.stepUpWithPasskey).toHaveBeenCalledTimes(1)
    expect((await prisma.rateLimitBucket.findUnique({ where: { key } })).count).toBe(5)
  })
})
