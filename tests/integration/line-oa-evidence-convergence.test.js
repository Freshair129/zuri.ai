import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { createLineWebhookPost } from '@/app/api/agent/line-webhook/route'
import { createIntegrationConnection } from '@/platform/integrations/core/integration-registry'

// @req FR-081 — the LINE ingress converges on the one normalized ingestion envelope.
// @req FR-028, FR-052 — evidence is scoped by the binding, never by the payload.
// @spec BR-009, SDD-009 — one channel, one envelope, one raw write path.
// @spec SEC-001 — raw persistence is bound to a tenant/connection scope.
//
// Before this, the repository held two disjoint ideas of "a LINE event": the route's
// local `zLineEvent` (which drove the turn) and `zIngestionEnvelope` (which had no
// runtime caller at all). This suite pins the convergence: the SAME adapter that the
// orphaned connector used now runs on the live path, so there is one normalizer.

let tenant, business, connection

const DESTINATION = 'Uconv-smartgift-oa'
const BINDING_ID = '22222222-3333-4444-8555-666666666666'
const BEARER = 'Bearer convergence-binding-secret-long-enough'
const REPLY_TOKEN = 'transient-reply-token-never-persisted'

const RECORD = (businessId) => ({
  knowledge_id: 'sg:sku:CONV-1', business_id: businessId, knowledge_type: 'PRODUCT',
  product_code: 'CONV-1', name: 'สินค้าคอนเวอร์เจนซ์', category: 'TEST', description: null,
  unit: 'ชิ้น', sell_price: 250, currency: 'THB', moq: 20, colors: [],
  specification: {}, source_ref: 'catalog:conv',
  source_sha256: 'd'.repeat(64), as_of: '2026-08-12T00:00:00.000Z',
  approved_at: '2026-08-14T00:00:00.000Z', is_active: true,
  sensitivity: 'PUBLIC', contract_version: '1.0.0',
})

function buildHandler({ generate, businessIdOverride } = {}) {
  return createLineWebhookPost({
    runtimeFactory: async () => ({
      bindingResolver: {
        resolve: async (input) => {
          if (input.bindingId !== BINDING_ID || input.destination !== DESTINATION) {
            const e = new Error('PHASE1_BINDING_UNAUTHORIZED')
            e.status = 401
            throw e
          }
          return {
            id: BINDING_ID, code: 'LINE-CONV-OA',
            tenantId: tenant.id,
            businessId: businessIdOverride ?? business.id,
          }
        },
      },
      businessKnowledge: {
        query: async (scope) => ({
          queryId: 'product_detail', queryVersion: '1.0.0', businessId: scope.businessId,
          sensitivity: 'PUBLIC', asOf: '2026-08-12T00:00:00.000Z',
          records: [RECORD(scope.businessId)],
        }),
      },
      model: {
        provider: 'openai', model: 'test-model',
        generate: generate ?? (async () => ({
          provider: 'openai', model: 'test-model', status: 'ok', text: 'CONV-1 ราคา 250 บาท',
        })),
      },
    }),
  })
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

const rawFor = (externalId) => prisma.rawExternalRecord.findFirst({
  where: { connectionId: connection.id, externalId },
})

describe('LINE OA ingress converges on the canonical ingestion envelope (FR-081)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Convergence Group', code: 'PF-CONV' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Convergence Tenant', code: 'TNT-CONV' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Convergence Business', code: 'BUS-CONV' })

    const provider = await prisma.integrationProvider.upsert({
      where: { code: 'LINE_OA' },
      create: { code: 'LINE_OA', name: 'LINE Official Account', status: 'ACTIVE' },
      update: { status: 'ACTIVE' },
    })
    connection = await createIntegrationConnection({
      tenantId: tenant.id,
      businessId: business.id,
      providerId: provider.id,
      name: 'LINE OA convergence',
      authorizationType: 'CHANNEL_SECRET',
      externalAccountId: DESTINATION,
      status: 'ACTIVE',
    }, { db: prisma })
  })

  it('writes canonical raw evidence AND business truth from one ingress', async () => {
    const handler = buildHandler()
    const json = await (await post(handler, batch([
      textEvent('Uconv-1', 'CONV-1 ราคาเท่าไร', 'MCONV-1', 'WEH-CONV-1'),
    ]))).json()

    // the turn still happened — convergence adds a lane, it does not replace one
    expect(json.results[0].ok).toBe(true)
    expect(json.results[0].response.kind).toBe('ANSWER')
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MCONV-1' } })).not.toBeNull()

    // and the same event is now durable as canonical evidence
    expect(json.results[0].evidence).toMatchObject({
      status: 'CREATED', externalId: 'WEH-CONV-1', entityType: 'LINE_MESSAGE',
    })

    const raw = await rawFor('WEH-CONV-1')
    expect(raw).toMatchObject({
      tenantId: tenant.id,
      businessId: business.id,
      connectionId: connection.id,
      provider: 'LINE_OA',
      lane: 'CUSTOMER',
      entityType: 'LINE_MESSAGE',
      sourceType: 'WEBHOOK',
      schemaVersion: 'line.messaging-api.webhook.v1',
      processingStatus: 'RECEIVED',
    })
    expect(raw.sourceUri).toBe(`line://channel/${DESTINATION}`)
    expect(raw.idempotencyKey).toMatch(/^[a-f0-9]{64}$/)

    // the payload is the provider's event verbatim, minus the transient credential —
    // and it must not carry the caller's binding identity or bearer
    const payload = JSON.parse(raw.payloadJson)
    expect(payload.destination).toBe(DESTINATION)
    expect(payload.event.message.text).toBe('CONV-1 ราคาเท่าไร')
    expect(raw.payloadJson).not.toContain(REPLY_TOKEN)
    expect(raw.payloadJson).not.toContain(BINDING_ID)
    expect(raw.payloadJson).not.toContain(BEARER.slice(7))
  })

  it('records evidence for the events the turn skips, which were previously discarded', async () => {
    const handler = buildHandler()
    const json = await (await post(handler, batch([
      { type: 'follow', webhookEventId: 'WEH-CONV-FOLLOW', source: { type: 'user', userId: 'Uconv-2' } },
      { type: 'postback', webhookEventId: 'WEH-CONV-POSTBACK', source: { type: 'user', userId: 'Uconv-2' }, postback: { data: 'menu=1' } },
      { type: 'message', webhookEventId: 'WEH-CONV-STICKER', source: { type: 'user', userId: 'Uconv-2' }, message: { id: 'MCONV-STICKER', type: 'sticker' } },
    ]))).json()

    // still skipped for the turn — no reply, no CRM write
    expect(json.handled).toBe(0)
    expect(json.results.every((r) => r.skipped === true)).toBe(true)
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MCONV-STICKER' } })).toBeNull()

    // but no longer invisible: each is a typed raw record
    expect(await rawFor('WEH-CONV-FOLLOW')).toMatchObject({ entityType: 'LINE_IDENTITY' })
    expect(await rawFor('WEH-CONV-POSTBACK')).toMatchObject({ entityType: 'LINE_POSTBACK' })
    expect(await rawFor('WEH-CONV-STICKER')).toMatchObject({ entityType: 'LINE_MESSAGE' })
    expect(json.results.map((r) => r.evidence.status)).toEqual(['CREATED', 'CREATED', 'CREATED'])
  })

  it('is idempotent on redelivery: one raw record, reported UNCHANGED', async () => {
    const handler = buildHandler()
    const body = batch([textEvent('Uconv-3', 'CONV-1 ราคาเท่าไร', 'MCONV-3', 'WEH-CONV-3')])

    const first = await (await post(handler, body)).json()
    const replay = await (await post(handler, body)).json()

    expect(first.results[0].evidence.status).toBe('CREATED')
    expect(replay.results[0].evidence.status).toBe('UNCHANGED')
    expect(replay.results[0].evidence.rawRecordId).toBe(first.results[0].evidence.rawRecordId)

    const rows = await prisma.rawExternalRecord.findMany({
      where: { connectionId: connection.id, externalId: 'WEH-CONV-3' },
    })
    expect(rows).toHaveLength(1)
  })

  it('keeps the evidence when the turn fails afterwards', async () => {
    // the substrate exists so a failed interpretation cannot destroy what LINE sent
    const failing = createLineWebhookPost({
      runtimeFactory: async () => ({
        bindingResolver: {
          resolve: async () => ({ id: BINDING_ID, tenantId: tenant.id, businessId: business.id }),
        },
        businessKnowledge: { query: async () => { throw new Error('KNOWLEDGE_UNAVAILABLE') } },
        model: { provider: 'openai', model: 'test-model', generate: async () => ({ text: 'x' }) },
      }),
    })

    const json = await (await post(failing, batch([
      textEvent('Uconv-4', 'CONV-1 ราคาเท่าไร', 'MCONV-4', 'WEH-CONV-4'),
    ]))).json()

    expect(json.results[0].ok).toBe(false)
    expect(json.results[0].stage).toBe('TURN')
    // the turn failed, but the raw record survives and is replayable
    expect(json.results[0].evidence.status).toBe('CREATED')
    expect(await rawFor('WEH-CONV-4')).not.toBeNull()
  })

  it('leaves a channel with no IntegrationConnection working exactly as before', async () => {
    const otherTenant = await createTenant({
      portfolioId: (await prisma.tenant.findUnique({ where: { id: tenant.id } })).portfolioId,
      name: 'No Connection Tenant', code: 'TNT-CONV-NONE',
    })
    const otherBusiness = await createBusiness({
      tenantId: otherTenant.id, name: 'No Connection Business', code: 'BUS-CONV-NONE',
    })
    const unconnected = createLineWebhookPost({
      runtimeFactory: async () => ({
        bindingResolver: {
          resolve: async () => ({ id: BINDING_ID, tenantId: otherTenant.id, businessId: otherBusiness.id }),
        },
      }),
    })

    const json = await (await post(unconnected, {
      bindingId: BINDING_ID,
      destination: 'U-channel-with-no-connection',
      events: [textEvent('Uconv-5', 'สวัสดี', 'MCONV-5', 'WEH-CONV-5')],
    })).json()

    expect(json.results[0].ok).toBe(true)
    expect(json.results[0].evidence).toBeNull()
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MCONV-5' } })).not.toBeNull()
    expect(await prisma.rawExternalRecord.findFirst({ where: { externalId: 'WEH-CONV-5' } })).toBeNull()
  })

  it('treats a not-yet-ACTIVE connection as "not ingesting", not as a broken channel', async () => {
    // createIntegrationConnection defaults to DRAFT, so provisioning must not take a
    // live channel down between creating the row and activating it.
    const draftTenant = await createTenant({
      portfolioId: (await prisma.tenant.findUnique({ where: { id: tenant.id } })).portfolioId,
      name: 'Draft Tenant', code: 'TNT-CONV-DRAFT',
    })
    const draftBusiness = await createBusiness({
      tenantId: draftTenant.id, name: 'Draft Business', code: 'BUS-CONV-DRAFT',
    })
    const provider = await prisma.integrationProvider.findUnique({ where: { code: 'LINE_OA' } })
    await createIntegrationConnection({
      tenantId: draftTenant.id,
      businessId: draftBusiness.id,
      providerId: provider.id,
      name: 'LINE OA being provisioned',
      externalAccountId: 'U-draft-channel',
      status: 'DRAFT',
    }, { db: prisma })

    const handler = createLineWebhookPost({
      runtimeFactory: async () => ({
        bindingResolver: {
          resolve: async () => ({ id: BINDING_ID, tenantId: draftTenant.id, businessId: draftBusiness.id }),
        },
      }),
    })
    const json = await (await post(handler, {
      bindingId: BINDING_ID,
      destination: 'U-draft-channel',
      events: [textEvent('Uconv-draft', 'สวัสดี', 'MCONV-DRAFT', 'WEH-CONV-DRAFT')],
    })).json()

    expect(json.results[0].ok).toBe(true)
    expect(json.results[0].evidence).toBeNull()
    expect(await prisma.rawExternalRecord.findFirst({ where: { externalId: 'WEH-CONV-DRAFT' } })).toBeNull()
  })

  it('refuses a connection that belongs to another Business rather than writing to it', async () => {
    const wrongBusiness = await createBusiness({
      tenantId: tenant.id, name: 'Wrong Business', code: 'BUS-CONV-WRONG',
    })
    const handler = buildHandler({ businessIdOverride: wrongBusiness.id })

    const res = await post(handler, batch([
      textEvent('Uconv-6', 'CONV-1 ราคาเท่าไร', 'MCONV-6', 'WEH-CONV-6'),
    ]))

    // a misconfigured channel fails the batch before any work — it is not a near-miss
    // to silently fall back from
    expect(res.status).toBeGreaterThanOrEqual(400)
    expect((await res.json()).error).toBe('LINE_OA_CONNECTION_OUTSIDE_BUSINESS')
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MCONV-6' } })).toBeNull()
    expect(await rawFor('WEH-CONV-6')).toBeNull()
  })
})
