import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { POST } from '@/app/api/agent/line-webhook/route'

// @req FR-028, FR-052 — the LINE webhook route refuses an unbound production caller.
// @spec BR-012, SEC-010 — Tenant/Business are server authority and an unbound caller
//   fails closed BEFORE persistence work.
//
// This is the route-level proof for the resolver unit test: with the Phase 1 runtime
// not composed (ZURI_LINE_BUSINESS_AGENT_ENABLED defaults to "false"), a production
// deployment must not let an anonymous caller pick a tenant and drive ingestLineMessage.

let tenant, business
const originalNodeEnv = process.env.NODE_ENV

function post(body, headers = {}) {
  return POST(new Request('http://local/api/agent/line-webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  }))
}

const textEvent = (userId, text, id) => ({
  type: 'message',
  source: { userId },
  message: { id, type: 'text', text },
})

describe('POST /api/agent/line-webhook — unbound production caller (SEC-010)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Unbound Group', code: 'PF-UNB' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Unbound Tenant', code: 'TNT-UNB' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Unbound Business', code: 'BUS-UNB' })
  })

  afterEach(() => { process.env.NODE_ENV = originalNodeEnv })

  it('returns 401 and writes nothing when a caller selects its own tenant in production', async () => {
    process.env.NODE_ENV = 'production'

    const res = await post({
      tenantId: tenant.id,
      businessId: business.id,
      events: [textEvent('Uunbound-1', 'ขอราคาสินค้า', 'MUNB-1')],
    })

    expect(res.status).toBe(401)

    // Nothing on the write path may have run: no message, no conversation, no
    // customer, no Person minted for the attacker-chosen tenant.
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MUNB-1' } })).toBeNull()
    expect(await prisma.conversation.findFirst({ where: { externalThreadId: 'Uunbound-1' } })).toBeNull()
    expect(await prisma.externalIdentity.findUnique({
      where: { tenantId_provider_providerSubject: { tenantId: tenant.id, provider: 'LINE', providerSubject: 'Uunbound-1' } },
    })).toBeNull()
    expect(await prisma.customer.count({ where: { tenantId: tenant.id } })).toBe(0)
  })

  it('does not disclose which field would unlock the endpoint', async () => {
    process.env.NODE_ENV = 'production'
    const res = await post({ events: [textEvent('Uunbound-2', 'hi', 'MUNB-2')] })
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.error).toBe('PHASE1_BINDING_REQUIRED')
    // the 400 "TENANT_ID_REQUIRED" hint must not reach an unauthenticated caller
    expect(JSON.stringify(json)).not.toMatch(/TENANT_ID_REQUIRED/)
  })

  it('still serves the lab client-scope seam outside production', async () => {
    process.env.NODE_ENV = 'test'
    const res = await post({
      tenantId: tenant.id,
      businessId: business.id,
      events: [textEvent('Uunbound-3', 'สวัสดี', 'MUNB-3')],
    })
    expect(res.status).toBe(200)
    expect(await prisma.message.findFirst({ where: { externalMessageId: 'MUNB-3' } })).not.toBeNull()
  })
})
