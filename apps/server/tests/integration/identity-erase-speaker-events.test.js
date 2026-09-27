import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createLineOaEvidenceRecorder } from '@/platform/integrations/providers/line/line-oa-evidence'
import { admitLineConversation } from '@/modules/line-oa-studio/application/line-conversation-jobs'
import { findSpeakerConversationEventKeys } from '@/modules/crm/conversation-redaction-service'
import { erasePrincipal } from '@/modules/identity/erase-principal'

// @req FR-022 — PDPA erasure reaches the raw webhook payload of the erased person's own
// postback (and follow/unfollow) events, in a shared LINE group or room thread and in
// their direct chat alike. The raw record is keyed by LINE's webhookEventId — the same
// id the ConversationEvent stores — which no message id or provider subject matches,
// so before this change every such payload (postback `data`, the sender's LINE user
// id) survived the erasure. Another member's events are never touched.
// The same keying hides a MESSAGE event's raw record from a match by message id: LINE
// sends a webhookEventId with every event, and the record is keyed by it. Erasure also
// finds those records by the message id inside the payload.
// @spec SEC-001, SEC-005, FR-081
// @tested tests/integration/identity-erase-speaker-events.test.js

const sealKey = '7e'.repeat(32)
const destination = 'synthetic-erase-evt-destination'
let tenant, business, account, evidence
let sequence = 0
const next = (label) => `${label}-${++sequence}`

function sourceOf({ type, thread, speaker }) {
  return type === 'group' ? { type: 'group', groupId: thread, userId: speaker }
    : type === 'room' ? { type: 'room', roomId: thread, userId: speaker } : { type: 'user', userId: speaker }
}

/** Admit one LINE event through the real ingress path: raw evidence first, then admission. */
async function deliver(event) {
  const record = await evidence.record({ body: { destination, events: [event] }, event })
  const current = await prisma.lineOaAccount.findUnique({ where: { id: account.id } })
  const admitted = await admitLineConversation({ db: prisma, account: current, env: { ZURI_LINE_REPLY_SEAL_KEY: sealKey },
    correlationId: event.webhookEventId, now: new Date(), event })
  return { ...admitted, rawRecordId: record.rawRecordId, externalId: record.externalId }
}

const say = ({ type = 'group', thread, speaker, text }) => {
  const id = next('synthetic-erase-evt-msg')
  return deliver({ type: 'message', webhookEventId: next('synthetic-erase-evt-wh'), timestamp: Date.now(),
    source: sourceOf({ type, thread, speaker }), message: { type: 'text', id, text } })
}

const postback = ({ type = 'group', thread, speaker, data }) => deliver({ type: 'postback',
  webhookEventId: next('synthetic-erase-evt-wh'), timestamp: Date.now(), replyToken: next('synthetic-erase-evt-reply'),
  source: sourceOf({ type, thread, speaker }), postback: { data } })

const follow = ({ speaker }) => deliver({ type: 'follow', webhookEventId: next('synthetic-erase-evt-wh'),
  timestamp: Date.now(), source: { type: 'user', userId: speaker } })

const payloadOf = async (id) => (await prisma.rawExternalRecord.findUnique({ where: { id } })).payloadJson

async function personOf(subject) {
  const identity = await prisma.channelIdentity.findFirst({ where: { tenantId: tenant.id, providerSubject: subject } })
  return identity.personId
}

/**
 * A group (or room) thread where A speaks first — so A's Customer owns it — then B;
 * each taps a postback there. B also follows the OA and taps a postback in a direct chat.
 */
async function scene(type = 'group') {
  const A = next(`Usynthetic-erase-evt-a-${type}`)
  const B = next(`Usynthetic-erase-evt-b-${type}`)
  const thread = next(type === 'group' ? 'Csynthetic-erase-evt-grp' : 'Rsynthetic-erase-evt-room')
  const aSay = await say({ type, thread, speaker: A, text: 'A opens the thread' })
  const bSay = await say({ type, thread, speaker: B, text: 'B joins in' })
  const aPostback = await postback({ type, thread, speaker: A, data: 'action=track&order=A-1' })
  const bPostback = await postback({ type, thread, speaker: B, data: 'action=track&order=B-1' })
  const bFollow = await follow({ speaker: B })
  const bDirectPostback = await postback({ type: 'user', thread: B, speaker: B, data: 'action=address&home=B-house' })
  return { A, B, thread, aSay, bSay, aPostback, bPostback, bFollow, bDirectPostback, personA: await personOf(A), personB: await personOf(B) }
}

async function expectTombstoned(rawRecordId) {
  expect(JSON.parse(await payloadOf(rawRecordId))).toMatchObject({ redacted: true, reason: 'PDPA_ERASURE' })
}

beforeAll(async () => {
  const portfolio = await createPortfolio({ name: 'Speaker event erasure fixture', code: 'PF-ERASE-EVT' })
  tenant = await createTenant({ portfolioId: portfolio.id, name: 'Speaker event erasure tenant', code: 'TNT-ERASE-EVT' })
  business = await createBusiness({ tenantId: tenant.id, name: 'Speaker event erasure business', code: 'BUS-ERASE-EVT' })
  const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
  const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id,
    name: 'Synthetic event erasure connection', externalAccountId: destination, status: 'ACTIVE' })
  account = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id,
    integrationConnectionId: connection.id, code: 'erase-evt', displayName: 'Synthetic event erasure OA',
    bindingCode: 'erase-evt-binding', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD',
    allowDelayedPush: true } })
  evidence = await createLineOaEvidenceRecorder({ db: prisma, tenantId: tenant.id, businessId: business.id, destination })
})

describe('PDPA erasure of a speaker\'s own LINE postback payloads (FR-022)', () => {
  for (const type of ['group', 'room']) {
    it(`erasing a later speaker (B) in a ${type} tombstones B's postbacks and follow, and leaves A's`, async () => {
      const s = await scene(type)
      // The raw record is keyed by the webhook event id the ConversationEvent stores.
      expect(await prisma.conversationEvent.findUnique({ where: { id: s.bPostback.eventId } }))
        .toMatchObject({ kind: 'POSTBACK', externalEventId: s.bPostback.externalId })
      expect(await payloadOf(s.bPostback.rawRecordId)).toContain('order=B-1')

      const result = await erasePrincipal({ tenantId: tenant.id, personId: s.personB, reason: 'TEST_ERASURE' })

      // In the thread A's Customer owns, and in B's direct chat.
      await expectTombstoned(s.bPostback.rawRecordId)
      await expectTombstoned(s.bDirectPostback.rawRecordId)
      await expectTombstoned(s.bFollow.rawRecordId)
      expect(await payloadOf(s.aPostback.rawRecordId)).toContain('order=A-1')
      // The event rows stay as the envelope (they hold ids only).
      expect(await prisma.conversationEvent.findUnique({ where: { id: s.bPostback.eventId } })).toMatchObject({ kind: 'POSTBACK' })
      // B's own group message, keyed by its webhook event id like every real LINE event.
      expect(s.bSay.externalId).not.toBe((await prisma.message.findUnique({ where: { id: s.bSay.inboundMessageId } })).externalMessageId)
      await expectTombstoned(s.bSay.rawRecordId)
      expect(await payloadOf(s.aSay.rawRecordId)).toContain('A opens the thread')
      // Exactly B's four records: the group message, the two postbacks and the follow.
      expect(result.tombstonedRawRecords).toBe(4)
      const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'PRINCIPAL', entityId: s.personB, action: 'ERASED' } })
      expect(JSON.parse(audit.payloadJson).tombstonedRawRecords).toBe(4)
    })
  }

  it('erasing the first speaker (A) tombstones only A\'s postback', async () => {
    const s = await scene('group')

    await erasePrincipal({ tenantId: tenant.id, personId: s.personA, reason: 'TEST_ERASURE' })

    await expectTombstoned(s.aPostback.rawRecordId)
    await expectTombstoned(s.aSay.rawRecordId)
    expect(await payloadOf(s.bSay.rawRecordId)).toContain('B joins in')
    expect(await payloadOf(s.bPostback.rawRecordId)).toContain('order=B-1')
    expect(await payloadOf(s.bDirectPostback.rawRecordId)).toContain('home=B-house')
    expect(await payloadOf(s.bFollow.rawRecordId)).toContain(s.B)
  })

  it('selects a speaker\'s shared-thread events only on their own channel account', async () => {
    const s = await scene('group')
    const customerB = await prisma.customer.findFirst({ where: { tenantId: tenant.id, personId: s.personB } })

    const onOtherAccount = await findSpeakerConversationEventKeys(prisma, { tenantId: tenant.id,
      customerIds: [customerB.id], channelIdentities: [{ channel: 'LINE', channelAccountId: 'some-other-binding' }] })
    expect(onOtherAccount.externalEventIds).toEqual([])

    const onOwnAccount = await findSpeakerConversationEventKeys(prisma, { tenantId: tenant.id,
      customerIds: [customerB.id], channelIdentities: [{ channel: 'LINE', channelAccountId: account.bindingCode }] })
    expect(onOwnAccount.externalEventIds).toEqual(expect.arrayContaining([s.bPostback.externalId, s.bFollow.externalId,
      s.bDirectPostback.externalId]))
    expect(onOwnAccount.externalEventIds).not.toContain(s.aPostback.externalId)
  })

  it('is idempotent: a second erasure changes no raw record', async () => {
    const s = await scene('group')
    await erasePrincipal({ tenantId: tenant.id, personId: s.personB, reason: 'TEST_ERASURE' })
    const ids = [s.aSay, s.bSay, s.aPostback, s.bPostback, s.bFollow, s.bDirectPostback].map((row) => row.rawRecordId)
    const before = await prisma.rawExternalRecord.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } })

    const second = await erasePrincipal({ tenantId: tenant.id, personId: s.personB, reason: 'TEST_ERASURE' })

    expect(second.tombstonedRawRecords).toBe(0)
    expect(await prisma.rawExternalRecord.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } })).toEqual(before)
    await expectTombstoned(s.bPostback.rawRecordId)
    await expectTombstoned(s.bSay.rawRecordId)
    expect(await payloadOf(s.aSay.rawRecordId)).toContain('A opens the thread')
    expect(await payloadOf(s.aPostback.rawRecordId)).toContain('order=A-1')
  })
})
