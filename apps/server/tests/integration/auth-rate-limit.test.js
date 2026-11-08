// @req FR-296, FR-297 — password login and TOTP verification use durable
//   per-identifier, per-address and per-Person windows before credential/code checks.
// @spec SEC-026, SEC-008, FR-224
// Security context: SEC-026 and FR-191 require authentication refusals not to reveal account existence.
// @tested tests/integration/auth-rate-limit.test.js
import { createHash, randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { consumeRateLimit } from '@/modules/identity/rate-limit'
import { POST as login } from '@/app/api/auth/login/route'
import { POST as verifyTotp } from '@/app/api/auth/mfa/totp/verify/route'
import { POST as stepUp } from '@/app/api/auth/step-up/route'
import { makeViewer } from '../factories/viewer'

const fakes = vi.hoisted(() => ({
  authenticateUser: vi.fn(),
  confirmTotpEnrollment: vi.fn(),
  verifyMfaChallenge: vi.fn(),
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

const buckets = new Set()
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex')

function loginKeys(username, address) {
  const identifierHash = digest(typeof username === 'string' ? username.trim().toLowerCase() : '')
  const addressHash = digest(address)
  return {
    identifierAddress: `AUTH_RATE_LIMIT:LOGIN:IDENTIFIER_ADDRESS:${identifierHash}:${addressHash}`,
    identifier: `AUTH_RATE_LIMIT:LOGIN:IDENTIFIER:${identifierHash}`,
    address: `AUTH_RATE_LIMIT:LOGIN:ADDRESS:${addressHash}`,
  }
}

function totpKey(personId) {
  return `AUTH_RATE_LIMIT:MFA:TOTP_PERSON:${digest(personId)}`
}

function rememberLogin(username, address) {
  const keys = loginKeys(username, address)
  Object.values(keys).forEach(key => buckets.add(key))
  return keys
}

function loginRequest(username, address = '198.51.100.111') {
  return new Request('http://localhost/api/auth/login', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-forwarded-for': `${address}, 10.0.0.1`,
    },
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
    fakes.authenticateUser.mockReset().mockResolvedValue(invalidCredentials)
    fakes.confirmTotpEnrollment.mockReset().mockResolvedValue({ factorId: 'factor-test', status: 'ACTIVE' })
    fakes.verifyMfaChallenge.mockReset().mockResolvedValue({ verified: false })
  })

  afterEach(async () => {
    vi.useRealTimers()
    if (buckets.size) await prisma.rateLimitBucket.deleteMany({ where: { key: { in: [...buckets] } } })
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

  it('returns the same 429 body for an identifier the auth boundary treats as known or unknown', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const now = new Date('2026-11-08T00:00:00.000Z')
    vi.setSystemTime(now)
    const known = `known-${randomUUID()}@example.test`
    const unknown = `missing-${randomUUID()}@example.test`
    const address = '198.51.100.88'
    const keys = rememberLogin(known, address)
    rememberLogin(unknown, address)

    fakes.authenticateUser.mockImplementation(({ username }) => Promise.resolve(
      username === known ? authenticated : invalidCredentials,
    ))
    await consumeRateLimit({ key: keys.address, limit: 200, windowSeconds: 900, now: () => now, weight: 200 })

    const knownResponse = await login(loginRequest(known, address))
    const unknownResponse = await login(loginRequest(unknown, address))
    const knownBody = await knownResponse.json()
    const unknownBody = await unknownResponse.json()

    expect(knownResponse.status).toBe(429)
    expect(unknownResponse.status).toBe(429)
    expect(knownBody).toEqual({ success: false, error: 'LOGIN_RATE_LIMITED', retryAfterSeconds: 900 })
    expect(unknownBody).toEqual(knownBody)
    expect(unknownResponse.headers.get('retry-after')).toBe(knownResponse.headers.get('retry-after'))
    expect(fakes.authenticateUser).not.toHaveBeenCalled()
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
})
