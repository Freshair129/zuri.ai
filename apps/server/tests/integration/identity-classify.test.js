import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { resolveLineIdentity } from '@/modules/identity/resolve-line-identity'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { classifyPrincipal } from '@/modules/identity/classify-principal'

// @req FR-022 — the staff/customer split: a resolved principal is typed by structure
// (Membership ⇒ STAFF, Customer ⇒ CUSTOMER, both ⇒ STAFF, neither ⇒ UNKNOWN).

let tenant, business

describe('classifyPrincipal (FR-022)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Classify Group', code: 'PF-CLS' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Classify Tenant', code: 'TNT-CLS' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Classify Business', code: 'BUS-CLS' })
  })

  it('a freshly-resolved principal with no ties is UNKNOWN', async () => {
    const { personId } = await resolveLineIdentity({ tenantId: tenant.id, lineUserId: 'Ucls-unknown' })
    const c = await classifyPrincipal({ tenantId: tenant.id, personId })
    expect(c.principalType).toBe('UNKNOWN')
    expect(c.isStaff).toBe(false)
    expect(c.isCustomer).toBe(false)
  })

  it('a principal with a Customer record is CUSTOMER', async () => {
    const r = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Ucls-cust', threadId: 'T-cls-1', text: 'hi' })
    const c = await classifyPrincipal({ tenantId: tenant.id, personId: r.personId })
    expect(c.principalType).toBe('CUSTOMER')
    expect(c.isCustomer).toBe(true)
    expect(c.customerId).toBe(r.customerId)
  })

  it('a principal with a Membership is STAFF', async () => {
    const person = await prisma.person.create({ data: { code: 'PSN-cls-staff', displayName: 'Staff Somchai' } })
    await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, role: 'MANAGER' } })
    const c = await classifyPrincipal({ tenantId: tenant.id, personId: person.id })
    expect(c.principalType).toBe('STAFF')
    expect(c.isStaff).toBe(true)
    expect(c.roles).toContain('MANAGER')
  })

  it('a principal that is both resolves to STAFF (precedence)', async () => {
    const person = await prisma.person.create({ data: { code: 'PSN-cls-both', displayName: 'Both' } })
    await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, role: 'OWNER' } })
    await prisma.customer.create({ data: { code: 'CUST-cls-both', tenantId: tenant.id, personId: person.id, displayName: 'Both' } })
    const c = await classifyPrincipal({ tenantId: tenant.id, personId: person.id })
    expect(c.principalType).toBe('STAFF')
    expect(c.isStaff).toBe(true)
    expect(c.isCustomer).toBe(true)
  })

  it('is tenant-scoped: a Membership in another tenant does not make you staff here', async () => {
    const pf2 = await createPortfolio({ name: 'Classify Group 2', code: 'PF-CLS2' })
    const other = await createTenant({ portfolioId: pf2.id, name: 'Classify Tenant 2', code: 'TNT-CLS2' })
    const person = await prisma.person.create({ data: { code: 'PSN-cls-scope', displayName: 'Scoped' } })
    await prisma.membership.create({ data: { personId: person.id, tenantId: other.id, role: 'OWNER' } })
    const c = await classifyPrincipal({ tenantId: tenant.id, personId: person.id })
    expect(c.principalType).toBe('UNKNOWN')
  })
})
