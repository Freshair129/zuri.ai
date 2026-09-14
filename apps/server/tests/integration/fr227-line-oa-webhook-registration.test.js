// @req FR-227 — the REGISTER_WEBHOOK action: set, read back and test the
//   account's LINE webhook endpoint, storing the outcome as computed health;
//   idempotent and retryable with no secret re-entry; every LINE-side refusal
//   (URL rejected, inactive toggle, failed test, signature mismatch) is
//   recorded honestly as health rather than thrown, and never fences work.
// @spec ADR-089 D7; SEC-030; TC-TASK-ZAI-083
// @tested tests/integration/fr227-line-oa-webhook-registration.test.js
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { LINE_API } from '@/platform/integrations/providers/line/line-channel-admin-port'
import { connectLineChannelWithSecret } from '@/modules/integration/application/line-channel-connection-service'
import { connectLineOaAccount, applyLineOaAccountAction } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { describeLineOaWebhookHealth } from '@/modules/line-oa-studio/domain/line-oa-webhook-copy'
import { findLeaks, generateLineChannelBundle, secretNeedles } from '../helpers/credential-vault-fixtures'

const ENV_KEYS = ['ZURI_SECRET_STORE', 'ZURI_SECRET_KEK', 'ZURI_SECRET_KEK_VERSION', 'PUBLIC_BASE_URL', 'NEXT_PUBLIC_APP_URL']
const savedEnv = {}
let business, owner

const line = new Map()
const bundles = []
async function fakeFetch(url, init) {
  const reply = (status, body) => ({ status, ok: status < 300, json: async () => body })
  if (url === LINE_API.token) {
    const form = new URLSearchParams(init.body)
    const destination = line.get(`${form.get('client_id')}:${form.get('client_secret')}`)
    return destination ? reply(200, { access_token: `tok-${destination}-${'a'.repeat(20)}`, expires_in: 900 }) : reply(400, { error: 'invalid_client' })
  }
  if (url === LINE_API.botInfo) {
    const match = /^Bearer tok-(U[0-9a-f]{32})-/.exec(init.headers.Authorization)
    return match ? reply(200, { userId: match[1], basicId: '@wizard', displayName: 'Wizard Shop', chatMode: 'bot', markAsReadMode: 'auto' }) : reply(401, {})
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

/** A vault-backed (ENVELOPE) DRAFT account with a validated credential (FR-225/226). */
async function draftAccount(name) {
  const { bundle } = channel()
  const connected = await connectLineChannelWithSecret({ businessId: business.id, name, ...bundle }, { viewer: owner })
  return connectLineOaAccount({
    businessId: business.id, integrationConnectionId: connected.connection.id,
    code: `oa-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomBytes(3).toString('hex')}`,
    displayName: connected.bot.displayName, basicId: connected.bot.basicId,
  }, { viewer: owner })
}

describe('FR-227 REGISTER_WEBHOOK', () => {
  beforeAll(async () => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
    process.env.ZURI_SECRET_STORE = 'envelope'
    process.env.ZURI_SECRET_KEK = randomBytes(32).toString('hex')
    process.env.ZURI_SECRET_KEK_VERSION = '1'
    process.env.PUBLIC_BASE_URL = 'https://zuri-fr227.ngrok.io'
    delete process.env.NEXT_PUBLIC_APP_URL
    vi.stubGlobal('fetch', fakeFetch)
    const portfolio = await createPortfolio({ code: 'PF-FR227', name: 'FR-227' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-FR227', name: 'FR-227' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-FR227', name: 'FR-227' })
    owner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['line-oa'] })
  })

  afterAll(() => {
    vi.unstubAllGlobals()
    for (const key of ENV_KEYS) {
      if (savedEnv[key] === undefined) delete process.env[key]
      else process.env[key] = savedEnv[key]
    }
  })

  beforeEach(async () => {
    await prisma.rateLimitBucket.deleteMany({})
  })

  it('sets, reads back and tests the webhook, storing endpoint/active/lastTestAt/lastTestReason/lastTestStatusCode', async () => {
    const account = await draftAccount('Success')
    const expectedEndpoint = `https://zuri-fr227.ngrok.io/api/line-oa/accounts/${account.id}/webhook`
    const lineAdmin = {
      setWebhookEndpoint: vi.fn(async ({ endpoint }) => ({ endpoint, status: 'SET' })),
      getWebhookEndpoint: vi.fn(async () => ({ endpoint: expectedEndpoint, active: true })),
      testWebhookEndpoint: vi.fn(async () => ({ success: true, code: 'LINE_OK', reason: 'OK', statusCode: 200, detail: null, testedAt: '2026-09-14T12:00:00.000Z' })),
    }
    const updated = await applyLineOaAccountAction(account.id, { action: 'REGISTER_WEBHOOK', version: account.version }, { viewer: owner, ports: { lineAdmin } })
    expect(lineAdmin.setWebhookEndpoint).toHaveBeenCalledWith({ accessToken: expect.any(String), endpoint: expectedEndpoint })
    expect(updated.version).toBe(account.version + 1)
    expect(updated.transportEpoch).toBe(account.transportEpoch) // health-only: never fences
    expect(updated.health.webhook).toEqual({
      endpoint: expectedEndpoint, active: true,
      lastTestAt: '2026-09-14T12:00:00.000Z', lastTestReason: 'LINE_OK', lastTestStatusCode: 200,
    })
    expect(describeLineOaWebhookHealth(updated.health.webhook)).toMatchObject({ code: 'LINE_OK', showManualCard: false })

    const row = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
    expect(JSON.parse(row.webhookStateJson)).toMatchObject({ active: true, lastTestReason: 'LINE_OK' })
  })

  it('is idempotent and retryable — a second run needs no secret re-entry and overwrites the stored state', async () => {
    const account = await draftAccount('Retry')
    const expectedEndpoint = `https://zuri-fr227.ngrok.io/api/line-oa/accounts/${account.id}/webhook`
    const okAdmin = {
      setWebhookEndpoint: async ({ endpoint }) => ({ endpoint, status: 'SET' }),
      getWebhookEndpoint: async () => ({ endpoint: expectedEndpoint, active: true }),
      testWebhookEndpoint: async () => ({ success: true, code: 'LINE_OK', reason: 'OK', statusCode: 200, detail: null, testedAt: '2026-09-14T12:00:00.000Z' }),
    }
    const first = await applyLineOaAccountAction(account.id, { action: 'REGISTER_WEBHOOK', version: account.version }, { viewer: owner, ports: { lineAdmin: okAdmin } })
    expect(first.health.webhook.lastTestReason).toBe('LINE_OK')

    // The retry call itself carries no channelId/channelSecret — the same
    // credential is resolved server-side both times.
    const failingAdmin = {
      setWebhookEndpoint: okAdmin.setWebhookEndpoint,
      getWebhookEndpoint: okAdmin.getWebhookEndpoint,
      testWebhookEndpoint: async () => ({ success: false, code: 'LINE_WEBHOOK_TEST_FAILED:REQUEST_TIMEOUT', reason: 'REQUEST_TIMEOUT', statusCode: null, detail: null, testedAt: '2026-09-14T12:05:00.000Z' }),
    }
    const second = await applyLineOaAccountAction(account.id, { action: 'REGISTER_WEBHOOK', version: first.version }, { viewer: owner, ports: { lineAdmin: failingAdmin } })
    expect(second.health.webhook).toMatchObject({ lastTestReason: 'LINE_WEBHOOK_TEST_FAILED:REQUEST_TIMEOUT', lastTestStatusCode: null })
  })

  it('an unset public base URL refuses 503 before calling LINE at all', async () => {
    const account = await draftAccount('NoBaseUrl')
    delete process.env.PUBLIC_BASE_URL
    delete process.env.NEXT_PUBLIC_APP_URL
    try {
      const lineAdmin = { setWebhookEndpoint: vi.fn(), getWebhookEndpoint: vi.fn(), testWebhookEndpoint: vi.fn() }
      await expect(applyLineOaAccountAction(account.id, { action: 'REGISTER_WEBHOOK', version: account.version }, { viewer: owner, ports: { lineAdmin } }))
        .rejects.toMatchObject({ status: 503, message: 'PUBLIC_BASE_URL_NOT_CONFIGURED' })
      expect(lineAdmin.setWebhookEndpoint).not.toHaveBeenCalled()
      expect((await prisma.lineOaAccount.findUnique({ where: { id: account.id } })).webhookStateJson).toBeNull()
    } finally {
      process.env.PUBLIC_BASE_URL = 'https://zuri-fr227.ngrok.io'
    }
  })

  it('LINE refusing the URL is stored with a manual-card reason, not thrown', async () => {
    const account = await draftAccount('SetFailed')
    const expectedEndpoint = `https://zuri-fr227.ngrok.io/api/line-oa/accounts/${account.id}/webhook`
    const lineAdmin = {
      setWebhookEndpoint: async () => { const e = new Error('LINE_WEBHOOK_SET_FAILED'); e.code = 'LINE_WEBHOOK_SET_FAILED'; e.status = 422; e.reason = 'LINE_REFUSED_ENDPOINT'; throw e },
      getWebhookEndpoint: vi.fn(),
      testWebhookEndpoint: vi.fn(),
    }
    const updated = await applyLineOaAccountAction(account.id, { action: 'REGISTER_WEBHOOK', version: account.version }, { viewer: owner, ports: { lineAdmin } })
    expect(updated.health.webhook).toEqual({ endpoint: expectedEndpoint, active: false, lastTestAt: expect.any(String), lastTestReason: 'LINE_WEBHOOK_SET_FAILED', lastTestStatusCode: null })
    expect(lineAdmin.getWebhookEndpoint).not.toHaveBeenCalled()
    const copy = describeLineOaWebhookHealth(updated.health.webhook)
    expect(copy).toMatchObject({ showManualCard: true, manualCardUrl: expectedEndpoint })
    expect(copy.message.length).toBeGreaterThan(0)
  })

  it('the "Use webhook" toggle being off is stored as inactive without running the test', async () => {
    const account = await draftAccount('ToggleOff')
    const expectedEndpoint = `https://zuri-fr227.ngrok.io/api/line-oa/accounts/${account.id}/webhook`
    const lineAdmin = {
      setWebhookEndpoint: async ({ endpoint }) => ({ endpoint, status: 'SET' }),
      getWebhookEndpoint: async () => ({ endpoint: expectedEndpoint, active: false }),
      testWebhookEndpoint: vi.fn(),
    }
    const updated = await applyLineOaAccountAction(account.id, { action: 'REGISTER_WEBHOOK', version: account.version }, { viewer: owner, ports: { lineAdmin } })
    expect(updated.health.webhook).toMatchObject({ active: false, lastTestReason: 'LINE_WEBHOOK_INACTIVE', lastTestStatusCode: null })
    expect(lineAdmin.testWebhookEndpoint).not.toHaveBeenCalled()
    expect(describeLineOaWebhookHealth(updated.health.webhook)).toMatchObject({ code: 'LINE_WEBHOOK_INACTIVE', showManualCard: true })
  })

  it('a signature mismatch on the test is reported plainly and routes to rotation, without touching the credential', async () => {
    const account = await draftAccount('SigMismatch')
    const expectedEndpoint = `https://zuri-fr227.ngrok.io/api/line-oa/accounts/${account.id}/webhook`
    const lineAdmin = {
      setWebhookEndpoint: async ({ endpoint }) => ({ endpoint, status: 'SET' }),
      getWebhookEndpoint: async () => ({ endpoint: expectedEndpoint, active: true }),
      testWebhookEndpoint: async () => ({ success: false, code: 'LINE_WEBHOOK_SIGNATURE_INVALID', reason: 'ERROR_STATUS_CODE', statusCode: 401, detail: null, testedAt: '2026-09-14T12:10:00.000Z' }),
    }
    const updated = await applyLineOaAccountAction(account.id, { action: 'REGISTER_WEBHOOK', version: account.version }, { viewer: owner, ports: { lineAdmin } })
    expect(updated.health.webhook).toMatchObject({ active: true, lastTestReason: 'LINE_WEBHOOK_SIGNATURE_INVALID', lastTestStatusCode: 401 })
    const copy = describeLineOaWebhookHealth(updated.health.webhook)
    expect(copy).toMatchObject({ code: 'LINE_WEBHOOK_SIGNATURE_INVALID', nextStep: 'ROTATE', showManualCard: false })
    // The credential itself is untouched — reported, never auto-revoked.
    const credential = await prisma.integrationCredential.findUnique({ where: { connectionId: updated.integrationConnectionId } })
    expect(credential.status).toBe('ACTIVE')
  })

  it('never fences in-flight work and never leaks credential material into the audit row', async () => {
    const account = await draftAccount('NoFence')
    const inbound = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
    const expectedEndpoint = `https://zuri-fr227.ngrok.io/api/line-oa/accounts/${account.id}/webhook`
    const lineAdmin = {
      setWebhookEndpoint: async ({ endpoint }) => ({ endpoint, status: 'SET' }),
      getWebhookEndpoint: async () => ({ endpoint: expectedEndpoint, active: true }),
      testWebhookEndpoint: async () => ({ success: true, code: 'LINE_OK', reason: 'OK', statusCode: 200, detail: null, testedAt: '2026-09-14T12:00:00.000Z' }),
    }
    const updated = await applyLineOaAccountAction(account.id, { action: 'REGISTER_WEBHOOK', version: account.version }, { viewer: owner, ports: { lineAdmin } })
    expect(updated.serverEnabled).toBe(inbound.serverEnabled)
    expect(updated.transportEpoch).toBe(inbound.transportEpoch)

    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'LINE_OA_ACCOUNT', entityId: account.id, action: 'LINE_OA_ACCOUNT_WEBHOOK_REGISTERED' }, orderBy: { occurredAt: 'desc' } })
    expect(audit).toBeTruthy()
    expect(findLeaks({ audit, updated }, [...new Set(bundles.flatMap(secretNeedles))])).toEqual([])
  })
})
