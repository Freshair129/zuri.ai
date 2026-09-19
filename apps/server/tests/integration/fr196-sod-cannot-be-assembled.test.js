// @req FR-196 — the conflict cannot be assembled in stages.
//
//   `assertNoConflict` counted only ACTIVE bindings and `updateRoleBindingStatus`
//   never called it, so a Business owner — whom ADR-079 D2 deliberately does not
//   let override a conflict — could build one in three moves: suspend the first
//   role, assign the second (nothing ACTIVE objects), reactivate the first. The
//   person ended up holding both with no `sodOverrideReason` recorded anywhere,
//   which is the evidence BR-035 exists to produce.
//
//   Every assertion here fails against the code as it stood before this file.
// @spec ADR-079 D2, BR-035, SEC-027, ADR-077 D2 (REVOKED is the only terminal state)
// @tested tests/integration/fr196-sod-cannot-be-assembled.test.js
import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createPortfolio, createTenant, createBusiness } from '../factories/scope'
import { makeViewer } from '../factories/viewer'
import { assignRoleBinding, updateRoleBindingStatus } from '@/modules/identity/rbac-service'
import { ROLE_PAYMENT_VERIFIER, ROLE_SALES_REP } from '@/modules/identity/rbac'

let tenant, business, businessOwner, tenantOwner, person

async function staff(code) {
  const row = await prisma.person.create({ data: { code, displayName: code } })
  await prisma.membership.create({
    data: { personId: row.id, tenantId: tenant.id, businessId: business.id, scopeType: 'BUSINESS', role: 'MEMBER', status: 'ACTIVE' },
  })
  return row
}

describe('FR-196 — a conflict cannot be assembled in stages', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'Stage Group', code: 'PF-STAGE' })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'Stage Tenant', code: 'TNT-STAGE' })
    business = await createBusiness({ tenantId: tenant.id, name: 'ร้าน Stage', code: 'BUS-STAGE' })
    businessOwner = makeViewer({
      visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
      principal: { id: 'per-stage-bo', code: 'PER-STAGE-BO', displayName: 'Business Owner' },
    })
    tenantOwner = makeViewer({
      visibleBusinessIds: [business.id], ownedBusinessIds: [business.id], ownedTenantIds: [tenant.id],
      principal: { id: 'per-stage-to', code: 'PER-STAGE-TO', displayName: 'Tenant Owner' },
    })
    person = await staff('PSN-STAGE-1')
  })

  it('sees a SUSPENDED binding as still held — suspending does not clear the way', async () => {
    const sales = await assignRoleBinding(
      { personId: person.id, tenantId: tenant.id, businessId: business.id, roleKey: ROLE_SALES_REP },
      { viewer: businessOwner },
    )
    await updateRoleBindingStatus(sales.id, 'SUSPENDED', { viewer: businessOwner })

    // The move the old code allowed. A suspended role is still this person's:
    // it returns with one reactivation, so it still counts against the conflict.
    await expect(assignRoleBinding(
      { personId: person.id, tenantId: tenant.id, businessId: business.id, roleKey: ROLE_PAYMENT_VERIFIER },
      { viewer: businessOwner },
    )).rejects.toMatchObject({ status: 409 })
  })

  it('refuses a Business owner reactivating into a conflict, and records the Tenant owner who allows it', async () => {
    const other = await staff('PSN-STAGE-2')
    const sales = await assignRoleBinding(
      { personId: other.id, tenantId: tenant.id, businessId: business.id, roleKey: ROLE_SALES_REP },
      { viewer: businessOwner },
    )
    await updateRoleBindingStatus(sales.id, 'REVOKED', { viewer: businessOwner })

    // REVOKED is terminal and therefore genuinely gone (ADR-077 D2), so the
    // second role assigns cleanly — this is the legitimate path, not the hole.
    await assignRoleBinding(
      { personId: other.id, tenantId: tenant.id, businessId: business.id, roleKey: ROLE_PAYMENT_VERIFIER },
      { viewer: businessOwner },
    )

    // Bringing the revoked one back is an assignment, and must clear the same gate.
    await expect(updateRoleBindingStatus(sales.id, 'ACTIVE', { viewer: businessOwner }))
      .rejects.toMatchObject({ status: 409 })

    // A reason alone is not enough — the authority is the Tenant owner's.
    await expect(updateRoleBindingStatus(sales.id, 'ACTIVE', { viewer: businessOwner, sodOverride: { reason: 'ร้านมีคนเดียว' } }))
      .rejects.toMatchObject({ status: 403 })

    const reinstated = await updateRoleBindingStatus(
      sales.id, 'ACTIVE',
      { viewer: tenantOwner, sodOverride: { reason: 'ร้านมีพนักงานคนเดียว อนุมัติโดยเจ้าของกลุ่ม' } },
    )
    expect(reinstated.status).toBe('ACTIVE')
    expect(reinstated.sodOverrideReason).toContain('อนุมัติโดยเจ้าของกลุ่ม')

    const audit = await prisma.auditEvent.findFirst({
      where: { entityType: 'ROLE_BINDING', entityId: sales.id, action: 'ROLE_BINDING_REACTIVATED' },
      orderBy: { occurredAt: 'desc' },
    })
    expect(JSON.parse(audit.payloadJson)).toMatchObject({ sodOverride: true, conflictsWith: [ROLE_PAYMENT_VERIFIER] })
  })

  it('clears a stale override reason when the binding leaves ACTIVE', async () => {
    // A reason belongs to the act that needed it. Carrying it forward would
    // credit a later reactivation to whoever justified the earlier one.
    const third = await staff('PSN-STAGE-3')
    const sales = await assignRoleBinding(
      { personId: third.id, tenantId: tenant.id, businessId: business.id, roleKey: ROLE_SALES_REP },
      { viewer: businessOwner },
    )
    await assignRoleBinding(
      { personId: third.id, tenantId: tenant.id, businessId: business.id, roleKey: ROLE_PAYMENT_VERIFIER, sodOverride: { reason: 'ชั่วคราวระหว่างหาพนักงาน' } },
      { viewer: tenantOwner },
    )
    const suspended = await updateRoleBindingStatus(sales.id, 'SUSPENDED', { viewer: businessOwner })
    expect(suspended.sodOverrideReason).toBeNull()
  })
})
