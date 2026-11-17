import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { toBase64Url } from '@/modules/identity/webauthn'
import { POST as postLoginOptions } from '@/app/api/auth/webauthn/login/options/route'
import { POST as postLoginVerify } from '@/app/api/auth/webauthn/login/verify/route'

// @req FR-094, FR-095 — passkey sign-in limits are durable across requests and
//   fail with the same generic response before challenge or verification work.
// @spec ADR-045, SEC-018, SEC-026
// @tested tests/integration/passkey-login-rate-limit.test.js

function request(path, body, address) {
  const headers = new Headers({
    'content-type': 'application/json',
    host: 'localhost:3000',
    origin: 'http://localhost:3000',
  })
  if (address) headers.set('x-forwarded-for', address)
  return new Request(`http://localhost:3000${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

async function expectLimited(response) {
  expect(response.status).toBe(429)
  const body = await response.json()
  expect(body).toEqual({
    success: false,
    error: 'PASSKEY_LOGIN_RATE_LIMITED',
    retryAfterSeconds: expect.any(Number),
  })
  expect(Number.isInteger(body.retryAfterSeconds)).toBe(true)
  expect(body.retryAfterSeconds).toBeGreaterThan(0)
  expect(response.headers.get('retry-after')).toBe(String(body.retryAfterSeconds))
}

describe('passkey login rate limits', () => {
  it('limits options by client address while allowing a different address', async () => {
    const address = '198.51.100.41'
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await postLoginOptions(request('/api/auth/webauthn/login/options', {}, address))
      expect(response.status).toBe(200)
    }

    await expectLimited(await postLoginOptions(request('/api/auth/webauthn/login/options', {}, address)))

    const independentAddress = await postLoginOptions(
      request('/api/auth/webauthn/login/options', {}, '198.51.100.42'),
    )
    expect(independentAddress.status).toBe(200)
  })

  it('limits the normalized email bucket independently of changing client addresses', async () => {
    const email = `passkey-rate-${randomUUID()}@example.com`
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const address = `203.0.113.${attempt + 1}`
      const response = await postLoginOptions(request(
        '/api/auth/webauthn/login/options',
        { email: ` ${email.toUpperCase()} ` },
        address,
      ))
      expect(response.status).toBe(200)
    }

    await expectLimited(await postLoginOptions(request(
      '/api/auth/webauthn/login/options',
      { email },
      '203.0.113.21',
    )))
  })

  it('limits verification by address before verification work and keeps other addresses independent', async () => {
    const address = '192.0.2.71'
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const response = await postLoginVerify(request(
        '/api/auth/webauthn/login/verify',
        { credential: { id: `invalid-credential-${randomUUID()}` } },
        address,
      ))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({
        error: 'INVALID_PAYLOAD: Missing credential ID or response data',
      })
    }

    await expectLimited(await postLoginVerify(request(
      '/api/auth/webauthn/login/verify',
      { credential: { id: `invalid-credential-${randomUUID()}` } },
      address,
    )))

    const independentAddress = await postLoginVerify(request(
      '/api/auth/webauthn/login/verify',
      { credential: { id: `invalid-credential-${randomUUID()}` } },
      '192.0.2.72',
    ))
    expect(independentAddress.status).toBe(400)
    expect(await independentAddress.json()).toEqual({
      error: 'INVALID_PAYLOAD: Missing credential ID or response data',
    })
  })

  it('preserves the existing options 200 and verify 400/401 response shapes', async () => {
    const optionsResponse = await postLoginOptions(
      request('/api/auth/webauthn/login/options', {}, '192.0.2.81'),
    )
    expect(optionsResponse.status).toBe(200)
    const optionsBody = await optionsResponse.json()
    expect(optionsBody).toMatchObject({ success: true, options: { challenge: expect.any(String) } })

    const invalidResponse = await postLoginVerify(request(
      '/api/auth/webauthn/login/verify',
      { credential: {} },
      '192.0.2.82',
    ))
    expect(invalidResponse.status).toBe(400)
    expect(await invalidResponse.json()).toEqual({
      error: 'INVALID_PAYLOAD: Missing credential ID or response data',
    })

    const credentialId = `missing-passkey-${randomUUID()}`
    const clientDataJSON = JSON.stringify({ challenge: optionsBody.options.challenge })
    const unauthorizedResponse = await postLoginVerify(request(
      '/api/auth/webauthn/login/verify',
      {
        credential: {
          id: credentialId,
          response: { clientDataJSON: toBase64Url(Buffer.from(clientDataJSON)) },
        },
      },
      '192.0.2.83',
    ))
    expect(unauthorizedResponse.status).toBe(401)
    expect(await unauthorizedResponse.json()).toEqual({
      error: 'INVALID_CREDENTIALS: Passkey not found or revoked',
    })
  })

  it('does not consume a shared unknown bucket when address and identifier are absent', async () => {
    const before = await prisma.rateLimitBucket.count({
      where: { key: { startsWith: 'AUTH_RATE_LIMIT:PASSKEY_LOGIN:' } },
    })

    const response = await postLoginOptions(request('/api/auth/webauthn/login/options', {}))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      success: true,
      options: { challenge: expect.any(String) },
    })
    expect(await prisma.rateLimitBucket.count({
      where: { key: { startsWith: 'AUTH_RATE_LIMIT:PASSKEY_LOGIN:' } },
    })).toBe(before)
  })

  it('fails closed with 503 on limiter storage errors for both endpoints', async () => {
    const unavailableDb = {
      rateLimitBucket: {
        findUnique: async () => { throw new Error('rate limit store unavailable') },
      },
    }

    const optionsResponse = await postLoginOptions(
      request('/api/auth/webauthn/login/options', {}, '192.0.2.91'),
      { db: unavailableDb },
    )
    expect(optionsResponse.status).toBe(503)
    expect(await optionsResponse.json()).toEqual({ success: false, error: 'AUTH_UNAVAILABLE' })

    const verifyResponse = await postLoginVerify(
      request('/api/auth/webauthn/login/verify', { credential: { id: 'credential-id' } }, '192.0.2.92'),
      { db: unavailableDb },
    )
    expect(verifyResponse.status).toBe(503)
    expect(await verifyResponse.json()).toEqual({ success: false, error: 'AUTH_UNAVAILABLE' })
  })
})
