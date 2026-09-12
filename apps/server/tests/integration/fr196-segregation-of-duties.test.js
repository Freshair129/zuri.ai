// @req FR-196 — segregation of duties against a real database: assigning a
//   conflicting role is refused 409, a Business owner cannot override it, a
//   Tenant owner can with a reason that lands on the row and in the audit
//   payload, and self-verification's audited exemption is recorded as
//   `selfVerified: true` (the payment half is proved end-to-end in
//   fr163-payment.test.js; this file adds the audit-payload assertion those
//   tests do not themselves make, plus the RBAC-conflict half).
// @spec ADR-065 D4, ADR-066 D4 as amended by ADR-079, BR-035, SEC-027, SDD-094
// @tested tests/integration/fr196-segregation-of-duties.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { assignRoleBinding } from '@/modules/identity/rbac-service'
import { ROLE_GOODS_RECEIVER, ROLE_PAYMENT_VERIFIER, ROLE_PROCUREMENT_BUYER, ROLE_SALES_REP } from '@/modules/identity/rbac'
import { createOrder } from '@/modules/commerce/application/sales-order-service'
import { recordPayment, applyPaymentAction } from '@/modules/commerce/application/payment-service'

let tenant, business, businessOwner, tenantOwner, person

describe('FR-196 segregation of duties', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'SoD Group', code: 'PF-SOD' })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'SoD Tenant', code: 'TNT-SOD' })
    business = await createBusiness({ tenantId: tenant.id, name: 'ร้าน SoD', code: 'BUS-SOD' })
    businessOwner = makeViewer({
      visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], visibleDomains: ['commerce', 'customer'],
      principal: { id: 'per-sod-bowner', code: 'PER-SOD-BOWNER', displayName: 'Business Owner' },
    })
    tenantOwner = makeViewer({
      role: 'OWNER', visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], ownedTenantIds: [tenant.id],
      principal: { id: 'per-sod-towner', code: 'PER-SOD-TOWNER', displayName: 'Tenant Owner' },
    })
    person = await prisma.person.create({ data: { code: 'PER-SOD-EMP', displayName: 'Employee' } })
    await prisma.membership.create({ data: { personId: person.id, tenantId: tenant.id, businessId: business.id, scopeType: 'BUSINESS', role: 'MEMBER', status: 'ACTIVE' } })
  })

  it('refuses SALES_REP + PAYMENT_VERIFIER on the same person in the same Tenant, and a Business owner cannot override it', async () => {
    await assignRoleBinding({ personId: person.id, tenantId: tenant.id, businessId: business.id, roleKey: ROLE_SALES_REP }, { viewer: businessOwner })

    const conflict = await assignRoleBinding(
      { personId: person.id, tenantId: tenant.id, businessId: business.id, roleKey: ROLE_PAYMENT_VERIFIER },
      { viewer: businessOwner },
    ).catch((e) => e)
    expect(conflict).toMatchObject({ status: 409 })
    expect(conflict.message).toMatch(/ROLE_CONFLICT/)
    expect(conflict.message).toMatch(new RegExp(ROLE_SALES_REP))

    // A Business owner's attempted override is refused — this is a Tenant
    // owner's call, never a Business owner's.
    const businessOwnerOverride = await assignRoleBinding(
      { personId: person.id, tenantId: tenant.id, businessId: business.id, roleKey: ROLE_PAYMENT_VERIFIER, sodOverride: { reason: 'ทดลอง' } },
      { viewer: businessOwner },
    ).catch((e) => e)
    expect(businessOwnerOverride.status).toBe(403)

    expect(await prisma.roleBinding.findFirst({ where: { personId: person.id, roleKey: ROLE_PAYMENT_VERIFIER } })).toBeNull()
  })

  it('a Tenant owner can override, and the reason lands on the row and in the audit payload', async () => {
    const binding = await assignRoleBinding(
      { personId: person.id, tenantId: tenant.id, businessId: business.id, roleKey: ROLE_PAYMENT_VERIFIER, sodOverride: { reason: 'ธุรกิจสองคน อนุมัติโดยเจ้าของ Tenant' } },
      { viewer: tenantOwner },
    )
    expect(binding.status).toBe('ACTIVE')
    expect(binding.sodOverrideReason).toBe('ธุรกิจสองคน อนุมัติโดยเจ้าของ Tenant')

    const audit = await prisma.auditEvent.findFirst({ where: { entityType: 'ROLE_BINDING', entityId: binding.id } })
    const payload = JSON.parse(audit.payloadJson)
    expect(payload).toMatchObject({ sodOverride: true, sodOverrideReason: 'ธุรกิจสองคน อนุมัติโดยเจ้าของ Tenant', conflictsWith: [ROLE_SALES_REP] })
  })

  it('PROCUREMENT_BUYER and GOODS_RECEIVER conflict the same way', async () => {
    const buyer = await prisma.person.create({ data: { code: 'PER-SOD-BUYER', displayName: 'Buyer' } })
    await prisma.membership.create({ data: { personId: buyer.id, tenantId: tenant.id, businessId: business.id, scopeType: 'BUSINESS', role: 'MEMBER', status: 'ACTIVE' } })
    await assignRoleBinding({ personId: buyer.id, tenantId: tenant.id, businessId: business.id, roleKey: ROLE_PROCUREMENT_BUYER }, { viewer: businessOwner })
    await expect(
      assignRoleBinding({ personId: buyer.id, tenantId: tenant.id, businessId: business.id, roleKey: ROLE_GOODS_RECEIVER }, { viewer: businessOwner }),
    ).rejects.toMatchObject({ status: 409 })
    const overridden = await assignRoleBinding(
      { personId: buyer.id, tenantId: tenant.id, businessId: business.id, roleKey: ROLE_GOODS_RECEIVER, sodOverride: { reason: 'ทีมเล็ก' } },
      { viewer: tenantOwner },
    )
    expect(overridden.sodOverrideReason).toBe('ทีมเล็ก')
  })

  it('the audit payload for an attested self-verify carries selfVerified: true, and a normal verify carries selfVerified: false', async () => {
    const rep = makeViewer({
      visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: ['commerce', 'customer'],
      rolesByBusinessId: { [business.id]: [ROLE_SALES_REP] }, principal: { id: 'per-sod-rep', code: 'PER-SOD-REP', displayName: 'Rep' },
    })
    const verifier = makeViewer({
      visibleBusinessIds: [business.id], ownedBusinessIds: [], visibleDomains: ['commerce', 'customer'],
      rolesByBusinessId: { [business.id]: [ROLE_PAYMENT_VERIFIER] }, principal: { id: 'per-sod-ver', code: 'PER-SOD-VER', displayName: 'Verifier' },
    })

    const order = await createOrder({ businessId: business.id, lines: [{ description: 'x', qty: 1, unitPrice: 100 }] }, { viewer: businessOwner })
    const p1 = await recordPayment(order.id, { method: 'CASH', amount: 100 }, { viewer: rep })
    const verified = await applyPaymentAction(p1.id, { action: 'VERIFY', version: 1 }, { viewer: verifier })
    const audit1 = await prisma.auditEvent.findFirst({ where: { entityType: 'PAYMENT', entityId: verified.payment.id, action: 'PAYMENT_VERIFIED' } })
    expect(JSON.parse(audit1.payloadJson)).toMatchObject({ selfVerified: false })

    const order2 = await createOrder({ businessId: business.id, lines: [{ description: 'y', qty: 1, unitPrice: 50 }] }, { viewer: businessOwner })
    const p2 = await recordPayment(order2.id, { method: 'CASH', amount: 50 }, { viewer: businessOwner })
    await expect(applyPaymentAction(p2.id, { action: 'VERIFY', version: 1 }, { viewer: businessOwner })).rejects.toMatchObject({ status: 409, message: 'PAYMENT_SELF_VERIFY_FORBIDDEN' })
    const selfVerified = await applyPaymentAction(p2.id, { action: 'VERIFY', version: 1, selfVerifyAttested: true }, { viewer: businessOwner })
    const audit2 = await prisma.auditEvent.findFirst({ where: { entityType: 'PAYMENT', entityId: selfVerified.payment.id, action: 'PAYMENT_VERIFIED' } })
    expect(JSON.parse(audit2.payloadJson)).toMatchObject({ selfVerified: true })
  })
})
