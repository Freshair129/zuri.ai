// @req FR-273, FR-274 — OAuth state/code custody, webhook signature validation,
//   one-time AAL2 reveal and payload-minimal idempotent receipts.
// @spec ADR-109 D1-D3; SDD-108; SDD-109; SEC-037
// @tested apps/server/src/app/oauth/notion/callback/route.js,
//   apps/server/src/app/api/integrations/notion/webhook/route.js
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeOperatorViewer, makeViewer } from '../factories/viewer'
import { AUTH_SESSION_COOKIE, hashSessionToken } from '@/modules/identity/auth-service'
import { credentialWriteKey, LINE_VALIDATION_KEY } from '@/modules/identity/rate-limit'
import { NOTION_API_VERSION, NOTION_OAUTH_TOKEN_URL } from '@/modules/integration/application/notion-oauth-service'
import { NOTION_WEBHOOK_BODY_LIMIT_BYTES, NOTION_WEBHOOK_TOKEN_ID } from '@/modules/integration/application/notion-webhook-service'
import { requireWritableSecretStore } from '@/platform/integrations/core/secret-store/dispatching-secret-manager'
import { findLeaks, secretNeedles } from '../helpers/credential-vault-fixtures'

const { resolveRequestViewer } = vi.hoisted(() => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))

const { GET: CONNECT } = await import('@/app/api/integrations/notion/connect/route')
const { GET: CALLBACK } = await import('@/app/oauth/notion/callback/route')
const { POST: WEBHOOK } = await import('@/app/api/integrations/notion/webhook/route')
const { POST: REVEAL } = await import('@/app/api/platform/integrations/notion/webhook-verification/reveal/route')
const { POST: RESET } = await import('@/app/api/platform/integrations/notion/webhook-verification/reset/route')

const ENV_KEYS = [
  'ZURI_SECRET_STORE', 'ZURI_SECRET_KEK', 'ZURI_SECRET_KEK_VERSION',
  'NOTION_CLIENT_ID', 'NOTION_CLIENT_SECRET', 'NOTION_REDIRECT_URI',
]
const savedEnv = {}
const fetchCalls = []
let business, owner, operator, ownerViewer, operatorViewer, ownerSession, operatorSession

const oauthMaterial = {
  accessToken: `secret_test_${randomBytes(24).toString('hex')}`,
  refreshToken: `nrt_test_${randomBytes(24).toString('hex')}`,
}
const workspaceId = randomUUID()

async function notionFetch(url, init) {
  fetchCalls.push({ url, init })
  if (url !== NOTION_OAUTH_TOKEN_URL) return { ok: false, status: 404, text: async () => '{}' }
  return new Response(JSON.stringify({
      access_token: oauthMaterial.accessToken,
      token_type: 'bearer',
      refresh_token: oauthMaterial.refreshToken,
      workspace_id: workspaceId,
      workspace_name: 'Test workspace',
    }), { status: 200, headers: { 'content-type': 'application/json' } })
}

async function newSession(person, { elevatedFor = 900, assuranceLevel = 'AAL2' } = {}) {
  const token = randomBytes(24).toString('base64url')
  await prisma.session.create({
    data: {
      personId: person.id,
      tokenHash: hashSessionToken(token),
      status: 'ACTIVE',
      assuranceLevel,
      elevatedUntil: elevatedFor === null ? null : new Date(Date.now() + elevatedFor * 1000),
      expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  return token
}

async function call(handler, url, { token = null, method = 'POST', raw, headers = {} } = {}) {
  const request = new Request(url, {
    method,
    headers: {
      ...(method === 'POST' ? { 'content-type': 'application/json' } : {}),
      ...(token ? { cookie: `${AUTH_SESSION_COOKIE}=${token}` } : {}),
      ...headers,
    },
    ...(raw === undefined ? {} : { body: raw }),
  })
  const response = await handler(request)
  const text = await response.text()
  let json = null
  try { json = text ? JSON.parse(text) : null } catch { /* redirect body is intentionally ignored */ }
  return { status: response.status, headers: response.headers, json, text }
}

async function clearCredentialLimits() {
  await prisma.rateLimitBucket.deleteMany({
    where: { key: { in: [credentialWriteKey(owner.id, business.id), credentialWriteKey(operator.id, null), LINE_VALIDATION_KEY] } },
  })
}

function sign(raw, token) {
  return `sha256=${createHmac('sha256', token).update(raw).digest('hex')}`
}

describe('Notion OAuth and webhook boundary (FR-273, FR-274)', () => {
  beforeAll(async () => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
    process.env.ZURI_SECRET_STORE = 'envelope'
    process.env.ZURI_SECRET_KEK = randomBytes(32).toString('hex')
    process.env.ZURI_SECRET_KEK_VERSION = '1'
    process.env.NOTION_CLIENT_ID = `notion-client-${randomBytes(8).toString('hex')}`
    process.env.NOTION_CLIENT_SECRET = `secret-${randomBytes(24).toString('hex')}`
    process.env.NOTION_REDIRECT_URI = 'https://app.example.test/oauth/notion/callback'
    vi.stubGlobal('fetch', notionFetch)

    const portfolio = await createPortfolio({ code: 'PF-NOTION-OAUTH', name: 'Notion OAuth' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-NOTION-OAUTH', name: 'Notion OAuth' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-NOTION-OAUTH', name: 'Notion OAuth' })
    owner = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'Notion owner' } })
    operator = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'Installation operator' } })
    for (const person of [owner, operator]) {
      await prisma.mfaFactor.create({ data: { personId: person.id, type: 'TOTP', secret: 'mfa.v0.sealed-in-test.placeholder.value', status: 'ACTIVE' } })
    }
    ownerViewer = makeViewer({
      principal: { id: owner.id, code: owner.code, displayName: owner.displayName },
      visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
    })
    operatorViewer = makeOperatorViewer({
      principal: { id: operator.id, code: operator.code, displayName: operator.displayName },
      visibleBusinessIds: [], ownedBusinessIds: [],
    })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  beforeEach(async () => {
    resolveRequestViewer.mockResolvedValue(ownerViewer)
    fetchCalls.length = 0
    ownerSession = await newSession(owner)
    operatorSession = await newSession(operator)
    await clearCredentialLimits()
  })

  it('connects through a one-use state, stores tokens server-side and refuses callback replay', async () => {
    const connected = await call(CONNECT, `https://app.example.test/api/integrations/notion/connect?businessId=${business.id}`, {
      token: ownerSession,
      method: 'GET',
    })
    expect(connected.status).toBe(302)
    expect(connected.headers.get('cache-control')).toBe('no-store')
    const authorization = new URL(connected.headers.get('location'))
    expect(authorization.origin + authorization.pathname).toBe('https://api.notion.com/v1/oauth/authorize')
    expect(authorization.searchParams.get('client_id')).toBe(process.env.NOTION_CLIENT_ID)
    expect(authorization.searchParams.get('redirect_uri')).toBe(process.env.NOTION_REDIRECT_URI)
    expect(authorization.searchParams.get('response_type')).toBe('code')
    expect(authorization.searchParams.get('owner')).toBe('user')
    const state = authorization.searchParams.get('state')
    const stateRow = await prisma.notionOAuthState.findUnique({ where: { stateHash: createHash('sha256').update(state).digest('hex') } })
    expect(stateRow).toMatchObject({ businessId: business.id, actorId: owner.id, consumedAt: null })
    expect(stateRow.stateHash).not.toBe(state)

    const callback = new URL(process.env.NOTION_REDIRECT_URI)
    callback.searchParams.set('code', 'authorization-code-generated-for-test')
    callback.searchParams.set('state', state)
    const completed = await call(CALLBACK, callback.toString(), { token: ownerSession, method: 'GET' })
    expect(completed.status).toBe(302)
    const safeLocation = new URL(completed.headers.get('location'))
    expect(safeLocation.pathname).toBe('/platform/integrations')
    expect(safeLocation.searchParams.get('notion')).toBe('connected')
    expect(safeLocation.search).not.toContain('code=')
    expect(completed.headers.get('cache-control')).toBe('no-store')
    expect(completed.headers.get('referrer-policy')).toBe('no-referrer')
    expect(fetchCalls).toHaveLength(1)
    const [{ url, init }] = fetchCalls
    expect(url).toBe(NOTION_OAUTH_TOKEN_URL)
    expect(init.headers['Notion-Version']).toBe(NOTION_API_VERSION)
    expect(init.headers.Authorization).toBe(`Basic ${Buffer.from(`${process.env.NOTION_CLIENT_ID}:${process.env.NOTION_CLIENT_SECRET}`).toString('base64')}`)
    expect(await prisma.rateLimitBucket.findUnique({ where: { key: LINE_VALIDATION_KEY } })).toBeNull()
    expect(JSON.parse(init.body)).toEqual({
      grant_type: 'authorization_code',
      code: 'authorization-code-generated-for-test',
      redirect_uri: process.env.NOTION_REDIRECT_URI,
    })

    const connection = await prisma.integrationConnection.findFirst({ where: { externalAccountId: workspaceId }, include: { provider: true, credential: true } })
    expect(connection).toMatchObject({ businessId: business.id, purpose: 'NOTION', status: 'ACTIVE', provider: { code: 'NOTION' }, credential: { status: 'ACTIVE', secretKind: 'NOTION_OAUTH_TOKEN', secretStore: 'ENVELOPE' } })
    const envelope = await prisma.integrationSecretEnvelope.findFirst({ where: { connectionId: connection.id } })
    expect(envelope.ciphertext).not.toContain(oauthMaterial.accessToken)
    expect(envelope.ciphertext).not.toContain(oauthMaterial.refreshToken)
    const resolved = await requireWritableSecretStore(process.env).resolve(connection.credential.secretRef, {
      tenantId: connection.tenantId,
      businessId: business.id,
      connectionId: connection.id,
      kind: 'NOTION_OAUTH_TOKEN',
    })
    expect(JSON.parse(resolved.material)).toEqual({ accessToken: oauthMaterial.accessToken, refreshToken: oauthMaterial.refreshToken })
    const audit = await prisma.auditEvent.findMany({ where: { action: 'NOTION_OAUTH_CONNECTED' } })
    expect(audit).toHaveLength(1)
    expect(findLeaks({ callback: completed, connection, envelope, audit, stateRow }, secretNeedles({ accessToken: oauthMaterial.accessToken, refreshToken: oauthMaterial.refreshToken }))).toEqual([])

    const replay = await call(CALLBACK, callback.toString(), { token: ownerSession, method: 'GET' })
    expect(replay.status).toBe(302)
    expect(new URL(replay.headers.get('location')).searchParams.get('reason')).toBe('NOTION_OAUTH_STATE_INVALID')
    expect(fetchCalls).toHaveLength(1)
  })

  it('requires a live AAL2 window before creating OAuth state', async () => {
    const before = await prisma.notionOAuthState.count({ where: { businessId: business.id, actorId: owner.id } })
    for (const session of [
      await newSession(owner, { elevatedFor: null, assuranceLevel: 'AAL1' }),
      await newSession(owner, { elevatedFor: -1, assuranceLevel: 'AAL2' }),
    ]) {
      const result = await call(CONNECT, `https://app.example.test/api/integrations/notion/connect?businessId=${business.id}`, { token: session, method: 'GET' })
      expect(result.status).toBe(403)
      expect(result.json).toMatchObject({ error: 'ASSURANCE_LEVEL_INSUFFICIENT' })
    }
    expect(await prisma.notionOAuthState.count({ where: { businessId: business.id, actorId: owner.id } })).toBe(before)
  })

  it('hides a foreign Business, rejects a callback actor mismatch and expires state before exchange', async () => {
    const foreignPortfolio = await createPortfolio({ code: 'PF-NOTION-FOREIGN', name: 'Foreign Notion' })
    const foreignTenant = await createTenant({ portfolioId: foreignPortfolio.id, code: 'TNT-NOTION-FOREIGN', name: 'Foreign Notion' })
    const foreignBusiness = await createBusiness({ tenantId: foreignTenant.id, code: 'BUS-NOTION-FOREIGN', name: 'Foreign Notion' })
    const before = await prisma.notionOAuthState.count()
    const foreign = await call(CONNECT, `https://app.example.test/api/integrations/notion/connect?businessId=${foreignBusiness.id}`, { token: ownerSession, method: 'GET' })
    expect(foreign).toMatchObject({ status: 404, json: { error: 'NOTION_BUSINESS_NOT_FOUND' } })
    expect(await prisma.notionOAuthState.count()).toBe(before)

    const authorization = await call(CONNECT, `https://app.example.test/api/integrations/notion/connect?businessId=${business.id}`, { token: ownerSession, method: 'GET' })
    const state = new URL(authorization.headers.get('location')).searchParams.get('state')
    const stranger = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'Different callback actor' } })
    await prisma.mfaFactor.create({ data: { personId: stranger.id, type: 'TOTP', secret: 'mfa.v0.sealed-in-test.placeholder.value', status: 'ACTIVE' } })
    const strangerSession = await newSession(stranger)
    resolveRequestViewer.mockResolvedValue(makeViewer({
      principal: { id: stranger.id, code: stranger.code, displayName: stranger.displayName },
      visibleBusinessIds: [business.id], ownedBusinessIds: [],
    }))
    const callback = new URL(process.env.NOTION_REDIRECT_URI)
    callback.searchParams.set('code', 'authorization-code-generated-for-test')
    callback.searchParams.set('state', state)
    const actorMismatch = await call(CALLBACK, callback.toString(), { token: strangerSession, method: 'GET' })
    expect(actorMismatch.status).toBe(302)
    expect(new URL(actorMismatch.headers.get('location')).searchParams.get('reason')).toBe('NOTION_OAUTH_ACTOR_MISMATCH')
    expect(fetchCalls).toHaveLength(0)

    resolveRequestViewer.mockResolvedValue(ownerViewer)
    const expiredState = await prisma.notionOAuthState.findUnique({ where: { stateHash: createHash('sha256').update(state).digest('hex') } })
    await prisma.notionOAuthState.update({ where: { id: expiredState.id }, data: { expiresAt: new Date(Date.now() - 1000) } })
    const expired = await call(CALLBACK, callback.toString(), { token: ownerSession, method: 'GET' })
    expect(expired.status).toBe(302)
    expect(new URL(expired.headers.get('location')).searchParams.get('reason')).toBe('NOTION_OAUTH_STATE_INVALID')
    expect(fetchCalls).toHaveLength(0)
  })

  it('stores the challenge encrypted, reveals it once under operator AAL2, and verifies raw-body events', async () => {
    const verificationToken = `verify_${randomBytes(24).toString('hex')}`
    const challenge = await call(WEBHOOK, 'https://app.example.test/api/integrations/notion/webhook', { raw: JSON.stringify({ verification_token: verificationToken }) })
    expect(challenge).toMatchObject({ status: 200, json: { received: true, challengeAccepted: true } })
    const tokenRow = await prisma.notionWebhookVerificationToken.findUnique({ where: { id: NOTION_WEBHOOK_TOKEN_ID } })
    expect(JSON.stringify(tokenRow)).not.toContain(verificationToken)
    const retry = await call(WEBHOOK, 'https://app.example.test/api/integrations/notion/webhook', { raw: JSON.stringify({ verification_token: verificationToken }) })
    expect(retry.status).toBe(200)
    const conflict = await call(WEBHOOK, 'https://app.example.test/api/integrations/notion/webhook', { raw: JSON.stringify({ verification_token: `different_${randomBytes(12).toString('hex')}` }) })
    expect(conflict).toMatchObject({ status: 409, json: { error: 'NOTION_WEBHOOK_TOKEN_ALREADY_CONFIGURED' } })

    resolveRequestViewer.mockResolvedValue(operatorViewer)
    const revealed = await call(REVEAL, 'https://app.example.test/api/platform/integrations/notion/webhook-verification/reveal', { token: operatorSession })
    expect(revealed).toMatchObject({ status: 200, json: { verificationToken } })
    expect(revealed.headers.get('cache-control')).toBe('no-store')
    expect(revealed.headers.get('referrer-policy')).toBe('no-referrer')
    const consumed = await prisma.notionWebhookVerificationToken.findUnique({ where: { id: NOTION_WEBHOOK_TOKEN_ID } })
    expect(consumed.revealedAt).toBeInstanceOf(Date)
    const secondReveal = await call(REVEAL, 'https://app.example.test/api/platform/integrations/notion/webhook-verification/reveal', { token: operatorSession })
    expect(secondReveal).toMatchObject({ status: 409, json: { error: 'NOTION_WEBHOOK_TOKEN_ALREADY_REVEALED' } })
    expect(secondReveal.text).not.toContain(verificationToken)

    resolveRequestViewer.mockResolvedValue(ownerViewer)
    const eventId = randomUUID()
    const event = {
      id: eventId,
      timestamp: new Date().toISOString(),
      workspace_id: workspaceId,
      type: 'page.updated',
      data: { title: `private-page-title-${randomBytes(6).toString('hex')}`, page_id: randomUUID() },
    }
    const raw = JSON.stringify(event)
    const invalid = await call(WEBHOOK, 'https://app.example.test/api/integrations/notion/webhook', {
      raw,
      headers: { 'x-notion-signature': sign(raw, 'wrong-verification-token') },
    })
    expect(invalid).toMatchObject({ status: 401, json: { error: 'NOTION_WEBHOOK_SIGNATURE_INVALID' } })
    expect(await prisma.notionWebhookReceipt.count({ where: { eventId } })).toBe(0)

    const unsigned = await call(WEBHOOK, 'https://app.example.test/api/integrations/notion/webhook', { raw })
    expect(unsigned).toMatchObject({ status: 401, json: { error: 'NOTION_WEBHOOK_SIGNATURE_INVALID' } })
    const malformed = await call(WEBHOOK, 'https://app.example.test/api/integrations/notion/webhook', {
      raw: '{}',
      headers: { 'x-notion-signature': sign('{}', verificationToken) },
    })
    expect(malformed).toMatchObject({ status: 400, json: { error: 'NOTION_WEBHOOK_EVENT_INVALID' } })

    const valid = await call(WEBHOOK, 'https://app.example.test/api/integrations/notion/webhook', {
      raw,
      headers: { 'x-notion-signature': sign(raw, verificationToken) },
    })
    expect(valid).toMatchObject({ status: 200, json: { received: true, duplicate: false } })
    const receipt = await prisma.notionWebhookReceipt.findUnique({ where: { eventId } })
    expect(receipt).toMatchObject({ eventId, eventType: 'page.updated', workspaceId })
    expect(Object.keys(receipt).sort()).toEqual(['eventId', 'eventType', 'occurredAt', 'receivedAt', 'version', 'workspaceId'].sort())
    expect(JSON.stringify(receipt)).not.toContain(event.data.title)
    const duplicate = await call(WEBHOOK, 'https://app.example.test/api/integrations/notion/webhook', {
      raw,
      headers: { 'x-notion-signature': sign(raw, verificationToken) },
    })
    expect(duplicate).toMatchObject({ status: 200, json: { received: true, duplicate: true } })

    const oversized = await call(WEBHOOK, 'https://app.example.test/api/integrations/notion/webhook', {
      raw: 'x'.repeat(NOTION_WEBHOOK_BODY_LIMIT_BYTES + 1),
    })
    expect(oversized).toMatchObject({ status: 413, json: { error: 'NOTION_WEBHOOK_BODY_TOO_LARGE' } })

    resolveRequestViewer.mockResolvedValue(operatorViewer)
    const reset = await call(RESET, 'https://app.example.test/api/platform/integrations/notion/webhook-verification/reset', { token: operatorSession })
    expect(reset).toMatchObject({ status: 200, json: { reset: true, hadConfiguredToken: true } })
    expect(await prisma.notionWebhookVerificationToken.count()).toBe(0)
    expect(await prisma.auditEvent.count({ where: { action: 'TOKEN_RESET', entityType: 'NOTION_WEBHOOK_VERIFICATION' } })).toBe(1)
    const webhookAudits = await prisma.auditEvent.findMany({ where: { entityType: 'NOTION_WEBHOOK_VERIFICATION' } })
    expect(findLeaks({
      challenge, retry, conflict, secondReveal, invalid, unsigned, malformed, valid, duplicate, oversized, reset,
      webhookAudits, tokenRow, receipt,
    }, secretNeedles({ accessToken: verificationToken }))).toEqual([])
  })
})
