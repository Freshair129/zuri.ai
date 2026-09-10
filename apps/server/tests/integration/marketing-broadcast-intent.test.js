import { beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { listLineOaAccounts } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { createMarketingContentRepository } from '@/modules/marketing/infrastructure/marketing-content-repository'
import { createMarketingContent } from '@/modules/marketing/application/marketing-content-service'
import { criteriaHash } from '@/modules/marketing/domain/marketing-broadcast-contract'
import {
  createMarketingBroadcastIntent,
  getMarketingBroadcastIntent,
  listMarketingBroadcastIntents,
  updateMarketingBroadcastIntent,
} from '@/modules/marketing/application/marketing-broadcast-service'
import { getMarketingPaidMedia, askMarketing } from '@/modules/marketing/application/marketing-insights-service'

// @req FR-185 — real Marketing Content and LINE OA owner DTOs back the
// Business-scoped planning intent; revisions, CAS, redaction and hidden-scope
// refusals are exercised against the actual SQLite schema.
// @spec SDD-086, SEC-001, SEC-003
// @tested tests/integration/marketing-broadcast-intent.test.js

const DOMAINS = ['projects', 'people', 'platform', 'growth', 'line-oa']
const NOW = new Date('2026-09-11T00:00:00.000Z')
let businessA, businessB, ownerA, account, accountB, content

function contentPayload() {
  return {
    objective: 'Publish an approved product story', audience: 'Thai SME owners', message: 'A clear product message',
    claims: 'Only owner evidence-backed claims', shotList: 'Opening, proof, closing', acceptanceCriteria: 'Readable and approved',
    evidenceReference: 'facts://marketing/broadcast-test', format: 'IMAGE', initiativeId: null, channels: ['SEO'], asset: null, rights: null, production: null,
  }
}

function broadcastPayload(selectedAccount = account) {
  return {
    channel: 'LINE', account: { lineOaAccountId: selectedAccount.id, accountVersion: selectedAccount.version },
    content: { briefId: content.id, contentVersionId: content.currentVersion.id, payloadHash: content.currentVersion.payloadHash },
    audience: { source: 'CRM_CONVERSATION_READ_MODEL', sourceVersion: null, audienceSpecVersion: '1.0', filter: { consentStatus: 'GRANTED' }, criteriaHash: criteriaHash(), resolutionState: 'UNAVAILABLE', resolutionRef: null },
    consent: { source: 'CRM_CUSTOMER.consentStatus', requiredValue: 'GRANTED', policyReference: 'FR-103', policyVersion: null, snapshotRef: null, snapshotVersion: null, state: 'UNAVAILABLE' },
  }
}

describe('Marketing broadcast intent persistence (FR-185)', () => {
  beforeAll(async () => {
    const suffix = randomUUID().slice(0, 8).toUpperCase()
    const portfolio = await createPortfolio({ code: `PF-BRD-${suffix}`, name: `Broadcast ${suffix}` })
    const tenantA = await createTenant({ portfolioId: portfolio.id, code: `TNT-BRD-${suffix}`, name: `Broadcast tenant ${suffix}` })
    const tenantB = await createTenant({ portfolioId: portfolio.id, code: `TNT-BRD-B-${suffix}`, name: `Other tenant ${suffix}` })
    businessA = await createBusiness({ tenantId: tenantA.id, code: `BUS-BRD-${suffix}`, name: `Broadcast business ${suffix}` })
    businessB = await createBusiness({ tenantId: tenantB.id, code: `BUS-BRD-B-${suffix}`, name: `Other business ${suffix}` })
    ownerA = makeViewer({ principal: { id: `broadcast-owner-${suffix}` }, visibleBusinessIds: [businessA.id], ownedBusinessIds: [businessA.id], visibleDomains: DOMAINS })
    const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE Official Account' })
    const connection = await createIntegrationConnection({ tenantId: tenantA.id, businessId: businessA.id, providerId: provider.id, name: `Broadcast connection ${suffix}`, externalAccountId: `broadcast-oa-${suffix}`, status: 'ACTIVE' })
    const connectionB = await createIntegrationConnection({ tenantId: tenantB.id, businessId: businessB.id, providerId: provider.id, name: `Broadcast connection B ${suffix}`, externalAccountId: `broadcast-oa-b-${suffix}`, status: 'ACTIVE' })
    account = await prisma.lineOaAccount.create({ data: { tenantId: tenantA.id, businessId: businessA.id, integrationConnectionId: connection.id, code: `broadcast-account-${suffix}`, displayName: 'Broadcast test OA', bindingCode: `broadcast-binding-${suffix}`, status: 'CONNECTED', transportMode: 'CLOUD' } })
    accountB = await prisma.lineOaAccount.create({ data: { tenantId: tenantB.id, businessId: businessB.id, integrationConnectionId: connectionB.id, code: `broadcast-account-b-${suffix}`, displayName: 'Other broadcast test OA', bindingCode: `broadcast-binding-b-${suffix}`, status: 'CONNECTED', transportMode: 'CLOUD' } })
    const accountRead = await listLineOaAccounts({ businessId: businessA.id, viewer: ownerA, db: prisma })
    expect(accountRead.accounts).toEqual(expect.arrayContaining([expect.objectContaining({ id: account.id, version: 1 })]))
    content = await createMarketingContent({ businessId: businessA.id, title: `Broadcast content ${suffix}`, payload: contentPayload() }, { db: prisma, viewer: ownerA, createRepository: createMarketingContentRepository, now: () => NOW })
  })

  it('creates through real owner references and keeps the read model dispatch-free', async () => {
    const created = await createMarketingBroadcastIntent({ businessId: businessA.id, idempotencyKey: `broadcast-request-${randomUUID()}`, code: `BRD-TEST-${randomUUID().slice(0, 6)}`, payload: broadcastPayload() }, { db: prisma, viewer: ownerA, now: () => NOW })
    expect(created).toMatchObject({ businessId: businessA.id, status: 'PLANNING', currentRevision: 1, version: 1, referenceState: { state: 'READY' }, dispatch: { state: 'UNAVAILABLE' } })
    expect(created.currentVersion.payload).toBeTruthy()
    expect(created.currentVersion.payload).not.toHaveProperty('message')
    const read = await getMarketingBroadcastIntent({ id: created.id, businessId: businessA.id, viewer: ownerA }, { db: prisma, now: () => NOW })
    expect(read.referenceState.state).toBe('READY')
    expect(read.dispatch.reasonCode).toBe('LINE_BROADCAST_OWNER_CONTRACT_UNAVAILABLE')
  })

  it('appends revisions with CAS and refuses a hidden Business', async () => {
    const created = await createMarketingBroadcastIntent({ businessId: businessA.id, idempotencyKey: `broadcast-cas-${randomUUID()}`, payload: broadcastPayload() }, { db: prisma, viewer: ownerA, now: () => NOW })
    const revised = await updateMarketingBroadcastIntent(created.id, { action: 'revise', businessId: businessA.id, expectedVersion: 1, payload: broadcastPayload() }, { db: prisma, viewer: ownerA, now: () => NOW })
    expect(revised).toMatchObject({ currentRevision: 2, version: 2, canWrite: true })
    expect(await prisma.marketingBroadcastIntentVersion.count({ where: { intentId: created.id } })).toBe(2)
    await expect(updateMarketingBroadcastIntent(created.id, { action: 'archive', businessId: businessA.id, expectedVersion: 1 }, { db: prisma, viewer: ownerA, now: () => NOW })).rejects.toMatchObject({ status: 409 })
    const hidden = makeViewer({ principal: { id: `broadcast-hidden-${businessB.id}` }, visibleBusinessIds: [businessB.id], ownedBusinessIds: [businessB.id], visibleDomains: DOMAINS })
    await expect(getMarketingBroadcastIntent({ id: created.id, businessId: businessA.id, viewer: hidden }, { db: prisma })).rejects.toMatchObject({ status: 404 })
  })

  it('replays the original request after revision without treating current revision as an idempotency conflict', async () => {
    const key = `broadcast-replay-${randomUUID()}`
    const created = await createMarketingBroadcastIntent({ businessId: businessA.id, idempotencyKey: key, payload: broadcastPayload() }, { db: prisma, viewer: ownerA, now: () => NOW })
    await updateMarketingBroadcastIntent(created.id, { action: 'revise', businessId: businessA.id, expectedVersion: 1, payload: broadcastPayload() }, { db: prisma, viewer: ownerA, now: () => NOW })
    const replay = await createMarketingBroadcastIntent({ businessId: businessA.id, idempotencyKey: key, payload: broadcastPayload() }, { db: prisma, viewer: ownerA, now: () => NOW })
    expect(replay).toMatchObject({ id: created.id, currentRevision: 2, version: 2 })
  })

  it('archives without deleting reviewable revision history', async () => {
    const created = await createMarketingBroadcastIntent({ businessId: businessA.id, idempotencyKey: `broadcast-archive-${randomUUID()}`, payload: broadcastPayload() }, { db: prisma, viewer: ownerA, now: () => NOW })
    const archived = await updateMarketingBroadcastIntent(created.id, { action: 'archive', businessId: businessA.id, expectedVersion: created.version }, { db: prisma, viewer: ownerA, now: () => NOW })
    expect(archived).toMatchObject({ status: 'ARCHIVED', canWrite: false, deletedAt: null })
    const reopened = await getMarketingBroadcastIntent({ id: created.id, businessId: businessA.id, viewer: ownerA }, { db: prisma, now: () => NOW })
    expect(reopened.revisions).toHaveLength(1)
    const listed = await listMarketingBroadcastIntents({ businessId: businessA.id, viewer: ownerA }, { db: prisma, now: () => NOW })
    expect(listed.intents).toEqual(expect.arrayContaining([expect.objectContaining({ id: created.id, status: 'ARCHIVED' })]))
  })

  it('rejects a supplied LINE account from another Business before persistence', async () => {
    await expect(createMarketingBroadcastIntent({
      businessId: businessA.id,
      idempotencyKey: `broadcast-cross-business-${randomUUID()}`,
      payload: broadcastPayload(accountB),
    }, { db: prisma, viewer: ownerA, now: () => NOW })).rejects.toMatchObject({ status: 422, message: 'BROADCAST_LINE_ACCOUNT_UNAVAILABLE' })
  })

  it('uses real owner projections and keeps missing paid metrics unavailable', async () => {
    const paid = await getMarketingPaidMedia({ businessId: businessA.id, viewer: ownerA }, {
      db: prisma, from: '2026-09-01', to: '2026-09-11', now: () => NOW,
    })
    expect(paid.metrics.every((metric) => metric.value === null && metric.state === 'UNAVAILABLE')).toBe(true)
    expect(paid.sources).toEqual(expect.arrayContaining([
      expect.objectContaining({ owner: 'INTEGRATION', source: 'PAID_MEDIA_METRICS', state: 'UNAVAILABLE' }),
      expect.objectContaining({ owner: 'COMMERCE', source: 'VERIFIED_REVENUE', window: { from: '2026-09-01', to: '2026-09-11' } }),
    ]))
    const overview = await askMarketing({ businessId: businessA.id, question: 'overview' }, { db: prisma, viewer: ownerA, now: () => NOW })
    expect(overview).toMatchObject({ readModel: 'MARKETING_ASK', intentType: 'EXECUTIVE_OVERVIEW' })
    expect(overview.answer.recommendations).toEqual([])
  })
})
