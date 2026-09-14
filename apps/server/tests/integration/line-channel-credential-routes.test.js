// @req FR-224 — the credential-write gate on every credential route: an AAL1 session,
//   an expired elevation and a Person with no factor are refused before any LINE
//   call; the rate limit answers 429 with retryAfterSeconds (proof 4).
// @req FR-223, FR-226 — connect, rotate, validate and revoke through the routes,
//   with no material in any response, a no-store header, and the legacy
//   deployment-secret body unchanged.
// @spec ADR-089 D2, D4, D5, D6, D7 and proofs 1, 4, 5, 6; SEC-030
// @tested tests/integration/line-channel-credential-routes.test.js
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { AUTH_SESSION_COOKIE, hashSessionToken } from '@/modules/identity/auth-service'
import { LINE_API } from '@/platform/integrations/providers/line/line-channel-admin-port'
import { connectLineOaAccount } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { findLeaks, generateLineChannelBundle, secretNeedles } from '../helpers/credential-vault-fixtures'

const { resolveRequestViewer } = vi.hoisted(() => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))

const { POST: CONNECT } = await import('@/app/api/line-oa/connections/route')
const { POST: ROTATE } = await import('@/app/api/line-oa/connections/[id]/credential/route')
const { POST: REVOKE } = await import('@/app/api/line-oa/connections/[id]/credential/revoke/route')
const { POST: VALIDATE } = await import('@/app/api/line-oa/connections/[id]/credential/validate/route')

const ENV_KEYS = ['ZURI_SECRET_STORE', 'ZURI_SECRET_KEK', 'ZURI_SECRET_KEK_VERSION']
const savedEnv = {}
const bundles = []
const responses = []
let business, person, viewer, sessionToken

/** Stub LINE: pairs in `line` mint `tok:<destination>` tokens; bot info answers with the destination. */
const line = new Map()
const fetchCalls = []
async function fakeFetch(url, init) {
  fetchCalls.push(url)
  const reply = (status, body) => ({ status, ok: status < 300, json: async () => body })
  if (url === LINE_API.token) {
    const form = new URLSearchParams(init.body)
    const destination = line.get(`${form.get('client_id')}:${form.get('client_secret')}`)
    return destination ? reply(200, { access_token: `tok-${destination}-${'a'.repeat(20)}`, expires_in: 900 }) : reply(400, { error: 'invalid_client' })
  }
  if (url === LINE_API.botInfo) {
    const match = /^Bearer tok-(U[0-9a-f]{32})-/.exec(init.headers.Authorization)
    return match ? reply(200, { userId: match[1], basicId: '@route', displayName: 'Route shop', chatMode: 'bot', markAsReadMode: 'auto' }) : reply(401, {})
  }
  return reply(500, {})
}

function channel() {
  const bundle = generateLineChannelBundle()
  bundles.push(bundle)
  const destination = `U${randomBytes(16).toString('hex')}`
  line.set(`${bundle.channelId}:${bundle.channelSecret}`, destination)
  return { bundle, destination }
}

async function call(handler, url, body, { id, token = sessionToken, raw } = {}) {
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { cookie: `${AUTH_SESSION_COOKIE}=${token}` } : {}) },
    body: raw ?? JSON.stringify(body),
  })
  const response = await handler(request, { params: { id } })
  const json = await response.json()
  responses.push(json)
  return { status: response.status, json, headers: response.headers }
}

async function newSession({ elevatedFor = 900, assuranceLevel = 'AAL2' } = {}) {
  const token = randomBytes(24).toString('base64url')
  await prisma.session.create({
    data: {
      personId: person.id, tokenHash: hashSessionToken(token), status: 'ACTIVE', assuranceLevel,
      elevatedUntil: elevatedFor === null ? null : new Date(Date.now() + elevatedFor * 1000),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  return token
}

describe('LINE credential routes (FR-223, FR-224, FR-226)', () => {
  beforeAll(async () => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
    process.env.ZURI_SECRET_STORE = 'envelope'
    process.env.ZURI_SECRET_KEK = randomBytes(32).toString('hex')
    process.env.ZURI_SECRET_KEK_VERSION = '1'
    vi.stubGlobal('fetch', fakeFetch)
    const portfolio = await createPortfolio({ code: 'PF-CRED-ROUTE', name: 'Cred routes' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-CRED-ROUTE', name: 'Cred routes' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-CRED-ROUTE', name: 'Cred routes' })
    person = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'Route owner' } })
    await prisma.mfaFactor.create({ data: { personId: person.id, type: 'TOTP', secret: 'mfa.v0.sealed-in-test.placeholder.value', status: 'ACTIVE' } })
    viewer = makeViewer({ principal: { id: person.id, code: person.code, displayName: person.displayName }, visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['line-oa'] })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  beforeEach(async () => {
    resolveRequestViewer.mockResolvedValue(viewer)
    fetchCalls.length = 0
    await prisma.rateLimitBucket.deleteMany({})
    sessionToken = await newSession()
  })

  it('connects write-only and answers metadata with Cache-Control: no-store', async () => {
    const { bundle, destination } = channel()
    const { status, json, headers } = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'Route main', ...bundle })
    expect(status).toBe(200)
    expect(headers.get('cache-control')).toBe('no-store')
    expect(json).toMatchObject({ connection: { destination, status: 'ACTIVE' }, credential: { status: 'ACTIVE', version: 1, secretStore: 'ENVELOPE', displayHint: bundle.channelId.slice(-4) }, claim: { status: 'CLAIMED' } })
  })

  describe('the step-up gate refuses before any LINE call (proof 4)', () => {
    it('an AAL1 session', async () => {
      const { bundle } = channel()
      const token = await newSession({ elevatedFor: null, assuranceLevel: 'AAL1' })
      const { status, json } = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'x', ...bundle }, { token })
      expect({ status, error: json.error }).toEqual({ status: 403, error: 'ASSURANCE_LEVEL_INSUFFICIENT' })
      expect(fetchCalls).toEqual([])
    })

    it('an expired elevation, even though the session row still says AAL2', async () => {
      const { bundle } = channel()
      const token = await newSession({ elevatedFor: -1, assuranceLevel: 'AAL2' })
      const { status, json } = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'x', ...bundle }, { token })
      expect({ status, error: json.error }).toEqual({ status: 403, error: 'ASSURANCE_LEVEL_INSUFFICIENT' })
      expect(fetchCalls).toEqual([])
    })

    it('no session cookie, or another person’s session', async () => {
      const { bundle } = channel()
      expect((await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'x', ...bundle }, { token: null })).status).toBe(403)
      const stranger = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'Stranger' } })
      const token = randomBytes(24).toString('base64url')
      await prisma.session.create({ data: { personId: stranger.id, tokenHash: hashSessionToken(token), status: 'ACTIVE', assuranceLevel: 'AAL2', elevatedUntil: new Date(Date.now() + 900_000), expiresAt: new Date(Date.now() + 3600_000) } })
      expect((await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'x', ...bundle }, { token })).status).toBe(403)
      expect(fetchCalls).toEqual([])
    })

    it('a Person with no ACTIVE TOTP factor is sent to enrolment', async () => {
      const bare = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'No factor' } })
      resolveRequestViewer.mockResolvedValue(makeViewer({ principal: { id: bare.id, code: bare.code, displayName: bare.displayName }, visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['line-oa'] }))
      const { bundle } = channel()
      const { status, json } = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'x', ...bundle })
      expect(status).toBe(403)
      expect(json).toEqual({ error: 'MFA_FACTOR_REQUIRED', details: [{ code: 'MFA_FACTOR_REQUIRED', enrolmentPath: '/api/auth/mfa/totp/enroll' }] })
      expect(fetchCalls).toEqual([])
    })
  })

  it('rate-limits five writes in fifteen minutes and counts a rejected validation twice', async () => {
    const { bundle } = channel()
    const wrong = { ...bundle, channelSecret: generateLineChannelBundle().channelSecret }
    for (let i = 0; i < 2; i += 1) {
      const { status, json } = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'x', ...wrong })
      expect({ status, error: json.error }).toEqual({ status: 422, error: 'LINE_CREDENTIALS_REJECTED' })
    }
    // Two rejections spent four of five slots; the next request is the fifth.
    expect((await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'x', ...wrong })).status).toBe(422)
    fetchCalls.length = 0
    const limited = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'x', ...bundle })
    expect(limited.status).toBe(429)
    expect(limited.json).toMatchObject({ error: 'CREDENTIAL_RATE_LIMITED', retryAfterSeconds: expect.any(Number) })
    expect(Number(limited.headers.get('retry-after'))).toBe(limited.json.retryAfterSeconds)
    expect(fetchCalls).toEqual([])
  })

  it('refuses an oversized or malformed body without echoing it, before the gate', async () => {
    const big = await call(CONNECT, 'http://local/api/line-oa/connections', null, { raw: JSON.stringify({ channelSecret: 'a'.repeat(17 * 1024) }) })
    expect(big).toMatchObject({ status: 413, json: { error: 'CREDENTIAL_INPUT_TOO_LARGE' } })
    const broken = await call(CONNECT, 'http://local/api/line-oa/connections', null, { raw: '{"channelSecret": "abc' })
    expect(broken).toMatchObject({ status: 400, json: { error: 'CREDENTIAL_INPUT_INVALID' } })
    const { bundle } = channel()
    const invalid = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'x', ...bundle, channelSecret: `${bundle.channelSecret}XYZ` })
    expect(invalid.json).toEqual({ error: 'CREDENTIAL_INPUT_INVALID' })
  })

  it('keeps the FR-149 deployment-secret body working', async () => {
    const { status, json } = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'Mounted', destination: `U${randomBytes(16).toString('hex')}`, secretRef: 'deployment-secret:mounted-route' })
    expect(status).toBe(200)
    expect(JSON.stringify(json)).not.toContain('deployment-secret:')
  })

  it('rotates against the same bot only, validates, and revokes with the account fenced', async () => {
    const { bundle, destination } = channel()
    const connected = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'Lifecycle', ...bundle })
    const id = connected.json.connection.id
    const account = await connectLineOaAccount({ businessId: business.id, integrationConnectionId: id, code: `oa-route-${randomBytes(3).toString('hex')}`, displayName: 'Route' }, { viewer })

    const other = channel()
    const mismatch = await call(ROTATE, `http://local/api/line-oa/connections/${id}/credential`, other.bundle, { id })
    expect(mismatch).toMatchObject({ status: 422, json: { error: 'LINE_CHANNEL_MISMATCH' } })

    const reissued = { ...generateLineChannelBundle(), channelId: bundle.channelId }
    bundles.push(reissued)
    line.set(`${reissued.channelId}:${reissued.channelSecret}`, destination)
    const rotated = await call(ROTATE, `http://local/api/line-oa/connections/${id}/credential`, reissued, { id })
    expect(rotated).toMatchObject({ status: 200, json: { credential: { status: 'ACTIVE', version: 2 } } })

    await prisma.rateLimitBucket.deleteMany({})
    const validated = await call(VALIDATE, `http://local/api/line-oa/connections/${id}/credential/validate`, {}, { id })
    expect(validated).toMatchObject({ status: 200, json: { credential: { status: 'ACTIVE' }, bot: { basicId: '@route' } } })
    expect((await prisma.integrationCredential.findUnique({ where: { connectionId: id } })).lastValidationCode).toBe('LINE_OK')

    expect((await call(REVOKE, `http://local/api/line-oa/connections/${id}/credential/revoke`, { reason: 'lost device' }, { id })).status).toBe(400)
    await prisma.lineOaAccount.update({ where: { id: account.id }, data: { serverEnabled: true, status: 'CONNECTED' } })
    const revoked = await call(REVOKE, `http://local/api/line-oa/connections/${id}/credential/revoke`, { reason: 'lost device', confirmation: 'REVOKE' }, { id })
    expect(revoked).toMatchObject({ status: 200, json: { credential: { status: 'REVOKED' } } })
    expect(await prisma.lineOaAccount.findUnique({ where: { id: account.id } })).toMatchObject({ serverEnabled: false })
    expect(await prisma.integrationSecretEnvelope.count({ where: { connectionId: id } })).toBe(0)
    const again = await call(VALIDATE, `http://local/api/line-oa/connections/${id}/credential/validate`, {}, { id })
    expect(again).toMatchObject({ status: 409, json: { error: 'CREDENTIAL_REENTRY_REQUIRED' } })

    const stranger = makeViewer({ visibleBusinessIds: [], ownedBusinessIds: [], visibleDomains: ['line-oa'] })
    resolveRequestViewer.mockResolvedValue(stranger)
    expect((await call(ROTATE, `http://local/api/line-oa/connections/${id}/credential`, reissued, { id })).status).toBe(404)
  })

  it('no response carried material, and no audit row holds any (proof 1)', async () => {
    const needles = [...new Set(bundles.flatMap(secretNeedles))]
    const audit = await prisma.auditEvent.findMany({ where: { entityType: 'INTEGRATION_CREDENTIAL' } })
    expect(audit.length).toBeGreaterThan(0)
    expect(findLeaks({ responses, audit, credentials: await prisma.integrationCredential.findMany(), versions: await prisma.integrationCredentialVersion.findMany(), buckets: await prisma.rateLimitBucket.findMany() }, needles)).toEqual([])
  })
})
