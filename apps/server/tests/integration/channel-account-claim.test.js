// @req FR-226 — the installation-wide channel account claim and the connection flow
//   that takes it: a bot claimed in the same or another Tenant is refused truthfully,
//   only after the secret is proved, and no secret is left stored.
// @req FR-223 — the connection flow stores through the vault and compensates.
// @spec ADR-089 D6, D7 and proofs 5 and 6; SEC-030
// @tested tests/integration/channel-account-claim.test.js
import { randomBytes } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { connectLineChannelWithSecret } from '@/modules/integration/application/line-channel-connection-service'
import { claimChannelAccount, hashExternalAccount } from '@/platform/integrations/core/channel-account-claim'
import { createEnvelopeSecretStore } from '@/platform/integrations/core/secret-store/envelope-secret-store'
import { createDispatchingSecretManager } from '@/platform/integrations/core/secret-store/dispatching-secret-manager'
import { findLeaks, generateLineChannelBundle, secretNeedles } from '../helpers/credential-vault-fixtures'

const ENV = { NODE_ENV: 'test', ZURI_SECRET_STORE: 'envelope', ZURI_SECRET_KEK: randomBytes(32).toString('hex') }
const store = createEnvelopeSecretStore({ db: prisma, env: ENV })
let businessA, businessA2, businessB, ownerA, ownerA2Only, ownerB, member

/** A stub LINE port: every pair in `valid` validates to its own destination. */
function fakeLine() {
  const valid = new Map()
  return {
    valid,
    port: {
      validateChannel: vi.fn(async ({ channelId, channelSecret }) => {
        const destination = valid.get(`${channelId}:${channelSecret}`)
        if (!destination) throw Object.assign(new Error('LINE_CREDENTIALS_REJECTED'), { code: 'LINE_CREDENTIALS_REJECTED', status: 422 })
        return { destination, validationCode: 'LINE_OK', bot: { basicId: '@shop', displayName: 'Shop', pictureUrl: null, chatMode: 'bot', markAsReadMode: 'auto' } }
      }),
    },
    register(bundle) {
      const destination = `U${randomBytes(16).toString('hex')}`
      valid.set(`${bundle.channelId}:${bundle.channelSecret}`, destination)
      return destination
    },
  }
}

const tokenCache = { invalidate: vi.fn() }
const connect = (input, viewer, ports) => connectLineChannelWithSecret(input, { viewer, env: ENV, ports: { store, tokenCache, ...ports } })
const storedCount = async () => ({ envelopes: await prisma.integrationSecretEnvelope.count(), credentials: await prisma.integrationCredential.count(), claims: await prisma.channelAccountClaim.count(), connections: await prisma.integrationConnection.count() })

describe('channel account claim (FR-226)', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ code: 'PF-CLAIM', name: 'Claim' })
    const tenantA = await createTenant({ portfolioId: portfolio.id, code: 'TNT-CLAIM-A', name: 'Claim A' })
    const tenantB = await createTenant({ portfolioId: portfolio.id, code: 'TNT-CLAIM-B', name: 'Claim B' })
    businessA = await createBusiness({ tenantId: tenantA.id, code: 'BUS-CLAIM-A', name: 'Claim A' })
    businessA2 = await createBusiness({ tenantId: tenantA.id, code: 'BUS-CLAIM-A2', name: 'Claim A2' })
    businessB = await createBusiness({ tenantId: tenantB.id, code: 'BUS-CLAIM-B', name: 'Claim B' })
    ownerA = makeViewer({ visibleBusinessIds: [businessA.id, businessA2.id], ownedBusinessIds: [businessA.id, businessA2.id], visibleDomains: ['line-oa'] })
    ownerA2Only = makeViewer({ visibleBusinessIds: [businessA2.id], ownedBusinessIds: [businessA2.id], visibleDomains: ['line-oa'] })
    ownerB = makeViewer({ visibleBusinessIds: [businessB.id], ownedBusinessIds: [businessB.id], visibleDomains: ['line-oa'] })
    member = makeViewer({ visibleBusinessIds: [businessA.id], ownedBusinessIds: [], visibleDomains: ['line-oa'] })
  })

  it('connects: validates, claims, stores through the vault and answers metadata only', async () => {
    const line = fakeLine()
    const bundle = generateLineChannelBundle()
    const destination = line.register(bundle)
    const result = await connect({ businessId: businessA.id, name: 'Main', ...bundle }, ownerA, { lineAdmin: line.port })
    expect(result).toMatchObject({
      connection: { businessId: businessA.id, name: 'Main', destination, status: 'ACTIVE' },
      credential: { status: 'ACTIVE', version: 1, secretStore: 'ENVELOPE', displayHint: bundle.channelId.slice(-4) },
      bot: { basicId: '@shop' },
      claim: { status: 'CLAIMED' },
    })
    expect(findLeaks({ result }, secretNeedles(bundle))).toEqual([])
    const claim = await prisma.channelAccountClaim.findUnique({ where: { connectionId: result.connection.id } })
    expect(claim).toMatchObject({ provider: 'LINE_OA', externalAccountHash: hashExternalAccount(destination), tenantId: businessA.tenantId, releasedAt: null })
    expect(JSON.stringify(claim)).not.toContain(destination)
    const credential = await prisma.integrationCredential.findUnique({ where: { connectionId: result.connection.id } })
    const resolved = await createDispatchingSecretManager({ writableStore: store }).resolve(credential.secretRef, { tenantId: businessA.tenantId, businessId: businessA.id, connectionId: result.connection.id, destination })
    expect(JSON.parse(resolved.material)).toEqual(bundle)
    expect(await prisma.auditEvent.count({ where: { entityId: result.connection.id, action: 'CREDENTIAL_WRITTEN' } })).toBe(1)
  })

  it('refuses a wrong pair with one 422 and stores nothing (proof 5)', async () => {
    const line = fakeLine()
    const bundle = generateLineChannelBundle()
    line.register(bundle)
    const rejected = vi.fn()
    const before = await storedCount()
    for (const attempt of [{ ...bundle, channelId: String(Number(bundle.channelId) + 1) }, { ...bundle, channelSecret: generateLineChannelBundle().channelSecret }]) {
      const error = await connect({ businessId: businessA.id, name: 'Wrong', ...attempt }, ownerA, { lineAdmin: line.port, onValidationRejected: rejected }).catch(e => e)
      expect({ status: error.status, message: error.message }).toEqual({ status: 422, message: 'LINE_CREDENTIALS_REJECTED' })
    }
    expect(rejected).toHaveBeenCalledTimes(2)
    expect(await storedCount()).toEqual(before)
  })

  it('refuses an invalid body with a generic 400 before LINE is asked, and a non-owner with 404', async () => {
    const line = fakeLine()
    const bundle = generateLineChannelBundle()
    for (const body of [{ businessId: businessA.id, name: 'X', ...bundle, channelSecret: 'NOT-HEX' }, { businessId: businessA.id, name: 'X', ...bundle, secretRef: 'deployment-secret:x' }]) {
      const error = await connect(body, ownerA, { lineAdmin: line.port }).catch(e => e)
      expect({ status: error.status, message: error.message, issues: error.issues }).toEqual({ status: 400, message: 'CREDENTIAL_INPUT_INVALID', issues: undefined })
    }
    await expect(connect({ businessId: businessA.id, name: 'X', ...bundle }, member, { lineAdmin: line.port })).rejects.toMatchObject({ status: 404 })
    expect(line.port.validateChannel).not.toHaveBeenCalled()
  })

  it('a bot claimed in the same Tenant is ALREADY_CONNECTED, naming the sibling only to a viewer who sees it', async () => {
    const line = fakeLine()
    const bundle = generateLineChannelBundle()
    line.register(bundle)
    const first = await connect({ businessId: businessA.id, name: 'First', ...bundle }, ownerA, { lineAdmin: line.port })
    const before = await storedCount()

    const seen = await connect({ businessId: businessA2.id, name: 'Again', ...bundle }, ownerA, { lineAdmin: line.port }).catch(e => e)
    expect(seen).toMatchObject({ status: 409, message: 'LINE_CHANNEL_ALREADY_CONNECTED' })
    expect(seen.details).toEqual([{ code: 'LINE_CHANNEL_ALREADY_CONNECTED', message: expect.stringContaining('LINE'), businessId: businessA.id, connectionId: first.connection.id }])

    const unseen = await connect({ businessId: businessA2.id, name: 'Again', ...bundle }, ownerA2Only, { lineAdmin: line.port }).catch(e => e)
    expect(unseen).toMatchObject({ status: 409, message: 'LINE_CHANNEL_ALREADY_CONNECTED' })
    expect(unseen.details).toEqual([{ code: 'LINE_CHANNEL_ALREADY_CONNECTED', message: expect.any(String) }])
    expect(await storedCount()).toEqual(before)
  })

  it('a bot claimed in another Tenant is CLAIMED_ELSEWHERE, names nobody, and only after the secret is proved (proof 6)', async () => {
    const line = fakeLine()
    const bundle = generateLineChannelBundle()
    line.register(bundle)
    await connect({ businessId: businessA.id, name: 'Owner', ...bundle }, ownerA, { lineAdmin: line.port })
    const before = await storedCount()

    const wrongSecret = await connect({ businessId: businessB.id, name: 'Guess', ...bundle, channelSecret: generateLineChannelBundle().channelSecret }, ownerB, { lineAdmin: line.port }).catch(e => e)
    expect(wrongSecret.message).toBe('LINE_CREDENTIALS_REJECTED')

    const elsewhere = await connect({ businessId: businessB.id, name: 'Takeover', ...bundle }, ownerB, { lineAdmin: line.port }).catch(e => e)
    expect(elsewhere).toMatchObject({ status: 409, message: 'LINE_CHANNEL_CLAIMED_ELSEWHERE' })
    const told = JSON.stringify({ message: elsewhere.message, details: elsewhere.details })
    for (const hidden of [businessA.id, businessA.tenantId, 'Owner', 'Claim A']) expect(told).not.toContain(hidden)
    expect(elsewhere.details[0].message).toContain('พื้นที่ทำงานอื่น')
    expect(await storedCount()).toEqual(before)
  })

  it('a lost race is answered with the claim that won, and the loser leaves nothing', async () => {
    const destination = `U${randomBytes(16).toString('hex')}`
    await prisma.$transaction(tx => claimChannelAccount(tx, { externalAccountId: destination, tenantId: businessA.tenantId, businessId: businessA.id, connectionId: 'race-winner' }))
    await expect(prisma.$transaction(tx => claimChannelAccount(tx, { externalAccountId: destination, tenantId: businessB.tenantId, businessId: businessB.id, connectionId: 'race-loser' })))
      .rejects.toMatchObject({ status: 409, code: 'LINE_CHANNEL_CLAIMED_ELSEWHERE' })
    expect(await prisma.channelAccountClaim.count({ where: { connectionId: 'race-loser' } })).toBe(0)
  })

  it('a store failure after the claim removes the connection and the claim again', async () => {
    const line = fakeLine()
    const bundle = generateLineChannelBundle()
    line.register(bundle)
    const before = await storedCount()
    const brokenStore = { ...store, store: 'ENVELOPE', write: async () => { throw Object.assign(new Error('CHANNEL_SECRET_STORE_UNAVAILABLE'), { code: 'CHANNEL_SECRET_STORE_UNAVAILABLE', status: 503 }) } }
    await expect(connect({ businessId: businessA.id, name: 'Broken', ...bundle }, ownerA, { lineAdmin: line.port, store: brokenStore }))
      .rejects.toMatchObject({ status: 503, message: 'CHANNEL_SECRET_STORE_UNAVAILABLE' })
    expect(await storedCount()).toEqual(before)

    const failingActivate = { ...store, store: 'ENVELOPE', write: store.write, revoke: store.revoke, resolve: store.resolve, activate: async () => { throw new Error('database gone') } }
    await expect(connect({ businessId: businessA.id, name: 'Broken', ...bundle }, ownerA, { lineAdmin: line.port, store: failingActivate }))
      .rejects.toMatchObject({ status: 500, message: 'CREDENTIAL_ORPHAN_PURGED' })
    const after = await storedCount()
    expect(after.envelopes).toBe(before.envelopes)
    expect(after.claims).toBe(before.claims)
    expect(after.connections).toBe(before.connections)
    expect(await prisma.auditEvent.count({ where: { action: 'CREDENTIAL_ORPHAN_PURGED' } })).toBeGreaterThan(0)
  })

  it('refuses when no writable store is configured, before LINE is asked', async () => {
    const line = fakeLine()
    const bundle = generateLineChannelBundle()
    const error = await connectLineChannelWithSecret({ businessId: businessA.id, name: 'No store', ...bundle }, { viewer: ownerA, env: { NODE_ENV: 'test' }, ports: { lineAdmin: line.port, tokenCache } }).catch(e => e)
    expect(error).toMatchObject({ status: 503, message: 'CHANNEL_SECRET_STORE_UNAVAILABLE' })
    expect(line.port.validateChannel).not.toHaveBeenCalled()
  })
})
