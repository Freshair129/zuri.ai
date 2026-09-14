// @req FR-228 — ENABLE_SERVER's legacy handoff is typed for a mount-backed
//   credential (unchanged) and derived for a vault-backed one: LINE's own
//   webhook endpoint must equal this account's URL and be active, no raw LINE
//   evidence for the connection may have arrived in the 120 s window ending
//   at (and excluding) that registration's own timestamp, and the
//   registration itself must be at least 120 s old — or it refuses 409
//   LINE_LEGACY_TRANSPORT_ACTIVE naming the last pre-cutover receipt time.
//   Evidence timestamped at or after the registration is proof the cutover
//   worked and never blocks (fixed 2026-09-14 on review: an earlier version
//   anchored the window to "now" instead of to the registration, so a busy,
//   already-cutover account's own traffic kept blocking it forever). The
//   epoch fence, the SENDING/UNKNOWN refusal and the version check are
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

/**
 * Register the webhook, optionally pinning `webhookStateJson.lastTestAt` to a
 * fixed instant (`registeredAt`) so a test can reason exactly about the 120 s
 * window the derived-quiescence check anchors to that timestamp, rather than
 * to real wall-clock time.
 */
async function registerWebhookOk(account, { active = true, registeredAt } = {}) {
  const endpoint = `https://zuri-fr228.ngrok.io/api/line-oa/accounts/${account.id}/webhook`
  const testedAt = registeredAt ?? new Date()
  const lineAdmin = {
    setWebhookEndpoint: async () => ({ endpoint, status: 'SET' }),
    getWebhookEndpoint: async () => ({ endpoint, active }),
    testWebhookEndpoint: async () => (active
      ? { success: true, code: 'LINE_OK', reason: 'OK', statusCode: 200, detail: null, testedAt: testedAt.toISOString() }
      : { success: false, code: null, reason: null, statusCode: null, detail: null, testedAt: null }),
  }
  return applyLineOaAccountAction(account.id, { action: 'REGISTER_WEBHOOK', version: account.version }, {
    viewer: owner, ports: { lineAdmin, ...(registeredAt ? { now: () => registeredAt } : {}) },
  })
}

/** ENABLE_SERVER with the derived-quiescence check evaluated at a fixed instant. */
function enableServerAt(accountId, version, at) {
  return applyLineOaAccountAction(accountId, { action: 'ENABLE_SERVER', version }, {
    viewer: owner, ports: { ...validatePorts, now: () => at },
  })
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

  it('a vault-backed account whose webhook matches and has no pre-cutover evidence enables with no typed confirmation, once the registration itself is 120s old', async () => {
    const account = await vaultBackedAccount('Quiesced')
    const registeredAt = new Date('2026-09-14T10:00:00.000Z')
    const registered = await registerWebhookOk(account, { registeredAt })
    expect(registered.health.webhook).toMatchObject({ active: true, lastTestReason: 'LINE_OK' })

    // No `legacyQuiesced` in the input at all — the point of this feature.
    const enabled = await enableServerAt(account.id, registered.version, new Date(registeredAt.getTime() + 120_000))
    expect(enabled).toMatchObject({ serverEnabled: true, status: 'CONNECTED', effectiveStatus: 'LIVE' })
  })

  // @req FR-228 — the blocker this suite exists to catch: once REGISTER_WEBHOOK's
  // PUT succeeds, LINE only ever delivers to the newly-registered URL from that
  // instant on, so evidence timestamped AFTER the registration is proof the
  // cutover worked — a busy, already-cutover account — never a reason to refuse.
  // The earlier version of this check looked at "any evidence in the last 120s"
  // with no reference to the cutover, so a genuinely quiesced but busy account
  // could never enable at all.
  it('a busy account with native traffic arriving AFTER the registration still enables', async () => {
    const account = await vaultBackedAccount('BusyAfterCutover')
    const registeredAt = new Date('2026-09-14T10:00:00.000Z')
    const registered = await registerWebhookOk(account, { registeredAt })
    // Real, currently-messaging customer traffic, 5s after the cutover.
    await rawEvidence(account.integrationConnectionId, { createdAt: new Date(registeredAt.getTime() + 5_000) })

    const enabled = await enableServerAt(account.id, registered.version, new Date(registeredAt.getTime() + 120_000))
    expect(enabled).toMatchObject({ serverEnabled: true, status: 'CONNECTED' })
  })

  it('evidence from BEFORE the registration, inside its 120s window, still blocks and names the receipt time', async () => {
    const account = await vaultBackedAccount('PreCutoverEvidence')
    const registeredAt = new Date('2026-09-14T10:00:00.000Z')
    // A straggler from whatever owned the webhook before this cutover, 5s prior.
    const receipt = await rawEvidence(account.integrationConnectionId, { createdAt: new Date(registeredAt.getTime() - 5_000) })
    const registered = await registerWebhookOk(account, { registeredAt })

    const error = await enableServerAt(account.id, registered.version, new Date(registeredAt.getTime() + 120_000)).catch(e => e)
    expect(error).toMatchObject({ status: 409, message: 'LINE_LEGACY_TRANSPORT_ACTIVE' })
    expect(new Date(error.lastLegacyReceiptAt).getTime()).toBe(new Date(receipt.createdAt).getTime())
    expect((await prisma.lineOaAccount.findUnique({ where: { id: account.id } })).serverEnabled).toBe(false)
  })

  it('evidence from more than 120s before the registration no longer blocks activation', async () => {
    const account = await vaultBackedAccount('StalePreCutoverEvidence')
    const registeredAt = new Date('2026-09-14T10:00:00.000Z')
    await rawEvidence(account.integrationConnectionId, { createdAt: new Date(registeredAt.getTime() - 121_000) })
    const registered = await registerWebhookOk(account, { registeredAt })

    const enabled = await enableServerAt(account.id, registered.version, new Date(registeredAt.getTime() + 120_000))
    expect(enabled).toMatchObject({ serverEnabled: true, status: 'CONNECTED' })
  })

  it('the 120s pre-registration window is evaluated at both boundaries', async () => {
    const registeredAt = new Date('2026-09-14T10:00:00.000Z')
    const evalAt = new Date(registeredAt.getTime() + 120_000)

    // Exactly at the window start (registeredAt - 120000ms, inclusive): blocks.
    const atStart = await vaultBackedAccount('BoundaryWindowStart')
    await rawEvidence(atStart.integrationConnectionId, { createdAt: new Date(registeredAt.getTime() - 120_000) })
    const registeredStart = await registerWebhookOk(atStart, { registeredAt })
    await expect(enableServerAt(atStart.id, registeredStart.version, evalAt))
      .rejects.toMatchObject({ status: 409, message: 'LINE_LEGACY_TRANSPORT_ACTIVE' })

    // Exactly at the registration instant itself: proof of success, not a
    // straggler — never blocks.
    const atRegistration = await vaultBackedAccount('BoundaryAtRegistration')
    await rawEvidence(atRegistration.integrationConnectionId, { createdAt: new Date(registeredAt.getTime()) })
    const registeredAtBoundary = await registerWebhookOk(atRegistration, { registeredAt })
    const enabled = await enableServerAt(atRegistration.id, registeredAtBoundary.version, evalAt)
    expect(enabled).toMatchObject({ serverEnabled: true, status: 'CONNECTED' })
  })

  it('a registration that has not yet stood for a full 120s refuses even with no evidence at all', async () => {
    const account = await vaultBackedAccount('TooSoonAfterRegistration')
    const registeredAt = new Date('2026-09-14T10:00:00.000Z')
    const registered = await registerWebhookOk(account, { registeredAt })

    // 119s after registration — one second short of the cooldown.
    const error = await enableServerAt(account.id, registered.version, new Date(registeredAt.getTime() + 119_000)).catch(e => e)
    expect(error).toMatchObject({ status: 409, message: 'LINE_LEGACY_TRANSPORT_ACTIVE', lastLegacyReceiptAt: null })
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
    const registeredAt = new Date('2026-09-14T10:00:00.000Z')
    const registered = await registerWebhookOk(account, { registeredAt })
    const evalAt = new Date(registeredAt.getTime() + 120_000)

    // The version check happens before the quiescence derivation is even
    // reached, so it needs no `now` override to prove it is unchanged.
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
    // Quiescence passes (evaluated 120s after this account's own registration);
    // the SENDING job still refuses, unaffected by this feature.
    await expect(enableServerAt(account.id, registered.version, evalAt))
      .rejects.toMatchObject({ status: 409, message: 'LINE_OA_DELIVERY_RECONCILIATION_REQUIRED' })

    await prisma.lineConversationJob.update({ where: { id: job.id }, data: { status: 'QUEUED', sealedReplyToken: 'sealed' } })
    const enabled = await enableServerAt(account.id, registered.version, evalAt)
    expect(enabled.transportEpoch).toBe(registered.transportEpoch + 1)
    expect((await prisma.lineConversationJob.findUnique({ where: { id: job.id } })).status).toBe('CANCELLED')
  })
})
