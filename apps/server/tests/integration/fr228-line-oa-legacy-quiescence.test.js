// @req FR-228 — ENABLE_SERVER's legacy handoff is typed for a mount-backed
//   credential (unchanged) and derived for a vault-backed one: LINE's own
//   webhook endpoint must equal this account's URL and no raw LINE evidence
//   for the connection may have arrived in the last 120 seconds, or it
//   refuses 409 LINE_LEGACY_TRANSPORT_ACTIVE naming the last receipt time.
//   The epoch fence, the SENDING/UNKNOWN refusal and the version check are
//   unchanged (ADR-061 D3, D7).
// @spec ADR-089 D5, D8; TC-TASK-ZAI-084
// @tested tests/integration/fr228-line-oa-legacy-quiescence.test.js
import { randomBytes } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { LINE_API } from '@/platform/integrations/providers/line/line-channel-admin-port'
import { connectLineChannelWithSecret } from '@/modules/integration/application/line-channel-connection-service'
import { provisionLineServerConnection } from '@/modules/integration/application/line-server-provisioning-service'
import { connectLineOaAccount, applyLineOaAccountAction } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { describeLineOaLegacyTransportActive } from '@/modules/line-oa-studio/domain/line-oa-webhook-copy'
import { generateLineChannelBundle } from '../helpers/credential-vault-fixtures'

const ENV_KEYS = ['ZURI_SECRET_STORE', 'ZURI_SECRET_KEK', 'ZURI_SECRET_KEK_VERSION', 'PUBLIC_BASE_URL', 'NEXT_PUBLIC_APP_URL']
const savedEnv = {}
let business, tenant, owner
const validatePorts = { validateServerCredentials: async () => ({ ready: true }) }

const line = new Map()
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
  const destination = `U${randomBytes(16).toString('hex')}`
  line.set(`${bundle.channelId}:${bundle.channelSecret}`, destination)
  return { bundle, destination }
}

/** A vault-backed (ENVELOPE) DRAFT account with a validated credential. */
async function vaultBackedAccount(name) {
  const { bundle } = channel()
  const connected = await connectLineChannelWithSecret({ businessId: business.id, name, ...bundle }, { viewer: owner })
  const account = await connectLineOaAccount({
    businessId: business.id, integrationConnectionId: connected.connection.id,
    code: `oa-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomBytes(3).toString('hex')}`,
    displayName: connected.bot.displayName, basicId: connected.bot.basicId,
  }, { viewer: owner })
  return account
}

/** A mount-backed (DEPLOYMENT_MOUNT) account, the FR-149 operator path. */
async function mountBackedAccount(name) {
  const destination = `U${randomBytes(16).toString('hex')}`
  const connection = await provisionLineServerConnection({
    businessId: business.id, name, destination, secretRef: `deployment-secret:${name.toLowerCase()}-${randomBytes(3).toString('hex')}`,
  }, { viewer: owner })
  return connectLineOaAccount({
    businessId: business.id, integrationConnectionId: connection.id,
    code: `oa-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${randomBytes(3).toString('hex')}`, displayName: name,
  }, { viewer: owner })
}

async function registerWebhookOk(account, { active = true } = {}) {
  const endpoint = `https://zuri-fr228.ngrok.io/api/line-oa/accounts/${account.id}/webhook`
  const lineAdmin = {
    setWebhookEndpoint: async () => ({ endpoint, status: 'SET' }),
    getWebhookEndpoint: async () => ({ endpoint, active }),
    testWebhookEndpoint: async () => (active
      ? { success: true, code: 'LINE_OK', reason: 'OK', statusCode: 200, detail: null, testedAt: new Date().toISOString() }
      : { success: false, code: null, reason: null, statusCode: null, detail: null, testedAt: null }),
  }
  return applyLineOaAccountAction(account.id, { action: 'REGISTER_WEBHOOK', version: account.version }, { viewer: owner, ports: { lineAdmin } })
}

async function rawEvidence(connectionId, { createdAt } = {}) {
  const suffix = `${Date.now()}-${Math.random()}`
  return prisma.rawExternalRecord.create({
    data: {
      tenantId: tenant.id, businessId: business.id, connectionId,
      provider: LINE_OA_PROVIDER_CODE, lane: 'CUSTOMER', entityType: 'LINE_MESSAGE',
      externalId: `fr228-external-${suffix}`, sourceType: 'WEBHOOK', schemaVersion: 'line.messaging-api.webhook.v1',
      payloadJson: JSON.stringify({ destination: 'fr228-destination', event: { type: 'message' } }),
      payloadHash: `fr228-hash-${suffix}`, idempotencyKey: `fr228-idem-${suffix}`,
      receivedAt: createdAt ?? new Date(), ...(createdAt ? { createdAt } : {}),
    },
  })
}

describe('FR-228 derived legacy quiescence', () => {
  beforeAll(async () => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
    process.env.ZURI_SECRET_STORE = 'envelope'
    process.env.ZURI_SECRET_KEK = randomBytes(32).toString('hex')
    process.env.ZURI_SECRET_KEK_VERSION = '1'
    process.env.PUBLIC_BASE_URL = 'https://zuri-fr228.ngrok.io'
    delete process.env.NEXT_PUBLIC_APP_URL
    vi.stubGlobal('fetch', fakeFetch)
    const portfolio = await createPortfolio({ code: 'PF-FR228', name: 'FR-228' })
    tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-FR228', name: 'FR-228' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-FR228', name: 'FR-228' })
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

  it('a mount-backed account still requires the typed confirmation, unaffected by this feature', async () => {
    const account = await mountBackedAccount('Mount')
    await expect(applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: account.version }, { viewer: owner, ports: validatePorts }))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_LEGACY_CONFIRMATION_REQUIRED' })
    const enabled = await applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: account.version, legacyQuiesced: true }, { viewer: owner, ports: validatePorts })
    expect(enabled).toMatchObject({ serverEnabled: true, status: 'CONNECTED' })
  })

  it('a vault-backed account with no webhook ever registered refuses 409 with no last-receipt time', async () => {
    const account = await vaultBackedAccount('NeverRegistered')
    const error = await applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: account.version }, { viewer: owner, ports: validatePorts }).catch(e => e)
    expect(error).toMatchObject({ status: 409, message: 'LINE_LEGACY_TRANSPORT_ACTIVE', lastLegacyReceiptAt: null })
    expect((await prisma.lineOaAccount.findUnique({ where: { id: account.id } })).serverEnabled).toBe(false)
    const copy = describeLineOaLegacyTransportActive(error)
    expect(copy.message).toContain('transport เดิม')
  })

  it('a vault-backed account whose webhook matches and has no recent evidence enables with no typed confirmation', async () => {
    const account = await vaultBackedAccount('Quiesced')
    const registered = await registerWebhookOk(account)
    expect(registered.health.webhook).toMatchObject({ active: true, lastTestReason: 'LINE_OK' })

    // No `legacyQuiesced` in the input at all — the point of this feature.
    const enabled = await applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: registered.version }, { viewer: owner, ports: validatePorts })
    expect(enabled).toMatchObject({ serverEnabled: true, status: 'CONNECTED', effectiveStatus: 'LIVE' })
  })

  it('recent raw evidence for the connection blocks activation and names the receipt time', async () => {
    const account = await vaultBackedAccount('RecentEvidence')
    const registered = await registerWebhookOk(account)
    const receipt = await rawEvidence(account.integrationConnectionId)

    const error = await applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: registered.version }, { viewer: owner, ports: validatePorts }).catch(e => e)
    expect(error).toMatchObject({ status: 409, message: 'LINE_LEGACY_TRANSPORT_ACTIVE' })
    expect(new Date(error.lastLegacyReceiptAt).getTime()).toBe(new Date(receipt.createdAt).getTime())
    expect((await prisma.lineOaAccount.findUnique({ where: { id: account.id } })).serverEnabled).toBe(false)
  })

  it('evidence older than 120 seconds no longer blocks activation', async () => {
    const account = await vaultBackedAccount('StaleEvidence')
    const registered = await registerWebhookOk(account)
    await rawEvidence(account.integrationConnectionId, { createdAt: new Date(Date.now() - 121_000) })

    const enabled = await applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: registered.version }, { viewer: owner, ports: validatePorts })
    expect(enabled).toMatchObject({ serverEnabled: true, status: 'CONNECTED' })
  })

  it('a webhook that is set but reported inactive still refuses activation', async () => {
    const account = await vaultBackedAccount('Inactive')
    const registered = await registerWebhookOk(account, { active: false })
    expect(registered.health.webhook).toMatchObject({ active: false })

    const error = await applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: registered.version }, { viewer: owner, ports: validatePorts }).catch(e => e)
    expect(error).toMatchObject({ status: 409, message: 'LINE_LEGACY_TRANSPORT_ACTIVE' })
  })

  it('the epoch fence, the SENDING/UNKNOWN refusal and the version check are unchanged for a vault-backed account', async () => {
    const account = await vaultBackedAccount('EpochFence')
    const registered = await registerWebhookOk(account)

    await expect(applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: registered.version - 1 }, { viewer: owner, ports: validatePorts }))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_ACCOUNT_VERSION_CONFLICT' })

    const inbound = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id, channelAccountId: account.id,
      lineUserId: 'fr228-recipient', threadId: 'fr228-thread', text: 'Hello',
      externalMessageId: `fr228-msg-${randomBytes(3).toString('hex')}`,
    })
    const job = await prisma.lineConversationJob.create({
      data: {
        accountId: account.id, inboundMessageId: inbound.messageId, eventId: `fr228-event-${randomBytes(3).toString('hex')}`,
        tenantId: tenant.id, businessId: business.id, channelAccountId: account.id, transportEpoch: registered.transportEpoch,
        executionMode: 'SERVER', modelAccess: 'LOCAL_ONLY', recipientId: 'fr228-recipient', sourceUserId: 'fr228-recipient',
        status: 'SENDING', expiresAt: new Date(Date.now() + 60000), correlationId: `fr228-job-${randomBytes(3).toString('hex')}`,
      },
    })
    await expect(applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: registered.version }, { viewer: owner, ports: validatePorts }))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_DELIVERY_RECONCILIATION_REQUIRED' })

    await prisma.lineConversationJob.update({ where: { id: job.id }, data: { status: 'QUEUED', sealedReplyToken: 'sealed' } })
    const enabled = await applyLineOaAccountAction(account.id, { action: 'ENABLE_SERVER', version: registered.version }, { viewer: owner, ports: validatePorts })
    expect(enabled.transportEpoch).toBe(registered.transportEpoch + 1)
    expect((await prisma.lineConversationJob.findUnique({ where: { id: job.id } })).status).toBe('CANCELLED')
  })
})
