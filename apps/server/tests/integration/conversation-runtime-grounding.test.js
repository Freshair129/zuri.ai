import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { applyLineOaAccountAction } from '@/modules/line-oa-studio/application/line-oa-account-service'
import { admitLineConversation, claimRuntimeConversationJob } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { CONVERSATION_RUNTIME_GROUNDING_MODES, conversationRuntimeServesGroundingMode } from '@/modules/agent/line-knowledge-grounding'

// @req FR-149, FR-235 — the Conversation Runtime cohort only admits turns whose
// account grounding mode Core `prepare` can serve; everything else stays SERVER.
// @spec ADR-106 D3, ADR-090 D1 — eligibility is Core-owned and decided at admission.
// @tested tests/integration/conversation-runtime-grounding.test.js
const sealKey = '6d'.repeat(32)
const lineUser = 'synthetic-grounding-line-user'
const UNSERVED = ['GKS_CORPUS', 'GKS_THEN_BUSINESS_KNOWLEDGE']

let tenant, business, provider, actor, ownerViewer
let openJobs = []
let accountSeq = 0

async function createAccount({ runtimeOwner = 'SERVER', knowledgeGrounding = 'BUSINESS_KNOWLEDGE' } = {}) {
  accountSeq += 1
  const suffix = `grounding-${accountSeq}`
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id,
    providerId: provider.id, name: `Synthetic ${suffix} connection`, externalAccountId: `synthetic-${suffix}-destination`, status: 'ACTIVE' })
  const account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: `cr-${suffix}`, displayName: `Synthetic ${suffix} OA`,
    bindingCode: `cr-${suffix}-binding`, status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD',
    runtimeOwner, knowledgeGrounding } })
  const linkedAt = new Date()
  await prisma.channelIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, channel: 'LINE',
    channelAccountId: account.bindingCode, providerSubject: lineUser, status: 'ACTIVE', verifiedAt: linkedAt, linkedAt } })
  return account
}

async function admit(accountId, eventId, text = 'AB-1 ราคาเท่าไร') {
  const current = await prisma.lineOaAccount.findUnique({ where: { id: accountId } })
  const { jobId } = await admitLineConversation({ db: prisma, account: current,
    env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey }, correlationId: eventId, now: new Date(),
    event: { type: 'message', webhookEventId: eventId, replyToken: `synthetic-reply-${eventId}`, timestamp: Date.now(),
      source: { type: 'user', userId: lineUser }, message: { type: 'text', id: `synthetic-message-${eventId}`, text } } })
  openJobs.push(jobId)
  return prisma.lineConversationJob.findUnique({ where: { id: jobId } })
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Runtime grounding fixture', code: 'PF-CR-GROUNDING' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Runtime grounding tenant', code: 'TNT-CR-GROUNDING' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Runtime grounding business', code: 'BUS-CR-GROUNDING' })
  actor = await prisma.person.create({ data: { code: 'PER-CR-GROUNDING', displayName: 'Synthetic grounding actor' } })
  await prisma.membership.create({ data: { personId: actor.id, tenantId: tenant.id, businessId: business.id, role: 'OWNER' } })
  ownerViewer = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
    visibleDomains: ['projects', 'people', 'platform', 'line-oa'] })
  provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const linkedAt = new Date()
  await prisma.externalIdentity.create({ data: { tenantId: tenant.id, personId: actor.id, provider: 'LINE',
    providerSubject: lineUser, verifiedAt: linkedAt, linkedAt } })
})

afterEach(async () => {
  // Leave nothing claimable for the next case or the next suite in this run.
  await prisma.lineConversationJob.updateMany({ where: { id: { in: openJobs }, status: { in: ['QUEUED', 'CLAIMED', 'READY'] } },
    data: { status: 'CANCELLED', errorCode: 'TEST_RUNTIME_GROUNDING_DONE', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  openJobs = []
})

describe('Conversation Runtime grounding-mode eligibility guard', () => {
  it('the runtime serves exactly BUSINESS_KNOWLEDGE, checked on the raw stored value', () => {
    expect(CONVERSATION_RUNTIME_GROUNDING_MODES).toEqual(['BUSINESS_KNOWLEDGE'])
    expect(conversationRuntimeServesGroundingMode('BUSINESS_KNOWLEDGE')).toBe(true)
    for (const mode of [...UNSERVED, 'NOT_A_REAL_MODE', undefined, null]) expect(conversationRuntimeServesGroundingMode(mode)).toBe(false)
  })

  it('BUSINESS_KNOWLEDGE: an opted-in account still admits eligible direct turns to the runtime cohort', async () => {
    const account = await createAccount({ runtimeOwner: 'CONVERSATION_RUNTIME' })
    const job = await admit(account.id, 'synthetic-grounding-business-knowledge')
    expect(job).toMatchObject({ executionMode: 'SERVER', runtimeOwner: 'CONVERSATION_RUNTIME', status: 'QUEUED' })
  })

  for (const mode of UNSERVED) {
    it(`${mode}: CONFIGURE_EXECUTION refuses to opt the account in with a typed 409 and leaves it SERVER-owned`, async () => {
      const account = await createAccount({ knowledgeGrounding: mode })
      await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_EXECUTION', version: account.version,
        allowDelayedPush: account.allowDelayedPush, runtimeOwner: 'CONVERSATION_RUNTIME' }, { viewer: ownerViewer }))
        .rejects.toMatchObject({ status: 409, message: 'LINE_OA_RUNTIME_GROUNDING_MODE_UNSUPPORTED' })
      expect(await prisma.lineOaAccount.findUnique({ where: { id: account.id }, select: { runtimeOwner: true, version: true } }))
        .toEqual({ runtimeOwner: 'SERVER', version: account.version })
      // Delivery-policy changes that do not select the runtime stay allowed.
      const updated = await applyLineOaAccountAction(account.id, { action: 'CONFIGURE_EXECUTION', version: account.version,
        allowDelayedPush: account.allowDelayedPush, runtimeOwner: 'SERVER' }, { viewer: ownerViewer })
      expect(updated.runtimeOwner).toBe('SERVER')
    })

    it(`${mode}: a runtime-owned account (restored or pre-guard row) admits to SERVER, never to a runtime job that fails at prepare`, async () => {
      const account = await createAccount({ runtimeOwner: 'CONVERSATION_RUNTIME', knowledgeGrounding: mode })
      const job = await admit(account.id, `synthetic-grounding-admit-${mode}`)
      expect(job).toMatchObject({ executionMode: 'SERVER', runtimeOwner: 'SERVER', status: 'QUEUED' })
      expect(await claimRuntimeConversationJob({ db: prisma, claimantId: `runtime-grounding-${mode}`, now: () => new Date() })).toBeNull()
    })

    it(`${mode}: CONFIGURE_KNOWLEDGE_GROUNDING refuses the switch while the account is runtime-owned`, async () => {
      const account = await createAccount({ runtimeOwner: 'CONVERSATION_RUNTIME' })
      await expect(applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: account.version,
        knowledgeGrounding: mode }, { viewer: ownerViewer }))
        .rejects.toMatchObject({ status: 409, message: 'LINE_OA_RUNTIME_GROUNDING_MODE_UNSUPPORTED' })
      expect((await prisma.lineOaAccount.findUnique({ where: { id: account.id } })).knowledgeGrounding).toBe('BUSINESS_KNOWLEDGE')
    })
  }

  it('an unrecognised stored mode stays in the SERVER cohort even when the account is runtime-owned', async () => {
    const account = await createAccount({ runtimeOwner: 'CONVERSATION_RUNTIME', knowledgeGrounding: 'NOT_A_REAL_MODE' })
    const job = await admit(account.id, 'synthetic-grounding-unknown-mode')
    expect(job).toMatchObject({ runtimeOwner: 'SERVER' })
  })

  it('a SERVER-owned account may still switch to any grounding mode', async () => {
    const account = await createAccount()
    const updated = await applyLineOaAccountAction(account.id, { action: 'CONFIGURE_KNOWLEDGE_GROUNDING', version: account.version,
      knowledgeGrounding: 'GKS_CORPUS' }, { viewer: ownerViewer })
    expect(updated.knowledgeGrounding).toBe('GKS_CORPUS')
  })
})
