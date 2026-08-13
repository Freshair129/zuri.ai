import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '@/modules/project-manager/application/scope-service'
import { POST } from '@/app/api/agent/line-webhook/route'
import crypto from 'node:crypto'

// @req FR-050 — event-correlated reply payload, bearer boundary, and no local token consumption.

// @req FR-028 — the LINE webhook route: a forwarded LINE message batch → agent turns,
// tenant-scoped, non-message events skipped, per-event failures isolated.

let tenant, business

function post(body, headers = {}) {
  return POST(new Request('http://local/api/agent/line-webhook', {
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

  it('returns 401 before parsing/turn work when Phase 1 transport bearer is missing', async () => {
    const previousEnabled = process.env.ZURI_LINE_BUSINESS_AGENT_ENABLED
    const previousToken = process.env.ZURI_LINE_TRANSPORT_TOKEN
    process.env.ZURI_LINE_BUSINESS_AGENT_ENABLED = 'true'
    process.env.ZURI_LINE_TRANSPORT_TOKEN = 'transport-secret-long-enough'
    try {
      const res = await post({ tenantId: tenant.id, events: [messageEvent('Uwh-auth', 'hi', 'MWH-AUTH')] })
      expect(res.status).toBe(401)
      const persisted = await prisma.message.findUnique({ where: { externalMessageId: 'MWH-AUTH' } })
      expect(persisted).toBeNull()
    } finally {
      if (previousEnabled === undefined) delete process.env.ZURI_LINE_BUSINESS_AGENT_ENABLED
      else process.env.ZURI_LINE_BUSINESS_AGENT_ENABLED = previousEnabled
      if (previousToken === undefined) delete process.env.ZURI_LINE_TRANSPORT_TOKEN
      else process.env.ZURI_LINE_TRANSPORT_TOKEN = previousToken
    }
  })

  it('rejects caller-selected Tenant/Business scope when production binding mode is enabled', async () => {
    const keys = ['ZURI_LINE_BUSINESS_AGENT_ENABLED', 'ZURI_LINE_TRANSPORT_TOKEN']
    const previous = Object.fromEntries(keys.map((key) => [key, process.env[key]]))
    process.env.ZURI_LINE_BUSINESS_AGENT_ENABLED = 'true'
    process.env.ZURI_LINE_TRANSPORT_TOKEN = 'transport-secret-long-enough'
    try {
      const res = await post(
        { tenantId: tenant.id, businessId: business.id, events: [] },
        { authorization: 'Bearer transport-secret-long-enough' },
      )
      expect(res.status).toBe(400)
    } finally {
      for (const key of keys) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key]
    }
  })

  it('resolves an enabled non-message batch through the server-owned binding', async () => {
    const config = {
      ZURI_LINE_BUSINESS_AGENT_ENABLED: 'true', ZURI_LINE_TRANSPORT_TOKEN: 'transport-secret-long-enough',
      ZURI_LINE_DATABASE_URL: 'postgresql://zuri_line_smartgift_ro:secret@db.example/zuri',
      ZURI_LINE_BINDING_ID: 'binding-1', ZURI_LINE_BINDING_DESTINATION_SHA256: crypto.createHash('sha256').update('destination-1').digest('hex'),
      ZURI_LINE_BINDING_TENANT_ID: tenant.id, ZURI_LINE_BINDING_BUSINESS_ID: business.id,
      ZURI_LINE_BINDING_STATUS: 'ACTIVE', ZURI_MODEL_PROVIDER: 'groq', ZURI_MODEL_NAME: 'model',
      ZURI_MODEL_CREDENTIAL: 'provider-secret',
    }
    const previous = Object.fromEntries(Object.keys(config).map((key) => [key, process.env[key]]))
    Object.assign(process.env, config)
    try {
      const res = await post(
        { bindingId: 'binding-1', destination: 'destination-1', events: [{ type: 'follow' }] },
        { authorization: 'Bearer transport-secret-long-enough' },
      )
      expect(res.status).toBe(200)
      const json = await res.json()
      expect(json.results).toEqual([{ skipped: true, type: 'follow' }])
    } finally {
      for (const key of Object.keys(config)) previous[key] === undefined ? delete process.env[key] : process.env[key] = previous[key]
    }
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
