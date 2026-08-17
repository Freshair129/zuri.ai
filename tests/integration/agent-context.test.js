import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { assembleAgentContext, memoryKey, createInMemoryMemory } from '@/modules/agent'

// @req FR-025 — the agent read-only context contract (ADR-007 P6, Gate E): identity +
//   principal-keyed memory + GKS knowledge + read-only tools, assembled with no writes.

let tenant, business

describe('assembleAgentContext (FR-025)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Agent Group', code: 'PF-AG' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Agent Tenant', code: 'TNT-AG' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Agent Business', code: 'BUS-AG' })
  })

  describe('memoryKey — principal-keyed, never channel-keyed', () => {
    it('builds tenant/principal:type:id and lowercases the type', () => {
      expect(memoryKey('T1', 'CUSTOMER', 'P1')).toBe('tenant:T1/principal:customer:P1')
    })

    it('never embeds a raw channel handle (no line:, no lineUserId)', () => {
      // The forbidden demo anti-pattern was `vault: line:Uxxxx`. Even when a lineUserId
      // exists in the world, it is passed NOWHERE into the key — only the resolved
      // principal id reaches it.
      const key = memoryKey('T1', 'CUSTOMER', 'P1')
      expect(key).not.toContain('line:')
      expect(key).not.toContain('Uag-1')
    })
  })

  it('assembles read-only context for an ingested customer', async () => {
    await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id,
      lineUserId: 'Uag-1', displayName: 'ลูกค้า', threadId: 'T-ag-1', text: 'สวัสดี', externalMessageId: 'M-ag-1',
    })

    const ctx = await assembleAgentContext({ tenantId: tenant.id, lineUserId: 'Uag-1', displayName: 'ลูกค้า' })

    expect(ctx.identity.principalType).toBe('CUSTOMER')
    expect(ctx.identity.principalId).toBeTruthy()
    expect(ctx.knowledge.found).toBe(true)

    // Memory is keyed by the classified principal, not the LINE channel.
    expect(ctx.memory.key.startsWith('tenant:')).toBe(true)
    expect(ctx.memory.key).toContain('principal:customer:')
    expect(ctx.memory.key).not.toContain('Uag-1')
    expect(Array.isArray(ctx.memory.entries)).toBe(true)

    // Gate E: read-only, and every exposed tool is name+description only (no handler).
    expect(ctx.capabilities).toEqual({ readOnly: true, gate: 'E' })
    expect(ctx.tools.length).toBeGreaterThan(0)
    for (const tool of ctx.tools) {
      expect(tool).toHaveProperty('name')
      expect(tool).not.toHaveProperty('handler')
    }
  })

  it('assembles UNKNOWN context on first contact (no prior ingest)', async () => {
    const ctx = await assembleAgentContext({ tenantId: tenant.id, lineUserId: 'Uag-first-contact' })

    expect(ctx.identity.principalType).toBe('UNKNOWN')
    expect(ctx.knowledge.found).toBe(false)
    expect(ctx.capabilities.readOnly).toBe(true)
    expect(ctx.memory.key).toContain('principal:unknown:')
  })

  it('uses an injected memory port and recalls previously remembered entries by principal key', async () => {
    const memory = createInMemoryMemory()
    const person = await prisma.person.create({ data: { code: 'PSN-AG-MEM', displayName: 'Memory user' } })
    await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, businessId: business.id, role: 'MEMBER' } })
    const link = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
    await redeemLinkToken({ tenantId: tenant.id, token: link.token, lineUserId: 'Uag-2' })
    // First pass resolves the principal and gives us the key.
    const trustedScope = { transportVerified: true, businessId: business.id }
    const first = await assembleAgentContext({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Uag-2', memory, serverScope: trustedScope,
    })
    expect(first.memory.entries).toEqual([])

    await memory.remember(first.memory.key, { note: 'prefers Thai' })

    const second = await assembleAgentContext({
      tenantId: tenant.id, businessId: business.id, lineUserId: 'Uag-2', memory, serverScope: trustedScope,
    })
    expect(second.memory.key).toBe(first.memory.key)
    expect(second.memory.entries).toEqual([{ note: 'prefers Thai' }])
  })
})
