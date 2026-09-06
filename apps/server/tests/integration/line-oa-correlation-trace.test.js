import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { createLineWebhookPost } from '@/app/api/agent/line-webhook/route'
import { createLogger } from '@/lib/observability/logger'
import { CORRELATION_HEADER } from '@/lib/observability/correlation'

// @spec NFR-017, SDD-048 — one correlation id joins webhook → identity → conversation
//   → message, across the log stream, the HTTP response and the durable audit row.
// @spec SEC-009 — no message text, display name or credential reaches a record.
//
// The operator question this has to answer: "a customer says they messaged us at 14:03
// and got nothing — what happened?" That is only answerable if one identifier appears
// on the request, on every record it emitted, and on the row it wrote.

let tenant, business

const DESTINATION = 'Ucorr-oa'
const BINDING_ID = '33333333-4444-4555-8666-777777777777'
const BEARER = 'Bearer correlation-binding-secret-long-enough'
const CALLER_ID = 'zuri-cli-01JABCDEFGH'
const CUSTOMER_TEXT = 'ลูกค้าถามราคาลับเฉพาะ'
const CUSTOMER_NAME = 'คุณมานะ ทดสอบ'

function build({ turnFails = false } = {}) {
  const records = []
  const logger = createLogger({ sink: (r) => records.push(r) })
  let now = 1000
  const handler = createLineWebhookPost({
    logger,
    clock: () => (now += 5),
    runtimeFactory: async () => ({
      bindingResolver: {
        resolve: async (input) => {
          if (input.bindingId !== BINDING_ID) {
            const e = new Error('PHASE1_BINDING_UNAUTHORIZED')
            e.status = 401
            throw e
          }
          return { id: BINDING_ID, tenantId: tenant.id, businessId: business.id }
        },
      },
      businessKnowledge: {
        query: async (scope) => {
          if (turnFails) throw new Error('KNOWLEDGE_UNAVAILABLE')
          return {
            queryId: 'product_search', queryVersion: '1.0.0', businessId: scope.businessId,
            sensitivity: 'PUBLIC', asOf: '2026-08-12T00:00:00.000Z', records: [],
          }
        },
      },
      model: { provider: 'openai', model: 'test-model', generate: async () => ({ text: 'x' }) },
    }),
  })
  return { handler, records }
}

function post(handler, body, headers = {}) {
  return handler(new Request('http://local/api/agent/line-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: BEARER, ...headers },
    body: JSON.stringify(body),
  }))
}

const batch = (events) => ({
  bindingId: BINDING_ID, destination: DESTINATION, displayName: CUSTOMER_NAME, events,
})
const textEvent = (userId, text, id, webhookEventId) => ({
  type: 'message', webhookEventId, source: { type: 'user', userId },
  message: { id, type: 'text', text }, replyToken: 'transient-reply-token',
})

const eventsNamed = (records, name) => records.filter((r) => r.event === name)

describe('LINE OA correlation trace (NFR-017)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Correlation Group', code: 'PF-CORR' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Correlation Tenant', code: 'TNT-CORR' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Correlation Business', code: 'BUS-CORR' })
  })

  it('carries one id from the request through the records to the audit row', async () => {
    const { handler, records } = build()
    const res = await post(handler, batch([
      textEvent('Ucorr-1', CUSTOMER_TEXT, 'MCORR-1', 'WEH-CORR-1'),
    ]), { [CORRELATION_HEADER]: CALLER_ID })
    const json = await res.json()

    // 1. the caller's id is adopted, so the chain spans zuri-cli and ZURI
    expect(json.correlationId).toBe(CALLER_ID)
    expect(json.results[0].correlationId).toBe(CALLER_ID)

    // 2. every record from this request carries it
    expect(records.length).toBeGreaterThanOrEqual(3)
    expect(records.every((r) => r.correlationId === CALLER_ID)).toBe(true)
    expect(records.map((r) => r.event)).toEqual([
      'line.webhook.received', 'line.webhook.event', 'line.webhook.completed',
    ])
    expect(eventsNamed(records, 'line.webhook.received')[0].correlationSource).toBe('CALLER')

    // 3. the per-event record names the rows it produced — this is the hop that makes
    //    "which webhook produced this conversation" answerable from the log alone
    const event = eventsNamed(records, 'line.webhook.event')[0]
    expect(event).toMatchObject({
      stage: 'TURN', outcome: 'OK', eventId: 'WEH-CORR-1',
      tenantId: tenant.id, businessId: business.id,
      principalType: 'CUSTOMER', responseKind: 'ANSWER',
    })
    expect(event.conversationId).toBeTruthy()
    expect(event.messageId).toBeTruthy()
    expect(typeof event.durationMs).toBe('number')

    // 4. the durable end: the audit row carries the same id, so the join survives
    //    log rotation
    const message = await prisma.message.findFirst({ where: { externalMessageId: 'MCORR-1' } })
    const audit = await prisma.auditEvent.findFirst({
      where: { entityType: 'CONVERSATION', entityId: event.conversationId, action: 'MESSAGE_INGESTED' },
    })
    expect(event.messageId).toBe(message.id)
    expect(JSON.parse(audit.payloadJson)).toMatchObject({
      correlationId: CALLER_ID, messageId: message.id,
    })

    // 5. the batch summary carries the counts an operator needs
    expect(eventsNamed(records, 'line.webhook.completed')[0]).toMatchObject({
      received: 1, handled: 1, failed: 0, skippedCount: 0,
    })
  })

  it('never puts the customer, the name or the credential in a record', async () => {
    const { handler, records } = build()
    await post(handler, batch([
      textEvent('Ucorr-2', CUSTOMER_TEXT, 'MCORR-2', 'WEH-CORR-2'),
    ]), { [CORRELATION_HEADER]: CALLER_ID })

    const serialized = JSON.stringify(records)
    for (const secret of [
      CUSTOMER_TEXT,                 // the customer's own words
      CUSTOMER_NAME,                 // their name
      BEARER.slice(7),               // the binding credential
      BINDING_ID,                    // binding identity
      'transient-reply-token',       // the LINE reply token
      DESTINATION,                   // the OA channel id
      'Ucorr-2',                     // the LINE user id
    ]) {
      expect(serialized).not.toContain(secret)
    }
    // and nothing was silently dropped on the way — if a field had been rejected the
    // emitter would have named it, which would mean the route is passing unsafe fields
    expect(records.some((r) => r.unsafeFieldsOmitted)).toBe(false)
  })

  it('records a rejected batch, which is the request an operator most needs to find', async () => {
    const { handler, records } = build()
    const res = await post(handler, {
      bindingId: '99999999-9999-4999-8999-999999999999',
      destination: DESTINATION,
      events: [textEvent('Ucorr-3', CUSTOMER_TEXT, 'MCORR-3', 'WEH-CORR-3')],
    }, { [CORRELATION_HEADER]: CALLER_ID })

    expect(res.status).toBe(401)
    // it still throws — the rejection is true of every event — but not silently
    const rejected = eventsNamed(records, 'line.webhook.rejected')[0]
    expect(rejected).toMatchObject({
      level: 'warn',
      correlationId: CALLER_ID,
      stage: 'SCOPE',
      errorCode: 'PHASE1_BINDING_UNAUTHORIZED',
      received: 1,
    })
    expect(eventsNamed(records, 'line.webhook.event')).toHaveLength(0)
  })

  it('records a failed event at error level, naming the stage', async () => {
    const { handler, records } = build({ turnFails: true })
    const json = await (await post(handler, batch([
      textEvent('Ucorr-4', CUSTOMER_TEXT, 'MCORR-4', 'WEH-CORR-4'),
    ]))).json()

    expect(json.results[0].ok).toBe(false)
    const failure = eventsNamed(records, 'line.webhook.event')[0]
    expect(failure).toMatchObject({
      level: 'error', stage: 'TURN', outcome: 'FAILED', errorCode: 'KNOWLEDGE_UNAVAILABLE',
    })
    expect(eventsNamed(records, 'line.webhook.completed')[0]).toMatchObject({
      received: 1, handled: 0, failed: 1,
    })
  })

  it('generates an id when the caller sends none, and says so', async () => {
    const { handler, records } = build()
    const json = await (await post(handler, batch([
      textEvent('Ucorr-5', CUSTOMER_TEXT, 'MCORR-5', 'WEH-CORR-5'),
    ]))).json()

    expect(json.correlationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(records.every((r) => r.correlationId === json.correlationId)).toBe(true)
    expect(eventsNamed(records, 'line.webhook.received')[0].correlationSource).toBe('GENERATED')
  })

  it('replaces a malformed caller id rather than dropping the message', async () => {
    const { handler, records } = build()
    const res = await post(handler, batch([
      textEvent('Ucorr-6', CUSTOMER_TEXT, 'MCORR-6', 'WEH-CORR-6'),
    ]), { [CORRELATION_HEADER]: 'no' })
    const json = await res.json()

    // a bad header is not a reason to refuse a customer's message
    expect(res.status).toBe(200)
    expect(json.handled).toBe(1)
    // but it must not look like the caller's id either
    expect(json.correlationId).not.toBe('no')
    expect(eventsNamed(records, 'line.webhook.received')[0].correlationSource)
      .toBe('REPLACED_INVALID')
  })
})
