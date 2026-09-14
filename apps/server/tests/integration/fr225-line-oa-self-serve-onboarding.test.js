// @req FR-225 — the self-serve wizard's own acceptance, end to end through the
//   routes: connecting a channel and creating the DRAFT LineOaAccount that
//   follows it needs no operator and no host file; a LINE outage stores
//   nothing; a mount-backed credential moves into the vault when its owner
//   re-enters the secret through the same rotate route the wizard's migration
//   card uses.
// @spec ADR-089 D2, D3, D7, D8 §4.9; design §5.1, §5.2; TC-TASK-ZAI-082
// @tested tests/integration/fr225-line-oa-self-serve-onboarding.test.js
import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { AUTH_SESSION_COOKIE, hashSessionToken } from '@/modules/identity/auth-service'
import { LINE_API } from '@/platform/integrations/providers/line/line-channel-admin-port'
import { suggestLineOaAccountCode } from '@/modules/line-oa-studio/domain/line-oa-account'
import { findLeaks, generateLineChannelBundle, secretNeedles } from '../helpers/credential-vault-fixtures'

const { resolveRequestViewer } = vi.hoisted(() => ({ resolveRequestViewer: vi.fn() }))
vi.mock('@/modules/identity/request-viewer', () => ({ resolveRequestViewer }))

const { POST: CONNECT } = await import('@/app/api/line-oa/connections/route')
const { POST: ROTATE } = await import('@/app/api/line-oa/connections/[id]/credential/route')
const { POST: CREATE_ACCOUNT } = await import('@/app/api/line-oa/accounts/route')

const ENV_KEYS = ['ZURI_SECRET_STORE', 'ZURI_SECRET_KEK', 'ZURI_SECRET_KEK_VERSION']
const savedEnv = {}
const bundles = []
const responses = []
let business, person, viewer, sessionToken
let outageOnce = false

/** Same stub shape as the other credential-route tests: pairs registered in
 * `line` mint a token for their destination; anything else is rejected;
 * `outageOnce` simulates one LINE network failure for the outage proof. */
const line = new Map()
const fetchCalls = []
async function fakeFetch(url, init) {
  fetchCalls.push(url)
  if (outageOnce) { outageOnce = false; throw new Error('ECONNRESET') }
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

async function call(handler, url, body, { id, token = sessionToken } = {}) {
  const request = new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(token ? { cookie: `${AUTH_SESSION_COOKIE}=${token}` } : {}) },
    body: JSON.stringify(body),
  })
  const response = await handler(request, { params: { id } })
  const json = await response.json()
  responses.push(json)
  return { status: response.status, json, headers: response.headers }
}

async function newSession() {
  const token = randomBytes(24).toString('base64url')
  await prisma.session.create({
    data: {
      personId: person.id, tokenHash: hashSessionToken(token), status: 'ACTIVE', assuranceLevel: 'AAL2',
      elevatedUntil: new Date(Date.now() + 900_000), expiresAt: new Date(Date.now() + 3600_000),
    },
  })
  return token
}

const storedCount = async () => ({
  connections: await prisma.integrationConnection.count(),
  credentials: await prisma.integrationCredential.count(),
  claims: await prisma.channelAccountClaim.count(),
  accounts: await prisma.lineOaAccount.count(),
})

describe('FR-225 self-serve LINE OA connection wizard', () => {
  beforeAll(async () => {
    for (const key of ENV_KEYS) savedEnv[key] = process.env[key]
    process.env.ZURI_SECRET_STORE = 'envelope'
    process.env.ZURI_SECRET_KEK = randomBytes(32).toString('hex')
    process.env.ZURI_SECRET_KEK_VERSION = '1'
    vi.stubGlobal('fetch', fakeFetch)
    const portfolio = await createPortfolio({ code: 'PF-FR225', name: 'FR-225' })
    const tenant = await createTenant({ portfolioId: portfolio.id, code: 'TNT-FR225', name: 'FR-225' })
    business = await createBusiness({ tenantId: tenant.id, code: 'BUS-FR225', name: 'FR-225' })
    person = await prisma.person.create({ data: { code: `PER-${randomUUID().slice(0, 8)}`, displayName: 'Wizard owner' } })
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
    outageOnce = false
    await prisma.rateLimitBucket.deleteMany({})
    sessionToken = await newSession()
  })

  it('creates the connection, writes the credential through the vault and creates a DRAFT LineOaAccount — no operator, no host file', async () => {
    const { bundle, destination } = channel()
    const connected = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'Wizard main', ...bundle })
    expect(connected.status).toBe(200)
    // The response carries connection, masked credential and bot metadata only —
    // nothing else, and no account object (the account is a second, separate call).
    expect(Object.keys(connected.json).sort()).toEqual(['bot', 'claim', 'connection', 'credential'])
    expect(connected.json).toMatchObject({
      connection: { destination, status: 'ACTIVE' },
      credential: { status: 'ACTIVE', version: 1, secretStore: 'ENVELOPE', displayHint: bundle.channelId.slice(-4) },
      bot: { basicId: '@wizard', displayName: 'Wizard Shop' },
      claim: { status: 'CLAIMED' },
    })
    // No deployment mount and no operator: the store is the app's own vault, not
    // a reference to a file outside the checkout.
    expect(connected.json.credential.secretStore).not.toBe('DEPLOYMENT_MOUNT')

    const code = suggestLineOaAccountCode(connected.json.bot)
    const account = await call(CREATE_ACCOUNT, 'http://local/api/line-oa/accounts', {
      businessId: business.id,
      integrationConnectionId: connected.json.connection.id,
      code,
      displayName: connected.json.bot.displayName,
      basicId: connected.json.bot.basicId,
    })
    expect(account.status).toBe(200)
    expect(account.json).toMatchObject({ status: 'DRAFT', code, displayName: 'Wizard Shop', basicId: '@wizard', integrationConnectionId: connected.json.connection.id })

    expect(findLeaks({ connected, account }, secretNeedles(bundle))).toEqual([])
  })

  // @req FR-225 — the resume path (reviewer blocker, 2026-09-14). The connect
  // call and the account-create call are not atomic: a dropped network, a
  // closed tab or any account-create failure other than a code clash between
  // them leaves a claimed, credentialed connection with no LineOaAccount —
  // invisible on the Studio page (accounts only) and, without this, reachable
  // only through an operator, contrary to FR-225's "no operator". Retrying the
  // wizard with the same Channel ID/secret must answer with enough for the
  // owner to finish the job themselves.
  it('a retry after a dropped account-create answers enough to finish the account itself, and never again once it exists', async () => {
    const { bundle } = channel()
    const connected = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'Interrupted', ...bundle })
    expect(connected.status).toBe(200)
    const before = await storedCount()

    // The tab closed / the network dropped before POST /accounts ever ran —
    // simulated by simply never calling it. Retrying the wizard with the
    // identical credentials is the natural thing an owner does next.
    const retry = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'Interrupted', ...bundle })
    expect(retry.status).toBe(409)
    expect(retry.json.error).toBe('LINE_CHANNEL_ALREADY_CONNECTED')
    expect(retry.json.details).toEqual([{
      code: 'LINE_CHANNEL_ALREADY_CONNECTED',
      message: expect.any(String),
      businessId: business.id,
      connectionId: connected.json.connection.id,
      accountId: null, // the dead end: claimed and credentialed, no account
      basicId: connected.json.bot.basicId,
      displayName: connected.json.bot.displayName,
      secretStore: connected.json.credential.secretStore,
      displayHint: connected.json.credential.displayHint,
    }])
    // The retry's own transaction rolled back cleanly: no second connection,
    // no second credential, no orphan left by the retry itself.
    expect(await storedCount()).toEqual(before)

    // The wizard uses exactly this to finish the account step itself. The
    // fixture's bot always answers the same Basic ID, so the suggested code
    // is disambiguated the same way the wizard's own retry loop would.
    const sibling = retry.json.details[0]
    const code = `${suggestLineOaAccountCode({ basicId: sibling.basicId, displayName: sibling.displayName })}-${randomBytes(3).toString('hex')}`
    const account = await call(CREATE_ACCOUNT, 'http://local/api/line-oa/accounts', {
      businessId: business.id, integrationConnectionId: sibling.connectionId, code,
      displayName: sibling.displayName, basicId: sibling.basicId,
    })
    expect(account.status).toBe(200)
    expect(account.json).toMatchObject({ status: 'DRAFT', integrationConnectionId: connected.json.connection.id })

    // Once the account exists, a further retry names it instead of resuming —
    // the wizard must tell "already live" apart from "still a dead end".
    const afterFixed = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'Interrupted', ...bundle })
    expect(afterFixed.status).toBe(409)
    expect(afterFixed.json.details[0].accountId).toBe(account.json.id)

    expect(findLeaks({ connected, retry, afterFixed, account }, secretNeedles(bundle))).toEqual([])
  })

  it('a wrong Channel ID and a wrong secret both answer 422 LINE_CREDENTIALS_REJECTED and store nothing', async () => {
    const { bundle } = channel()
    const before = await storedCount()
    for (const attempt of [
      { ...bundle, channelId: String(Number(bundle.channelId) + 1) },
      { ...bundle, channelSecret: generateLineChannelBundle().channelSecret },
    ]) {
      const { status, json } = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'Wrong', ...attempt })
      expect({ status, error: json.error }).toEqual({ status: 422, error: 'LINE_CREDENTIALS_REJECTED' })
    }
    expect(await storedCount()).toEqual(before)
  })

  it('a LINE outage answers 503 LINE_UNAVAILABLE and stores nothing', async () => {
    const { bundle } = channel()
    const before = await storedCount()
    outageOnce = true
    const { status, json } = await call(CONNECT, 'http://local/api/line-oa/connections', { businessId: business.id, name: 'Outage', ...bundle })
    expect({ status, error: json.error }).toEqual({ status: 503, error: 'LINE_UNAVAILABLE' })
    expect(await storedCount()).toEqual(before)
  })

  it('a mount-backed connection moves its credential into the vault when the owner re-enters the secret', async () => {
    // Seed the FR-149 operator path directly: a deployment-secret reference,
    // never claimed (claims postdate that path) and never a browser-entered
    // secret. This is the "account backed by the mount" FR-225 names.
    const destination = `U${randomBytes(16).toString('hex')}`
    const seeded = await call(CONNECT, 'http://local/api/line-oa/connections', {
      businessId: business.id, name: 'Legacy mount', destination, secretRef: 'deployment-secret:legacy-fr225',
    })
    expect(seeded.status).toBe(200)
    const before = await prisma.integrationCredential.findUnique({ where: { connectionId: seeded.json.id } })
    expect(before).toMatchObject({ secretStore: 'DEPLOYMENT_MOUNT', version: 1 })

    // The owner re-enters Channel ID + secret for the same bot through the
    // wizard's migration card, which is the rotate route.
    const reentered = generateLineChannelBundle()
    bundles.push(reentered)
    line.set(`${reentered.channelId}:${reentered.channelSecret}`, destination)
    const migrated = await call(ROTATE, `http://local/api/line-oa/connections/${seeded.json.id}/credential`, reentered, { id: seeded.json.id })
    expect(migrated.status).toBe(200)
    expect(migrated.json.credential).toMatchObject({ status: 'ACTIVE', version: 2, secretStore: 'ENVELOPE' })

    const after = await prisma.integrationCredential.findUnique({ where: { connectionId: seeded.json.id } })
    expect(after.secretStore).toBe('ENVELOPE')
    expect(after.secretRef).not.toBe('deployment-secret:legacy-fr225')
    expect(findLeaks({ migrated }, secretNeedles(reentered))).toEqual([])
  })

  it('no response and no audit row from this suite carried any secret material', async () => {
    const needles = [...new Set(bundles.flatMap(secretNeedles))]
    const audit = await prisma.auditEvent.findMany({ where: { entityType: 'INTEGRATION_CREDENTIAL' } })
    expect(findLeaks({ responses, audit, credentials: await prisma.integrationCredential.findMany(), versions: await prisma.integrationCredentialVersion.findMany() }, needles)).toEqual([])
  })
})
