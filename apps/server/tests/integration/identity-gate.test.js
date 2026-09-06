import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { resolveLinePrincipal, issueLinkToken, redeemLinkToken } from '@/modules/identity/gate'

// @req FR-022 — resolveLinePrincipal: the single P3 seam that resolves a LINE subject
// to a principal (FR-021) and types it staff/customer (FR-022) in one call.

let tenant, business

describe('resolveLinePrincipal gate (FR-022)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Gate Group', code: 'PF-GATE' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Gate Tenant', code: 'TNT-GATE' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Gate Business', code: 'BUS-GATE' })
  })

  it('first contact resolves and types the principal UNKNOWN', async () => {
    const p = await resolveLinePrincipal({ tenantId: tenant.id, lineUserId: 'Ugate-1' })
    expect(p.created).toBe(true)
    expect(p.personId).toBeTruthy()
    expect(p.principalType).toBe('UNKNOWN')
  })

  it('a subject with a Customer record types CUSTOMER', async () => {
    await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Ugate-2', threadId: 'T-gate-2', text: 'hi' })
    const p = await resolveLinePrincipal({ tenantId: tenant.id, lineUserId: 'Ugate-2' })
    expect(p.principalType).toBe('CUSTOMER')
    expect(p.customerId).toBeTruthy()
  })

  it('a subject linked to a staff Person types STAFF', async () => {
    const person = await prisma.person.create({ data: { code: 'PSN-gate-staff', displayName: 'Staff' } })
    await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, role: 'ADMIN' } })
    const { token } = await issueLinkToken({ tenantId: tenant.id, personId: person.id })
    await redeemLinkToken({ tenantId: tenant.id, token, lineUserId: 'Ugate-3' })
    const p = await resolveLinePrincipal({ tenantId: tenant.id, lineUserId: 'Ugate-3' })
    expect(p.personId).toBe(person.id)
    expect(p.principalType).toBe('STAFF')
    expect(p.roles).toContain('ADMIN')
  })
})
