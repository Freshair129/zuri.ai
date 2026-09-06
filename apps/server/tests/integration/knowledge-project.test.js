import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { projectKnowledgeGraph, createJsonSink, writeGraph, assertNoLiveFacts } from '@/modules/knowledge'

// @req FR-024 — Zuri → GKS projection: a tenant's relations become a deterministic
//   { nodes, edges } graph; live facts never cross the seam (ADR-007 §P5).
// Distinct prefixes (PF-KN / TNT-KN / BUS-KN, Ukn-*, PSN-kn-*) — test.db is shared.

let tenant, business, customerResult, staffPerson

describe('projectKnowledgeGraph (FR-024)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Knowledge Group', code: 'PF-KN' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Knowledge Tenant', code: 'TNT-KN' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Knowledge Business', code: 'BUS-KN' })

    // One ingested customer with a conversation.
    customerResult = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id,
      lineUserId: 'Ukn-1', displayName: 'ลูกค้า เอ', threadId: 'T-KN-1', text: 'สวัสดีครับ',
    })

    // One staff person via a direct Membership (the RBAC side).
    staffPerson = await prisma.person.create({ data: { code: 'PSN-kn-staff', displayName: 'พนักงาน บี' } })
    await prisma.membership.create({ data: { personId: staffPerson.id, tenantId: tenant.id, businessId: business.id, role: 'MANAGER' } })
  })

  it('emits the expected node types', async () => {
    const { nodes } = await projectKnowledgeGraph({ tenantId: tenant.id })
    const types = new Set(nodes.map((n) => n.type))
    expect(types).toEqual(new Set(['Tenant', 'Business', 'Customer', 'Person', 'Conversation']))

    // Each node carries id/type/label; only models with a `code` carry a key.
    const conv = nodes.find((n) => n.type === 'Conversation')
    expect(conv.label).toBe('T-KN-1')
    expect(conv.key).toBeNull()
    const biz = nodes.find((n) => n.type === 'Business')
    expect(biz.label).toBe('Knowledge Business')
    expect(biz.key).toBe('BUS-KN')
  })

  it('emits the expected edges, carrying role on MEMBER_OF', async () => {
    const { edges } = await projectKnowledgeGraph({ tenantId: tenant.id })
    const rels = edges.map((e) => e.rel)
    expect(rels).toContain('HAS_BUSINESS')
    expect(rels).toContain('HAS_CUSTOMER')
    expect(rels).toContain('IS_PRINCIPAL')
    expect(rels).toContain('HAS_CONVERSATION')
    expect(rels).toContain('MEMBER_OF')

    const hasBusiness = edges.find((e) => e.rel === 'HAS_BUSINESS')
    expect(hasBusiness).toMatchObject({ from: tenant.id, to: business.id })

    const memberOf = edges.find((e) => e.rel === 'MEMBER_OF')
    expect(memberOf).toMatchObject({ from: staffPerson.id, to: tenant.id, role: 'MANAGER' })

    const isPrincipal = edges.find((e) => e.rel === 'IS_PRINCIPAL')
    expect(isPrincipal).toMatchObject({ from: customerResult.customerId, to: customerResult.personId })
  })

  it('is deterministic — same call twice is deep-equal', async () => {
    const a = await projectKnowledgeGraph({ tenantId: tenant.id })
    const b = await projectKnowledgeGraph({ tenantId: tenant.id })
    expect(a).toEqual(b)
  })

  it('is tenant-scoped — another tenant\'s rows are absent', async () => {
    const pf2 = await createPortfolio({ name: 'Knowledge Group 2', code: 'PF-KN2' })
    const t2 = await createTenant({ portfolioId: pf2.id, name: 'Knowledge Tenant 2', code: 'TNT-KN2' })
    const b2 = await createBusiness({ tenantId: t2.id, name: 'Knowledge Business 2', code: 'BUS-KN2' })
    await ingestLineMessage({ tenantId: t2.id, businessId: b2.id, lineUserId: 'Ukn-2', threadId: 'T-KN-2', text: 'hi' })

    const { nodes } = await projectKnowledgeGraph({ tenantId: tenant.id })
    const ids = new Set(nodes.map((n) => n.id))
    expect(ids.has(b2.id)).toBe(false)
    expect(ids.has(t2.id)).toBe(false)
  })

  it('excludes soft-deleted customers', async () => {
    const r = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Ukn-del', threadId: 'T-KN-DEL', text: 'x' })
    await prisma.customer.update({ where: { id: r.customerId }, data: { deletedAt: new Date() } })

    const { nodes } = await projectKnowledgeGraph({ tenantId: tenant.id })
    expect(nodes.some((n) => n.id === r.customerId)).toBe(false)
  })

  it('writeGraph feeds a JSON sink', async () => {
    const graph = await projectKnowledgeGraph({ tenantId: tenant.id })
    const sink = await writeGraph(graph, createJsonSink())
    expect(sink.toJSON().nodes).toHaveLength(graph.nodes.length)
    expect(sink.toJSON().edges).toHaveLength(graph.edges.length)
  })

  it('assertNoLiveFacts enforces the relations/live-facts split', () => {
    expect(() => assertNoLiveFacts({ price: 1 })).toThrow()
    expect(() => assertNoLiveFacts({ invoiceTotal: 5 })).toThrow()
    expect(() => assertNoLiveFacts({ creditBalance: 10 })).toThrow()
    expect(() => assertNoLiveFacts({ label: 'x' })).not.toThrow()
  })
})
