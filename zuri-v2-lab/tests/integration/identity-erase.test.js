import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '@/modules/project-manager/application/scope-service'
import { resolveLineIdentity } from '@/modules/identity/resolve-line-identity'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { issueLinkToken, redeemLinkToken } from '@/modules/identity/link-line-identity'
import { erasePrincipal } from '@/modules/identity/erase-principal'

// @req FR-022 — PDPA erase-revoke: erasing a principal revokes its channel identity
// (so it stops resolving), invalidates outstanding tokens, and redacts the CRM record.

let tenant, business

describe('erasePrincipal (FR-022)', () => {
  beforeAll(async () => {
    const pf = await createPortfolio({ name: 'Erase Group', code: 'PF-ERS' })
    tenant = await createTenant({ portfolioId: pf.id, name: 'Erase Tenant', code: 'TNT-ERS' })
    business = await createBusiness({ tenantId: tenant.id, name: 'Erase Business', code: 'BUS-ERS' })
  })

  it('revokes the identity so an erased person can no longer be resolved (the PDPA guarantee)', async () => {
    const r = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Uers-1', threadId: 'T-ers-1', text: 'hi' })
    const summary = await erasePrincipal({ tenantId: tenant.id, personId: r.personId, reason: 'DSAR delete' })
    expect(summary.revokedIdentities).toBe(1)
    expect(summary.erasedCustomers).toBe(1)
    // The mapping is revoked → resolution now refuses (not merely hidden).
    await expect(resolveLineIdentity({ tenantId: tenant.id, lineUserId: 'Uers-1' })).rejects.toThrow(/revoked/)
  })

  it('soft-deletes and redacts the CRM record', async () => {
    const r = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Uers-2', displayName: 'มานี', threadId: 'T-ers-2', text: 'hi' })
    await erasePrincipal({ tenantId: tenant.id, personId: r.personId })
    const customer = await prisma.customer.findUnique({ where: { id: r.customerId } })
    expect(customer.deletedAt).not.toBeNull()
    expect(customer.displayName).toBe('[erased]')
  })

  it('redacts the global Person when it has no other ties', async () => {
    const r = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Uers-3', displayName: 'สมชาย', threadId: 'T-ers-3', text: 'hi' })
    const summary = await erasePrincipal({ tenantId: tenant.id, personId: r.personId })
    expect(summary.personRedacted).toBe(true)
    const person = await prisma.person.findUnique({ where: { id: r.personId } })
    expect(person.displayName).toBe('[erased]')
  })

  it('invalidates an outstanding link token so a dangling token cannot re-attach', async () => {
    const r = await ingestLineMessage({ tenantId: tenant.id, businessId: business.id, lineUserId: 'Uers-4', threadId: 'T-ers-4', text: 'hi' })
    const { token } = await issueLinkToken({ tenantId: tenant.id, personId: r.personId })
    const summary = await erasePrincipal({ tenantId: tenant.id, personId: r.personId })
    expect(summary.invalidatedTokens).toBe(1)
    await expect(redeemLinkToken({ tenantId: tenant.id, token, lineUserId: 'Uers-4b' })).rejects.toThrow(/already been used/)
  })
})
