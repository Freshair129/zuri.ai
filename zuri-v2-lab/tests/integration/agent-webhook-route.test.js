import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '@/modules/project-manager/application/scope-service'
import { POST } from '@/app/api/agent/line-webhook/route'

// @req FR-028 — the LINE webhook route: a forwarded LINE message batch → agent turns,
// tenant-scoped, non-message events skipped, per-event failures isolated.

let tenant, business

function post(body) {
  return POST(new Request('http://local/api/agent/line-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
