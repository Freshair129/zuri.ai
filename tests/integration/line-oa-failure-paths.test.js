import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { createLineWebhookPost } from '@/app/api/agent/line-webhook/route'
import { revokeLineIdentity } from '@/modules/identity/resolve-line-identity'

// @req FR-028, FR-050 — the LINE webhook seam under failure.
// @spec BR-011 — a failed turn must not consume a reply the transport owner still holds.
// @spec SEC-009, SEC-010 — deny-by-default; no unintended writes on a failure path.
//
// The rule these pin: a failure anywhere downstream of ingest must (a) never crash the
// batch, (b) never silently drop the customer's inbound message, and (c) never emit a
// reply the answer policy did not actually verify.

let tenant, business

const DESTINATION = 'Ufail-oa'
const BINDING_ID = '11111111-2222-4333-8444-555555555555'
const BEARER = 'Bearer failure-path-binding-secret-long-enough'

const RECORD = (businessId) => ({
  knowledge_id: 'sg:sku:FAIL-1', business_id: businessId, knowledge_type: 'PRODUCT',
  product_code: 'FAIL-1', name: 'สินค้าทดสอบ', category: 'TEST', description: null,
  unit: 'ชิ้น', sell_price: 99, currency: 'THB', moq: 10, colors: [],
  specification: {}, source_ref: 'catalog:test',
  source_sha256: 'c'.repeat(64), as_of: '2026-08-12T00:00:00.000Z',
  approved_at: '2026-08-14T00:00:00.000Z', is_active: true,
  sensitivity: 'PUBLIC', contract_version: '1.0.0',
})

function buildHandler({ knowledgeQuery, generate } = {}) {
  return createLineWebhookPost({
    runtimeFactory: async () => ({
      bindingResolver: {
        resolve: async (input) => {
          if (input.bindingId !== BINDING_ID || input.destination !== DESTINATION) {
            const e = new Error('PHASE1_BINDING_UNAUTHORIZED')
            e.status = 401
            throw e
          }
          return { id: BINDING_ID, code: 'LINE-FAIL-OA', tenantId: tenant.id, businessId: business.id }
        },
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
        generate: generate ?? (async () => ({
          provider: 'openai', model: 'test-model', status: 'ok', text: 'FAIL-1 ราคา 99 บาท',
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
const textEvent = (userId, text, id) => ({
  type: 'message', source: { type: 'user', userId }, message: { id, type: 'text', text },
})

describe('LINE OA failure paths', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Failure Group', code: 'PF-FAIL' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Failure Tenant', code: 'TNT-FAIL' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Failure Business', code: 'BUS-FAIL' })
  })

  it('rejects an unknown binding with 401 and writes nothing', async () => {
    const handler = buildHandler()
    const res = await post(handler, {
      bindingId: '99999999-8888-4777-8666-555555555555',
      destination: DESTINATION,
      events: [textEvent('Ufail-unknown', 'สวัสดี', 'MFAIL-UNKNOWN')],
    })
    expect(res.status).toBe(401)
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MFAIL-UNKNOWN' } })).toBeNull()
  })

  it('rejects a destination that does not match the binding', async () => {
    const handler = buildHandler()
    const res = await post(handler, {
      bindingId: BINDING_ID,
      destination: 'U-some-other-official-account',
      events: [textEvent('Ufail-dest', 'สวัสดี', 'MFAIL-DEST')],
    })
    expect(res.status).toBe(401)
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MFAIL-DEST' } })).toBeNull()
  })

  it('rejects a malformed payload with 400 and writes nothing', async () => {
    const handler = buildHandler()
    // count only this tenant's rows: the suite shares one database with every
    // other integration file, so a global count would measure their fixtures too
    const where = { conversation: { tenantId: tenant.id } }
    const before = await prisma.message.count({ where })

    const res = await post(handler, {
      bindingId: BINDING_ID, destination: DESTINATION, events: 'not-an-array',
    })

    expect(res.status).toBe(400)
    expect(await prisma.message.count({ where })).toBe(before)
  })

  it('falls back to a deterministic grounded answer when the provider fails', async () => {
    const handler = buildHandler({
      generate: async () => { throw new Error('PROVIDER_TIMEOUT') },
    })
    const json = await (await post(handler, batch([
      textEvent('Ufail-provider', 'FAIL-1 ราคาเท่าไร', 'MFAIL-PROVIDER'),
    ]))).json()

    const result = json.results[0]
    expect(result.ok).toBe(true)
    // the customer still gets a reply, and it is still evidence-grounded
    expect(result.response.kind).toBe('ANSWER')
    expect(result.response.grounded).toBe(true)
    expect(result.response.text).toContain('99')
    expect(result.skipReply).toBe(false)
    // the inbound message is preserved regardless of provider health
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MFAIL-PROVIDER' } })).not.toBeNull()
  })

  it('isolates a knowledge-layer failure to its own event and keeps the inbound evidence', async () => {
    const handler = buildHandler({
      knowledgeQuery: async (scope) => {
        if (String(scope.params?.term ?? '').includes('ระเบิด')) throw new Error('KNOWLEDGE_UNAVAILABLE')
        return {
          queryId: 'product_search', queryVersion: '1.0.0', businessId: scope.businessId,
          sensitivity: 'PUBLIC', asOf: '2026-08-12T00:00:00.000Z',
          records: [RECORD(scope.businessId)],
        }
      },
    })

    const json = await (await post(handler, batch([
      textEvent('Ufail-know', 'คำถามระเบิด', 'MFAIL-KNOW'),
      textEvent('Ufail-ok', 'คำถามปกติ', 'MFAIL-OK'),
    ]))).json()

    // the failing event is reported, not thrown, and the batch continues
    expect(json.results[0].ok).toBe(false)
    expect(json.results[0].error).toBe('KNOWLEDGE_UNAVAILABLE')
    expect(json.results[1].ok).toBe(true)
    expect(json.handled).toBe(1)

    // the customer's message survived the failure: it is evidence, not a side effect
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MFAIL-KNOW' } })).not.toBeNull()
    // and no reply was claimed for it
    expect(json.results[0].skipReply).toBeUndefined()
  })

  it('refuses a revoked LINE identity without writing a message', async () => {
    const handler = buildHandler()
    await (await post(handler, batch([textEvent('Ufail-revoked', 'ทักครั้งแรก', 'MFAIL-REV-1')]))).json()
    await revokeLineIdentity(tenant.id, 'Ufail-revoked')

    const json = await (await post(handler, batch([
      textEvent('Ufail-revoked', 'ทักอีกครั้ง', 'MFAIL-REV-2'),
    ]))).json()

    expect(json.handled).toBe(0)
    expect(json.results[0].ok).toBe(false)
    expect(json.results[0].error).toMatch(/revoked/i)
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MFAIL-REV-2' } })).toBeNull()
  })

  it('skips unsupported message types and non-message events without a reply', async () => {
    const handler = buildHandler()
    const json = await (await post(handler, batch([
      { type: 'follow', source: { type: 'user', userId: 'Ufail-follow' } },
      { type: 'unfollow', source: { type: 'user', userId: 'Ufail-follow' } },
      { type: 'postback', source: { type: 'user', userId: 'Ufail-follow' }, postback: { data: 'x' } },
      { type: 'message', source: { type: 'user', userId: 'Ufail-follow' }, message: { id: 'MFAIL-STICKER', type: 'sticker' } },
      { type: 'message', source: { type: 'user', userId: 'Ufail-follow' }, message: { id: 'MFAIL-IMAGE', type: 'image' } },
    ]))).json()

    expect(json.handled).toBe(0)
    expect(json.results.every((r) => r.skipped === true)).toBe(true)
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MFAIL-STICKER' } })).toBeNull()
  })

  it('skips an event with no resolvable source without failing the batch', async () => {
    const handler = buildHandler()
    const json = await (await post(handler, batch([
      { type: 'message', source: {}, message: { id: 'MFAIL-NOSRC', type: 'text', text: 'ไม่มีผู้ส่ง' } },
    ]))).json()

    expect(json.results[0]).toMatchObject({ skipped: true, reason: 'no source userId' })
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MFAIL-NOSRC' } })).toBeNull()
  })
})
