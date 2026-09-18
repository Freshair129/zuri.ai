import { randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { GET } from '@/app/api/auth/csrf/route'
import { generateSessionToken, hashSessionToken } from '@/modules/identity/auth-service'
import { createSessionPort } from '@/modules/identity/session-port'
import { assertApiWriteCsrfToken } from '@/modules/identity/api-write-csrf'

// @req FR-252 — real route, live persisted session and API-write parser compose.
// @spec ADR-097
// @tested tests/integration/api-write-csrf.test.js

const personId = randomUUID()
const secret = 'csrf-integration-fixture-secret-at-least-32-characters'
const origin = 'https://csrf.example'

function request(cookie) {
  return new Request(`${origin}/api/auth/csrf`, {
    headers: { cookie: `zuri_session=${cookie}`, origin },
  })
}

async function liveSession() {
  const id = randomUUID()
  const token = generateSessionToken(personId, { secret, sessionId: id })
  await prisma.session.create({ data: {
    id, personId, tokenHash: hashSessionToken(token),
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
  } })
  return { id, token }
}

async function expectUnauthenticated(response) {
  expect(response.status).toBe(401)
  expect(response.headers.get('cache-control')).toBe('no-store')
  const body = await response.json()
  expect(body).toEqual({
    code: 'AUTH_REQUIRED', message: 'Authentication is required.',
    requestId: expect.any(String), retryable: false,
  })
  expect(response.headers.get('x-request-id')).toBe(body.requestId)
}

describe('FR-252 Identity CSRF live composition', () => {
  beforeAll(async () => {
    await prisma.person.create({ data: {
      id: personId, code: `P-CSRF-${personId}`, displayName: 'CSRF fixture',
    } })
  })
  beforeEach(() => {
    vi.stubEnv('ZURI_SESSION_SECRET', secret)
    vi.stubEnv('PUBLIC_BASE_URL', origin)
  })
  afterEach(() => vi.unstubAllEnvs())
  afterAll(async () => {
    await prisma.session.deleteMany({ where: { personId } })
    await prisma.person.delete({ where: { id: personId } })
  })

  it('issues through the real route, parses the token and refuses it after live revocation', async () => {
    const session = await liveSession()
    const req = request(session.token)
    const response = await GET(req)
    expect(response.status).toBe(200)
    const issued = await response.json()
    const port = createSessionPort()
    expect(assertApiWriteCsrfToken({
      request: req, token: issued.token, session: await port.read(req),
    })).toBe(true)
    expect(new Date(issued.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60 * 1000)

    await prisma.session.update({ where: { id: session.id }, data: { status: 'REVOKED' } })
    await expectUnauthenticated(await GET(req))
    const revoked = await port.read(req)
    expect(() => assertApiWriteCsrfToken({
      request: req, token: issued.token, session: revoked,
    })).toThrowError(expect.objectContaining({ code: 'AUTH_REQUIRED', status: 401 }))
  })

  it('refuses an expired persisted session even if the signed cookie is still valid', async () => {
    const session = await liveSession()
    await prisma.session.update({ where: { id: session.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    await expectUnauthenticated(await GET(request(session.token)))
  })

  it('refuses a cookie whose stored token hash has rotated', async () => {
    const session = await liveSession()
    await prisma.session.update({ where: { id: session.id }, data: { tokenHash: hashSessionToken(randomUUID()) } })
    await expectUnauthenticated(await GET(request(session.token)))
  })

  it('treats malformed percent-encoded cookies as invalid authentication', async () => {
    await expectUnauthenticated(await GET(request('%ZZ')))
  })
})
