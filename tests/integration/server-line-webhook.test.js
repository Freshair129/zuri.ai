import { createHmac } from 'node:crypto'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { registerIntegrationProvider, createIntegrationConnection, LINE_OA_PROVIDER_CODE } from '@/platform/integrations/core/integration-registry'
import { createServerLineWebhookPost } from '@/app/api/line-oa/accounts/[id]/webhook/route'
import { admitLineConversation } from '@/modules/line-oa-studio/application/line-conversation-jobs'

// @req FR-149 — signed native ingress authenticates before parsing/persistence and retries admission failures.
// @spec ADR-061, SEC-001, FR-081, FR-148
// @tested tests/integration/server-line-webhook.test.js

const secret = 'test-native-channel-secret'
const scope = { id: 'native-account', tenantId: 'native-tenant', businessId: 'native-business', connectionId: 'native-connection', destination: 'native-destination', channelSecret: secret }
const signatureFor = raw => createHmac('sha256', secret).update(Buffer.from(raw)).digest('base64')
const textEvent = { type: 'message', webhookEventId: 'native-event-1', replyToken: 'native-reply-token', source: { type: 'user', userId: 'native-user' }, message: { id: 'native-message-1', type: 'text', text: 'native question' } }
const body = events => JSON.stringify({ destination: scope.destination, events })
const request = (raw, signature = signatureFor(raw)) => new Request('http://local/api/line-oa/accounts/native-account/webhook', {
  method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': signature, 'x-correlation-id': 'corr-native-webhook' }, body: raw,
})
function harness(over = {}) {
  const resolveAccount = vi.fn(async () => scope)
  const record = vi.fn(async () => ({ recorded: true }))
  const evidenceFactory = vi.fn(async () => ({ connectionId: scope.connectionId, record }))
  const admit = vi.fn(async () => ({ created: true }))
  const handler = createServerLineWebhookPost({ db: {}, ports: () => ({ resolveAccount }), evidenceFactory, admit, ...over })
  return { handler, resolveAccount, record, evidenceFactory, admit }
}
const invoke = (handler, raw, signature) => handler(request(raw, signature), { params: { id: scope.id } })

describe('native LINE webhook trust boundary', () => {
  it('accepts a valid signed empty probe without creating evidence or conversation records', async () => {
    const h = harness()
    const response = await invoke(h.handler, body([]))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ accepted: true, correlationId: 'corr-native-webhook' })
    expect(h.record).not.toHaveBeenCalled()
    expect(h.admit).not.toHaveBeenCalled()
  })

  it('authenticates raw bytes before JSON parsing: malformed unsigned data gets 401, signed data gets 400', async () => {
    const h = harness()
    const raw = '{this is invalid JSON containing PRIVATE_EVENT_MATERIAL'
    const unsigned = await invoke(h.handler, raw, 'invalid-signature')
    expect(unsigned.status).toBe(401)
    expect(await unsigned.text()).not.toContain('PRIVATE_EVENT_MATERIAL')
    const signed = await invoke(h.handler, raw)
    expect(signed.status).toBe(400)
    expect(h.evidenceFactory).not.toHaveBeenCalled()
    expect(h.admit).not.toHaveBeenCalled()
  })

  it('rejects invalid signatures and signed destination mismatches before any persistence', async () => {
    const h = harness()
    expect((await invoke(h.handler, body([textEvent]), 'wrong')).status).toBe(401)
    const otherDestination = JSON.stringify({ destination: 'another-account', events: [textEvent] })
    expect((await invoke(h.handler, otherDestination)).status).toBe(403)
    expect(h.evidenceFactory).not.toHaveBeenCalled()
    expect(h.record).not.toHaveBeenCalled()
    expect(h.admit).not.toHaveBeenCalled()
  })

  it('uses exact signed bytes, then records evidence before admitting each event', async () => {
    const order = []
    const record = vi.fn(async () => { order.push('evidence') })
    const admit = vi.fn(async () => { order.push('admit') })
    const h = harness({ evidenceFactory: async () => ({ connectionId: scope.connectionId, record }), admit })
    const raw = ` { "destination": "${scope.destination}", "events": ${JSON.stringify([textEvent])} }\n`
    expect((await invoke(h.handler, raw)).status).toBe(200)
    expect(order).toEqual(['evidence', 'admit'])
    expect(admit).toHaveBeenCalledWith(expect.objectContaining({ account: scope, event: expect.objectContaining({ type: textEvent.type, message: textEvent.message, source: textEvent.source }), correlationId: 'corr-native-webhook' }))
    expect(admit.mock.calls[0][0].event.replyToken).toBe(textEvent.replyToken)
    expect(JSON.stringify(record.mock.calls[0][0])).not.toContain(textEvent.replyToken)
    // Normalizing before verification would incorrectly accept this changed body.
    expect((await invoke(h.handler, JSON.stringify(JSON.parse(raw)), signatureFor(raw))).status).toBe(401)
  })

  it('fails closed when the evidence connection is absent or belongs to another account', async () => {
    for (const evidence of [null, { connectionId: 'wrong-connection', record: vi.fn() }]) {
      const h = harness({ evidenceFactory: async () => evidence })
      expect((await invoke(h.handler, body([textEvent]))).status).toBe(503)
      expect(h.admit).not.toHaveBeenCalled()
      expect(evidence?.record?.mock.calls.length || 0).toBe(0)
    }
  })

  it('returns non-200 for evidence persistence failure and never admits that event', async () => {
    const admit = vi.fn()
    const h = harness({ admit, evidenceFactory: async () => ({ connectionId: scope.connectionId, record: async () => { throw new Error('PRIVATE_DB_SECRET') } }) })
    const response = await invoke(h.handler, body([textEvent]))
    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('PRIVATE_DB_SECRET')
    expect(admit).not.toHaveBeenCalled()
  })

  it('returns non-200 on admission failure so LINE can retry, without leaking the internal cause', async () => {
    const admit = vi.fn().mockRejectedValueOnce(new Error('PRIVATE_QUEUE_ERROR')).mockResolvedValueOnce({ created: true })
    const h = harness({ admit })
    const first = await invoke(h.handler, body([textEvent]))
    expect(first.status).toBe(503)
    expect(await first.text()).not.toContain('PRIVATE_QUEUE_ERROR')
    expect((await invoke(h.handler, body([textEvent]))).status).toBe(200)
    expect(h.record).toHaveBeenCalledTimes(2)
    expect(admit).toHaveBeenCalledTimes(2)
  })

  it('rejects an oversized body before parsing or persistence', async () => {
    const h = harness()
    expect((await invoke(h.handler, 'x'.repeat(1024 * 1024 + 1))).status).toBe(413)
    expect(h.evidenceFactory).not.toHaveBeenCalled()
    expect(h.admit).not.toHaveBeenCalled()
  })

  // A deterministic rejection belongs to one event. Aborting the batch on it
  // loses every later event permanently, because the redelivery fails at the
  // same event every time.
  it('skips one event that fails deterministically and still admits the rest', async () => {
    const events = [
      { ...textEvent, webhookEventId: 'native-event-a', message: { id: 'native-message-a', type: 'text', text: 'first' } },
      { ...textEvent, webhookEventId: 'native-event-b', message: { id: 'native-message-b', type: 'text', text: 'poison' } },
      { ...textEvent, webhookEventId: 'native-event-c', message: { id: 'native-message-c', type: 'text', text: 'third' } },
    ]
    const admit = vi.fn(async ({ event }) => {
      if (event.webhookEventId === 'native-event-b') throw Object.assign(new Error('CHANNEL_IDENTITY_COMPATIBILITY_CONFLICT'), { status: 409 })
      return { created: true }
    })
    const h = harness({ admit })
    const response = await invoke(h.handler, body(events))

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ accepted: true, skipped: 1 })
    expect(admit.mock.calls.map(([{ event }]) => event.webhookEventId))
      .toEqual(['native-event-a', 'native-event-b', 'native-event-c'])
  })

  it('still asks LINE to redeliver when an event fails ambiguously, after attempting the whole batch', async () => {
    const events = [
      { ...textEvent, webhookEventId: 'native-event-d', message: { id: 'native-message-d', type: 'text', text: 'first' } },
      { ...textEvent, webhookEventId: 'native-event-e', message: { id: 'native-message-e', type: 'text', text: 'transient' } },
      { ...textEvent, webhookEventId: 'native-event-f', message: { id: 'native-message-f', type: 'text', text: 'third' } },
    ]
    const admit = vi.fn(async ({ event }) => {
      if (event.webhookEventId === 'native-event-e') throw new Error('PRIVATE_QUEUE_ERROR')
      return { created: true }
    })
    const response = await invoke(harness({ admit }).handler, body(events))

    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('PRIVATE_QUEUE_ERROR')
    // The neighbours are attempted rather than abandoned; redelivery is
    // idempotent, so attempting them costs nothing and losing them costs a message.
    expect(admit).toHaveBeenCalledTimes(3)
  })
})

describe('native webhook retry with durable SQLite admission', () => {
  let oa
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Native webhook', code: 'PF-NATIVE-WEBHOOK' })
    const tenant = await createTenant({ portfolioId: portfolio.id, name: 'Native webhook tenant', code: 'TNT-NATIVE-WEBHOOK' })
    const business = await createBusiness({ tenantId: tenant.id, name: 'Native webhook business', code: 'BUS-NATIVE-WEBHOOK' })
    const provider = await registerIntegrationProvider({ code: LINE_OA_PROVIDER_CODE, name: 'LINE OA' })
    const connection = await createIntegrationConnection({ tenantId: tenant.id, businessId: business.id, providerId: provider.id, name: 'Native webhook connection', externalAccountId: scope.destination, status: 'ACTIVE' })
    oa = await prisma.lineOaAccount.create({ data: { tenantId: tenant.id, businessId: business.id, integrationConnectionId: connection.id, code: 'native-webhook-account', displayName: 'Native webhook OA', bindingCode: 'native-webhook-binding', status: 'CONNECTED', serverEnabled: true, transportMode: 'CLOUD' } })
    oa = { ...oa, channelSecret: secret, destination: scope.destination, connectionId: connection.id }
  })

  it('replays a partially admitted batch into exactly one job/message per event', async () => {
    const second = { ...textEvent, webhookEventId: 'native-event-2', message: { ...textEvent.message, id: 'native-message-2', text: 'second question' } }
    let firstPass = true
    const admit = vi.fn(async args => {
      if (args.event.webhookEventId === second.webhookEventId && firstPass) {
        firstPass = false
        throw new Error('TRANSIENT_QUEUE_FAILURE')
      }
      return admitLineConversation({ ...args, env: { ZURI_LINE_REPLY_SEAL_KEY: 'e3'.repeat(32) } })
    })
    const record = vi.fn(async () => ({}))
    const handler = createServerLineWebhookPost({ db: prisma, ports: () => ({ resolveAccount: async () => oa }),
      evidenceFactory: async () => ({ connectionId: oa.connectionId, record }), admit })
    const raw = body([textEvent, second])
    try {
      expect((await invoke(handler, raw)).status).toBe(503)
      expect(await prisma.lineConversationJob.count({ where: { accountId: oa.id } })).toBe(1)
      expect((await invoke(handler, raw)).status).toBe(200)
      expect((await invoke(handler, raw)).status).toBe(200)
      const jobs = await prisma.lineConversationJob.findMany({ where: { accountId: oa.id }, include: { inbound: true } })
      expect(jobs).toHaveLength(2)
      expect(new Set(jobs.map(job => job.inboundMessageId)).size).toBe(2)
      expect(await prisma.message.count({ where: { conversationId: jobs[0].inbound.conversationId } })).toBe(2)
      expect(record).toHaveBeenCalledTimes(6)
    } finally { await prisma.lineConversationJob.deleteMany({ where: { accountId: oa.id } }) }
  })
})
