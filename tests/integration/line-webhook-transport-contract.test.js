import { describe, it, expect, beforeAll } from 'vitest'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { createLineWebhookPost } from '@/app/api/agent/line-webhook/route'

// @req FR-028, FR-050 — the response contract the LINE transport owner consumes.
// @spec BR-011 — zuri-cli owns signature verification and the Reply API; this route
//   owns knowledge/provider/answer policy and hands back the verified reply.
//
// WHY THIS TEST EXISTS
// --------------------
// The reply a customer actually receives is assembled in ANOTHER repository.
// `zuri-cli/src/history/webhook-server.ts :: handleStackReplies` reads exactly four
// things off this response and nothing else:
//
//   results[].eventId        matched against webhookEventId, falling back to message.id
//   results[].skipReply      true  -> remember the event and send nothing
//   results[].ok             false -> fall back to its own STACK_UNAVAILABLE_REPLY
//   results[].response.text  the string it hands to the LINE Reply API
//
// Since FR-092 it reads two more, to report back what the customer received:
//
//   results[].conversationId    the conversation the turn resolved
//   results[].inboundMessageId  the Message row the reply answers
//
// Nothing in this repository noticed if one of those were renamed — the other LINE
// tests assert behaviour, not the wire shape — and the failure mode is silent: every
// customer gets the transport's "unavailable" fallback instead of the answer, while
// this side stays green. So the shape is pinned here, at the seam that owns it, with
// the consumer named so a future change knows what it is breaking.

let tenant, business

const DESTINATION = 'Ucontract-oa'
const BINDING_ID = '55555555-6666-4777-8888-999999999999'
const BEARER = 'Bearer contract-binding-secret-long-enough'
const REPLY_TOKEN = 'reply-token-owned-by-the-transport'

const RECORD = (businessId) => ({
  knowledge_id: 'sg:sku:CT-1', business_id: businessId, knowledge_type: 'PRODUCT',
  product_code: 'CT-1', name: 'สินค้าสัญญา', category: 'TEST', description: null,
  unit: 'ชิ้น', sell_price: 320, currency: 'THB', moq: 5, colors: [],
  specification: {}, source_ref: 'catalog:contract',
  source_sha256: 'e'.repeat(64), as_of: '2026-08-12T00:00:00.000Z',
  approved_at: '2026-08-14T00:00:00.000Z', is_active: true,
  sensitivity: 'PUBLIC', contract_version: '1.0.0',
})

const quietLogger = { info() {}, warn() {}, error() {}, debug() {}, emit() {} }

function buildHandler({ knowledgeQuery } = {}) {
  return createLineWebhookPost({
    logger: quietLogger,
    runtimeFactory: async () => ({
      bindingResolver: {
        resolve: async () => ({ id: BINDING_ID, tenantId: tenant.id, businessId: business.id }),
      },
      businessKnowledge: {
        query: knowledgeQuery ?? (async (scope) => ({
          queryId: 'product_detail', queryVersion: '1.0.0', businessId: scope.businessId,
          sensitivity: 'PUBLIC', asOf: '2026-08-12T00:00:00.000Z',
          records: [RECORD(scope.businessId)],
        })),
      },
      model: {
        provider: 'openai', model: 'test-model',
        generate: async () => ({
          provider: 'openai', model: 'test-model', status: 'ok', text: 'CT-1 ราคา 320 บาท',
        }),
      },
    }),
  })
}

const post = (handler, body) => handler(new Request('http://local/api/agent/line-webhook', {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: BEARER },
  body: JSON.stringify(body),
}))

const batch = (events) => ({ bindingId: BINDING_ID, destination: DESTINATION, events })
const textEvent = (userId, text, id, webhookEventId) => ({
  type: 'message', webhookEventId, source: { type: 'user', userId },
  message: { id, type: 'text', text }, replyToken: REPLY_TOKEN,
})

/** The consumer's own matching rule, copied from handleStackReplies. */
const matchAsTransportDoes = (results, event) => results.find(
  (item) => item.eventId === event.webhookEventId || item.eventId === event.message?.id,
)

describe('LINE webhook response contract consumed by zuri-cli (BR-011)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Contract Group', code: 'PF-CONTRACT' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Contract Tenant', code: 'TNT-CONTRACT' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Contract Business', code: 'BUS-CONTRACT' })
  })

  it('returns an eventId the transport can match on webhookEventId', async () => {
    const event = textEvent('Uct-1', 'CT-1 ราคาเท่าไร', 'MCT-1', 'WEH-CT-1')
    const json = await (await post(buildHandler(), batch([event]))).json()

    const matched = matchAsTransportDoes(json.results, event)
    expect(matched).toBeTruthy()
    expect(matched.eventId).toBe('WEH-CT-1')
  })

  it('falls back to message.id when LINE sent no webhookEventId', async () => {
    // the transport's matcher accepts either; this route must produce one of them
    const event = textEvent('Uct-2', 'CT-1 ราคาเท่าไร', 'MCT-2', undefined)
    const json = await (await post(buildHandler(), batch([event]))).json()

    const matched = matchAsTransportDoes(json.results, event)
    expect(matched).toBeTruthy()
    expect(matched.eventId).toBe('MCT-2')
  })

  it('delivers the answer as results[].response.text, a non-empty string', async () => {
    const event = textEvent('Uct-3', 'CT-1 ราคาเท่าไร', 'MCT-3', 'WEH-CT-3')
    const json = await (await post(buildHandler(), batch([event]))).json()
    const matched = matchAsTransportDoes(json.results, event)

    // exactly what handleStackReplies reads before calling the Reply API
    expect(matched.ok).toBe(true)
    expect(typeof matched.response.text).toBe('string')
    expect(matched.response.text.trim()).not.toBe('')
    // LINE rejects a reply above 5,000 characters. The transport slices as a
    // backstop; this side should not be handing it something that needs slicing.
    expect(matched.response.text.length).toBeLessThanOrEqual(5000)
  })

  it('signals a redelivery with skipReply so the transport stays silent', async () => {
    const handler = buildHandler()
    const event = textEvent('Uct-4', 'CT-1 ราคาเท่าไร', 'MCT-4', 'WEH-CT-4')

    const first = await (await post(handler, batch([event]))).json()
    expect(matchAsTransportDoes(first.results, event).skipReply).toBe(false)

    const replay = await (await post(handler, batch([event]))).json()
    // strict true: the transport tests `result?.skipReply`, so a truthy-but-not-true
    // value would pass by accident and a missing one would send a duplicate reply
    expect(matchAsTransportDoes(replay.results, event).skipReply).toBe(true)
  })

  it('marks a failed turn ok:false so the transport uses its own fallback', async () => {
    const handler = buildHandler({
      knowledgeQuery: async () => { throw new Error('KNOWLEDGE_UNAVAILABLE') },
    })
    const json = await (await post(handler, batch([
      textEvent('Uct-5', 'CT-1 ราคาเท่าไร', 'MCT-5', 'WEH-CT-5'),
    ]))).json()

    // the transport only checks `result?.ok` — a failed turn must not look answerable
    const failed = json.results[0]
    expect(failed.ok).toBe(false)
    expect(failed.response).toBeUndefined()
  })

  it('keeps the envelope keys the transport destructures', async () => {
    const json = await (await post(buildHandler(), batch([
      textEvent('Uct-6', 'CT-1 ราคาเท่าไร', 'MCT-6', 'WEH-CT-6'),
    ]))).json()

    // `raw?.results` must be an array, or the transport treats the whole batch as
    // unanswerable and replies STACK_UNAVAILABLE to every event in it
    expect(Array.isArray(json.results)).toBe(true)
    expect(typeof json.handled).toBe('number')
  })

  it('names the row a delivery receipt will quote back (FR-092)', async () => {
    // The transport posts these two ids to `/api/agent/line-delivery` once the
    // customer has actually received a reply. Before FR-092 they existed only in a
    // log line, which no other process can read from — so the outbound half of every
    // conversation was sent and then lost.
    //
    // Pinned here for the same reason as the four fields above: the consumer is in
    // another repository, and a rename on this side would silently stop every reply
    // from being recorded while both suites stayed green.
    const json = await (await post(buildHandler(), batch([
      textEvent('Uct-7', 'CT-1 ราคาเท่าไร', 'MCT-7', 'WEH-CT-7'),
    ]))).json()
    const matched = matchAsTransportDoes(json.results, textEvent('Uct-7', '', 'MCT-7', 'WEH-CT-7'))

    expect(typeof matched.conversationId).toBe('string')
    expect(matched.conversationId).not.toBe('')
    expect(typeof matched.inboundMessageId).toBe('string')
    expect(matched.inboundMessageId).not.toBe('')

    // And still no reply token, on the path that now carries two more ids.
    expect(JSON.stringify(json)).not.toContain(REPLY_TOKEN)
  })

  it('still names the row when the turn failed, which is when the fallback is sent', async () => {
    // The failure path is the one that matters most here: `ok: false` is exactly when
    // the transport substitutes STACK_UNAVAILABLE_REPLY, so a customer definitely
    // received something. Ingest runs before anything that can fail, so the row
    // exists — losing its id with the stack frame would leave that message unrecorded.
    const handler = buildHandler({ knowledgeQuery: async () => { throw new Error('KNOWLEDGE_UNAVAILABLE') } })
    const json = await (await post(handler, batch([
      textEvent('Uct-8', 'CT-1 ราคาเท่าไร', 'MCT-8', 'WEH-CT-8'),
    ]))).json()
    const matched = matchAsTransportDoes(json.results, textEvent('Uct-8', '', 'MCT-8', 'WEH-CT-8'))

    // Findable at all, which it was not before: the failure branch carried no
    // `eventId`, so the transport's `find` returned undefined and the fallback was
    // sent only because an unmatched result reads the same as a failed one.
    expect(matched).toBeTruthy()
    expect(matched.ok).toBe(false)
    expect(typeof matched.inboundMessageId).toBe('string')
    expect(matched.inboundMessageId).not.toBe('')
    expect(typeof matched.conversationId).toBe('string')
  })

  it('adopts the correlation id format the transport actually mints', async () => {
    // zuri-cli mints `cli-${crypto.randomUUID()}` per signature-verified batch and
    // sends it as x-correlation-id. If this route's validator rejected that shape it
    // would silently mint its own instead, and the two sides' logs would stop
    // joining — a failure nobody sees until they need the trace. So the real format
    // is asserted here, not assumed compatible.
    const fromTransport = 'cli-128edbf5-e142-41a8-8209-7d3ceecbdba4'
    const res = await buildHandler()(new Request('http://local/api/agent/line-webhook', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: BEARER,
        'x-correlation-id': fromTransport,
      },
      body: JSON.stringify(batch([textEvent('Uct-8', 'CT-1 ราคาเท่าไร', 'MCT-8', 'WEH-CT-8')])),
    }))
    const json = await res.json()

    // adopted verbatim — the transport reads this back and keeps it
    expect(json.correlationId).toBe(fromTransport)
    expect(json.results[0].correlationId).toBe(fromTransport)
  })

  it('never returns the reply token, so the transport stays its only owner', async () => {
    const json = await (await post(buildHandler(), batch([
      textEvent('Uct-7', 'CT-1 ราคาเท่าไร', 'MCT-7', 'WEH-CT-7'),
    ]))).json()
    expect(JSON.stringify(json)).not.toContain(REPLY_TOKEN)
  })
})
