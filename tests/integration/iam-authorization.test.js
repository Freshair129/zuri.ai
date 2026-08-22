import { beforeAll, describe, expect, it } from 'vitest'
import prisma from '@/lib/db'
import { createBusiness, createPortfolio, createTenant } from '../factories/scope'
import { resolveAuthorizationContext } from '@/modules/identity/authorization-context'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { classifyPrincipal } from '@/modules/identity/classify-principal'
import { defaultReadOnlyTools } from '@/modules/agent'

// @req FR-094, FR-096, FR-098 — canonical Person, active Membership and
// invocation-time tool policy are shared across identity and agent surfaces.
// @spec ADR-045 D1-D4, SDD-052, BR-020, SEC-018
// @tested tests/integration/iam-authorization.test.js

let tenant
let business
let staff
let customerPerson
let customer

describe('Issue #99 P0 canonical IAM authorization', () => {
  beforeAll(async () => {
    const portfolio = await createPortfolio({ name: 'IAM Group', code: 'PF-IAM99' })
    tenant = await createTenant({ portfolioId: portfolio.id, name: 'IAM Tenant', code: 'TNT-IAM99' })
    business = await createBusiness({ tenantId: tenant.id, name: 'IAM Business', code: 'BUS-IAM99' })
    staff = await prisma.person.create({ data: { code: 'PSN-IAM99-STAFF', displayName: 'IAM Staff' } })
    await prisma.membership.create({
      data: { personId: staff.id, tenantId: tenant.id, businessId: business.id, role: 'MANAGER', status: 'ACTIVE' },
    })
    customerPerson = await prisma.person.create({ data: { code: 'PSN-IAM99-CUSTOMER', displayName: 'IAM Customer' } })
    customer = await prisma.customer.create({
      data: {
        code: 'CUS-IAM99',
        tenantId: tenant.id,
        businessId: business.id,
        personId: customerPerson.id,
        displayName: 'IAM customer profile',
      },
    })
  })

  it('resolves active Membership through the canonical context', async () => {
    const context = await resolveAuthorizationContext({
      personId: staff.id,
      tenantId: tenant.id,
      businessId: business.id,
    })
    expect(context.decision).toEqual({ allowed: true, reason: 'ACTIVE_MEMBERSHIP_ALLOWED' })
    expect(context.memberships).toHaveLength(1)
  })

  it('removes suspended Membership from viewer and staff classification on the next read', async () => {
    await prisma.membership.updateMany({
      where: { personId: staff.id, tenantId: tenant.id, businessId: business.id },
      data: { status: 'SUSPENDED', version: { increment: 1 } },
    })

    const context = await resolveAuthorizationContext({
      personId: staff.id,
      tenantId: tenant.id,
      businessId: business.id,
    })
    expect(context.decision).toEqual({ allowed: false, reason: 'MEMBERSHIP_SCOPE_DENIED' })

    const viewer = await resolveViewer({ principalId: staff.id })
    expect(viewer.visibleBusinessIds).not.toContain(business.id)
    await expect(classifyPrincipal({ tenantId: tenant.id, personId: staff.id })).resolves.toMatchObject({
      principalType: 'UNKNOWN',
      isStaff: false,
    })
  })

  it('ignores forged tenant/principal arguments at tool invocation', async () => {
    await prisma.membership.updateMany({
      where: { personId: staff.id, tenantId: tenant.id, businessId: business.id },
      data: { status: 'ACTIVE', version: { increment: 1 } },
    })
    const authorizationContext = await resolveAuthorizationContext({
      personId: staff.id,
      tenantId: tenant.id,
      businessId: business.id,
    })
    const registry = defaultReadOnlyTools({
      authorization: {
        authorizationContext,
        principal: { customerId: null },
      },
    })

    const result = await registry.get('read_customer_profile').handler({
      tenantId: 'forged-tenant',
      principalId: 'forged-principal',
      customerId: customer.id,
    })
    expect(result).toMatchObject({ id: customer.id, tenantId: tenant.id })
  })

  it('denies tool invocation when the shared context is denied', async () => {
    await prisma.membership.updateMany({
      where: { personId: staff.id, tenantId: tenant.id, businessId: business.id },
      data: { status: 'SUSPENDED', version: { increment: 1 } },
    })
    const authorizationContext = await resolveAuthorizationContext({
      personId: staff.id,
      tenantId: tenant.id,
      businessId: business.id,
    })
    const registry = defaultReadOnlyTools({
      authorization: { authorizationContext, principal: { customerId: null } },
    })

    await expect(registry.get('read_customer_profile').handler({ customerId: customer.id }))
      .rejects.toThrow(/TOOL_AUTHORIZATION_DENIED/)
  })
})
