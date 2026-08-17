import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { POST, createLineWebhookPost } from '@/app/api/agent/line-webhook/route'
import bindingFixture from '../fixtures/fr052-binding-request-v1.json'

// @req FR-050 — event-correlated reply payload, bearer boundary, and no local token consumption.

// @req FR-028 — the LINE webhook route: a forwarded LINE message batch → agent turns,
// tenant-scoped, non-message events skipped, per-event failures isolated.
// @req FR-052 — production scope is resolved from the server-owned binding before turn work.

let tenant, business

function post(body, handler = POST, headers = {}) {
  return handler(new Request('http://local/api/agent/line-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))
}

const messageEvent = (userId, text, id) => ({
  type: 'message',
  source: { userId },
  message: { id, type: 'text', text },
})

describe('POST /api/agent/line-webhook (FR-028)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Webhook Group', code: 'PF-WH' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Webhook Tenant', code: 'TNT-WH' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Webhook Business', code: 'BUS-WH' })
  })

  it('turns a forwarded text message into an agent turn', async () => {
    const res = await post({ tenantId: tenant.id, businessId: business.id, events: [messageEvent('Uwh-1', 'สวัสดี', 'MWH-1')] })
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.handled).toBe(1)
    expect(json.results[0].ok).toBe(true)
    expect(json.results[0].eventId).toBe('MWH-1')
    expect(json.results[0].skipReply).toBe(false)
    expect(json.results[0].principalType).toBe('CUSTOMER')
    // the inbound message was persisted through the ingest seam
    const msg = await prisma.message.findUnique({ where: { externalMessageId: 'MWH-1' } })
    expect(msg).not.toBeNull()
  })

  it('skips non-text / non-message events but still returns 200', async () => {
    const res = await post({
      tenantId: tenant.id,
      events: [{ type: 'follow', source: { userId: 'Uwh-2' } }, { type: 'message', source: { userId: 'Uwh-2' }, message: { type: 'sticker' } }],
    })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.handled).toBe(0)
    expect(json.results.every((r) => r.skipped)).toBe(true)
  })

  it('refuses a batch with no tenantId (no minting under an unresolved tenant)', async () => {
    const res = await post({ events: [messageEvent('Uwh-3', 'hi', 'MWH-3')] })
    expect(res.status).toBe(400)
  })

  it('returns 401 before turn work when the server-owned binding rejects the request', async () => {
    const unauthorized = new Error('LINE_BINDING_UNAUTHORIZED')
    unauthorized.status = 401
    const handler = createLineWebhookPost({
      runtimeFactory: () => ({
        bindingResolver: { resolve: async () => { throw unauthorized } },
      }),
    })
    const res = await post({
      bindingId: '84ed2c90-ab44-46f3-9618-1f24df0744b9',
      destination: 'U-smartgift',
      events: [messageEvent('Uwh-auth', 'hi', 'MWH-AUTH')],
    }, handler)
    expect(res.status).toBe(401)
    const persisted = await prisma.message.findUnique({ where: { externalMessageId: 'MWH-AUTH' } })
    expect(persisted).toBeNull()
  })

  it('accepts the shared FR-052 binding-only request fixture without client scope', async () => {
    let resolvedInput
    let turnInput
    const handler = createLineWebhookPost({
      runtimeFactory: () => ({
        bindingResolver: {
          resolve: async (input) => {
            resolvedInput = input
            return {
              id: bindingFixture.bindingId,
              code: 'LINE-SMARTGIFT-OA',
              tenantId: tenant.id,
              businessId: business.id,
            }
          },
        },
      }),
      turnHandler: async (input) => {
        turnInput = input
        return {
          identity: { principalType: 'CUSTOMER' },
          response: { kind: 'ANSWER', text: 'พบข้อมูลสินค้า', skipReply: false },
        }
      },
    })
    const res = await post(bindingFixture, handler, {
      authorization: 'Bearer binding-bearer-secret-long-enough',
    })
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.handled).toBe(1)
    expect(resolvedInput).toEqual({
      bindingId: bindingFixture.bindingId,
      destination: bindingFixture.destination,
      authorization: 'Bearer binding-bearer-secret-long-enough',
    })
    expect(turnInput.tenantId).toBe(tenant.id)
    expect(turnInput.businessId).toBe(business.id)
    expect(turnInput.externalMessageId).toBe('msg-binding-v1')
  })

  it('rejects legacy client scope before turn work when Phase 1 runtime is enabled', async () => {
    let turnCalls = 0
    const handler = createLineWebhookPost({
      runtimeFactory: () => ({
        bindingResolver: { resolve: async () => { throw new Error('must not resolve legacy scope') } },
      }),
      turnHandler: async () => { turnCalls++; return null },
    })
    const res = await post({
      tenantId: tenant.id,
      businessId: business.id,
      events: bindingFixture.events,
    }, handler)
    expect(res.status).toBe(400)
    expect(turnCalls).toBe(0)
  })

  it('isolates a per-event failure without dropping the batch', async () => {
    // second event targets a bogus tenant-less path via an unknown source → skipped, not fatal
    const res = await post({
      tenantId: tenant.id, businessId: business.id,
      events: [messageEvent('Uwh-4', 'first', 'MWH-4'), { type: 'message', source: {}, message: { type: 'text', text: 'no user' } }],
    })
    const json = await res.json()
    expect(res.status).toBe(200)
    expect(json.handled).toBe(1)
    expect(json.results[1].skipped).toBe(true)
  })
})
