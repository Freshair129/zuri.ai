import { describe, it, expect, beforeAll } from 'vitest'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { queryKnowledge } from '@/modules/knowledge'

// @req FR-024 — the read-side of the split: a principal's relation neighbourhood,
//   tenant-scoped and read-only (ADR-007 §P5).
// Distinct prefixes (PF-KNQ / TNT-KNQ / BUS-KNQ, Uknq-*) — test.db is shared.

let tenant, business, principal

describe('queryKnowledge (FR-024)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Knowledge Query Group', code: 'PF-KNQ' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Knowledge Query Tenant', code: 'TNT-KNQ' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Knowledge Query Business', code: 'BUS-KNQ' })
    principal = await ingestLineMessage({
      tenantId: tenant.id, businessId: business.id,
      lineUserId: 'Uknq-1', displayName: 'ลูกค้า คิว', threadId: 'T-KNQ-1', text: 'สอบถามครับ',
    })
  })

  it('returns the frozen shape and found:true for an ingested principal', async () => {
    const result = await queryKnowledge({ tenantId: tenant.id, principalId: principal.personId })

    expect(result).toMatchObject({ principalId: principal.personId, found: true })
    expect(Array.isArray(result.relations)).toBe(true)

    // Every relation is { rel, node: { id, type, label } }.
    for (const r of result.relations) {
      expect(Object.keys(r).sort()).toEqual(['node', 'rel'])
      expect(Object.keys(r.node).sort()).toEqual(['id', 'label', 'type'])
    }

    const byRel = (rel) => result.relations.filter((r) => r.rel === rel)
    expect(byRel('IS_PRINCIPAL').map((r) => r.node.id)).toContain(principal.customerId)
    expect(byRel('HAS_CONVERSATION').map((r) => r.node.id)).toContain(principal.conversationId)
    expect(byRel('BELONGS_TO_BUSINESS').map((r) => r.node.id)).toContain(business.id)
  })

  it('returns found:false with no relations for an unknown principal', async () => {
    const result = await queryKnowledge({ tenantId: tenant.id, principalId: 'person-does-not-exist-knq' })
    expect(result).toEqual({ principalId: 'person-does-not-exist-knq', found: false, relations: [] })
  })

  it('is tenant-scoped — the principal has no relations in a foreign tenant', async () => {
    const pf2 = await createPortfolio({ name: 'Knowledge Query Group 2', code: 'PF-KNQ2' })
    const t2 = await createTenant({ portfolioId: pf2.id, name: 'Knowledge Query Tenant 2', code: 'TNT-KNQ2' })
    const result = await queryKnowledge({ tenantId: t2.id, principalId: principal.personId })
    expect(result.found).toBe(false)
    expect(result.relations).toEqual([])
  })
})
