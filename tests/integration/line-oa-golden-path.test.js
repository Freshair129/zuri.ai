import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { createLineWebhookPost } from '@/app/api/agent/line-webhook/route'

// @req FR-028 — the LINE webhook seam end to end.
// @req FR-050 — one verified event produces at most one model request and one reply.
// @req FR-052 — scope comes only from the server-owned binding.
// @spec BR-011 — zuri-cli owns LINE signature verification and the Reply API; ZURI owns
//   knowledge/provider/answer policy and returns the verified reply text. The outbound
//   LINE Messaging API hop is therefore deliberately outside this repository and is NOT
//   asserted here — this test proves every hop ZURI actually owns.
// @spec BR-012, SEC-009, SEC-010 — server authority, deny-by-default, no PII/secret leak.
//
// THE GOLDEN PATH — one authentic event, every ZURI-owned hop asserted:
//   binding-authenticated request -> trusted tenant/business scope -> LINE identity ->
//   customer -> conversation -> persisted message -> grounded orchestration -> verified
//   reply -> audit trail -> idempotent on redelivery.

let tenant, business

const DESTINATION = 'Uzuri-smartgift-oa'
const BINDING_ID = '84ed2c90-ab44-46f3-9618-1f24df0744b9'
const BEARER = 'Bearer binding-bearer-secret-long-enough-for-the-resolver'
const REPLY_TOKEN = 'reply-token-must-not-be-persisted'

const EVIDENCE_RECORD = (businessId) => ({
  knowledge_id: 'sg:sku:GIFT-777', business_id: businessId, knowledge_type: 'PRODUCT',
  product_code: 'GIFT-777', name: 'ชุดของขวัญไม้สัก', category: 'GIFTSET', description: null,
  unit: 'ชุด', sell_price: 450, currency: 'THB', moq: 50, colors: ['ไม้'],
  specification: { size: 'M' }, source_ref: 'catalog:giftset',
  source_sha256: 'b'.repeat(64), as_of: '2026-08-12T00:00:00.000Z',
  approved_at: '2026-08-14T00:00:00.000Z', is_active: true,
  sensitivity: 'PUBLIC', contract_version: '1.0.0',
})

// Build the route with a production-shaped binding runtime. Only the two real
// external boundaries are faked: the binding database and the model provider.
function buildHandler() {
  const seen = { resolverInput: null, knowledgeScope: null, modelCalls: 0 }
  const handler = createLineWebhookPost({
    runtimeFactory: async () => ({
      bindingResolver: {
        resolve: async (input) => {
          seen.resolverInput = input
          if (input.bindingId !== BINDING_ID || input.destination !== DESTINATION) {
            const e = new Error('PHASE1_BINDING_UNAUTHORIZED')
            e.status = 401
            throw e
          }
          return { id: BINDING_ID, code: 'LINE-SMARTGIFT-OA', tenantId: tenant.id, businessId: business.id }
        },
      },
      businessKnowledge: {
        query: async (scope) => {
          seen.knowledgeScope = scope
          return {
            queryId: 'product_detail', queryVersion: '1.0.0', businessId: scope.businessId,
            sensitivity: 'PUBLIC', asOf: '2026-08-12T00:00:00.000Z',
            records: [EVIDENCE_RECORD(scope.businessId)],
          }
        },
      },
      model: {
        provider: 'openai', model: 'test-model',
        generate: async () => {
          seen.modelCalls += 1
          return {
            provider: 'openai', model: 'test-model', status: 'ok',
            text: 'GIFT-777 ราคา 450 บาท ขั้นต่ำ 50 ชุด',
          }
        },
      },
    }),
  })
  return { handler, seen }
}

function post(handler, body, headers = { authorization: BEARER }) {
  return handler(new Request('http://local/api/agent/line-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))
}

const batch = (events) => ({ bindingId: BINDING_ID, destination: DESTINATION, events })

const textEvent = (userId, text, id, webhookEventId) => ({
  type: 'message',
  webhookEventId,
  source: { type: 'user', userId },
  message: { id, type: 'text', text },
  replyToken: REPLY_TOKEN,
  timestamp: 1760000000000,
})

describe('LINE OA golden path — one authentic event through every ZURI-owned hop', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Golden Group', code: 'PF-GOLD' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Golden Tenant', code: 'TNT-GOLD' })
    business = await createBusiness({ tenantId: tenant.id, name: 'SmartGift', code: 'BUS-GOLD' })
  })

  it('carries one LINE event from binding-verified ingress to a verified grounded reply', async () => {
    const { handler, seen } = buildHandler()

    const res = await post(handler, batch([
      textEvent('Ugolden-1', 'GIFT-777 ราคาเท่าไร', 'MGOLD-1', 'WEH-GOLD-1'),
    ]))
    const json = await res.json()

    // hop 1 — transport + authorization boundary
    expect(res.status).toBe(200)
    expect(seen.resolverInput).toEqual({
      bindingId: BINDING_ID, destination: DESTINATION, authorization: BEARER,
    })

    // hop 2 — tenant/business resolved from the binding, never from the body
    expect(seen.knowledgeScope.tenantId).toBe(tenant.id)
    expect(seen.knowledgeScope.businessId).toBe(business.id)

    // hop 3 — external identity resolved to a Person, tenant-scoped
    const identity = await prisma.externalIdentity.findUnique({
      where: {
        tenantId_provider_providerSubject: {
          tenantId: tenant.id, provider: 'LINE', providerSubject: 'Ugolden-1',
        },
      },
    })
    expect(identity).not.toBeNull()
    expect(identity.personId).toBeTruthy()
    // first contact discovers a channel subject; it does not prove ownership
    expect(identity.verifiedAt).toBeNull()

    // hop 4 — customer bound to that Person inside the resolved tenant
    const customer = await prisma.customer.findUnique({
      where: { tenantId_personId: { tenantId: tenant.id, personId: identity.personId } },
    })
    expect(customer).not.toBeNull()

    // hop 5 — conversation resolved on the LINE channel for this thread
    const conversation = await prisma.conversation.findFirst({ where: { externalThreadId: 'Ugolden-1' } })
    expect(conversation).toMatchObject({
      tenantId: tenant.id, businessId: business.id, channel: 'LINE', customerId: customer.id,
    })

    // hop 6 — inbound message persisted, keyed by the provider message id
    const message = await prisma.message.findFirst({ where: { externalMessageId: 'MGOLD-1' } })
    expect(message).toMatchObject({
      conversationId: conversation.id, direction: 'INBOUND', body: 'GIFT-777 ราคาเท่าไร',
    })

    // hop 7 — orchestration reached the provider exactly once
    expect(seen.modelCalls).toBe(1)

    // hop 8 — verified reply returned for the transport owner to deliver
    const result = json.results[0]
    expect(json.handled).toBe(1)
    expect(result.ok).toBe(true)
    expect(result.eventId).toBe('WEH-GOLD-1')
    expect(result.skipReply).toBe(false)
    expect(result.principalType).toBe('CUSTOMER')
    expect(result.response).toMatchObject({ kind: 'ANSWER', grounded: true, evidenceCount: 1 })
    expect(result.response.text).toContain('450')
    expect(result.response.sourceRefs).toEqual(['catalog:giftset'])
    expect(result.response.verification.supported).toBe(true)

    // hop 9 — audit trail exists for both identity and message
    const identityAudit = await prisma.auditEvent.findFirst({
      where: { entityType: 'EXTERNAL_IDENTITY', entityId: identity.id, action: 'LINKED' },
    })
    expect(identityAudit).toMatchObject({ actorType: 'LINE' })

    const messageAudit = await prisma.auditEvent.findFirst({
      where: { entityType: 'CONVERSATION', entityId: conversation.id, action: 'MESSAGE_INGESTED' },
    })
    expect(messageAudit).toMatchObject({ actorType: 'LINE' })
    expect(JSON.parse(messageAudit.payloadJson)).toMatchObject({
      tenantId: tenant.id, customerId: customer.id, direction: 'INBOUND', messageId: message.id,
    })

    // hop 10 — no transient LINE credential material reached persistence or the response
    const auditBlob = JSON.stringify(await prisma.auditEvent.findMany())
    expect(auditBlob).not.toContain(REPLY_TOKEN)
    expect(JSON.stringify(message)).not.toContain(REPLY_TOKEN)
    expect(JSON.stringify(json)).not.toContain(BEARER.slice(7))
  })

  it('is idempotent: a redelivered event answers once and asks the provider once', async () => {
    const { handler, seen } = buildHandler()
    const body = batch([textEvent('Ugolden-2', 'GIFT-777 ราคาเท่าไร', 'MGOLD-2', 'WEH-GOLD-2')])

    const first = await (await post(handler, body)).json()
    expect(first.results[0].skipReply).toBe(false)
    expect(seen.modelCalls).toBe(1)

    // LINE redelivers the identical batch after a timeout
    const replay = await (await post(handler, body)).json()
    expect(replay.results[0].ok).toBe(true)
    expect(replay.results[0].skipReply).toBe(true)
    expect(replay.results[0].response.kind).toBe('DUPLICATE')

    // one logical business effect: one message row, one model request, one audit event
    expect(seen.modelCalls).toBe(1)
    const messages = await prisma.message.findMany({ where: { externalMessageId: 'MGOLD-2' } })
    expect(messages).toHaveLength(1)
    const conversation = await prisma.conversation.findFirst({ where: { externalThreadId: 'Ugolden-2' } })
    const ingested = await prisma.auditEvent.count({
      where: { entityType: 'CONVERSATION', entityId: conversation.id, action: 'MESSAGE_INGESTED' },
    })
    expect(ingested).toBe(1)
  })
})
