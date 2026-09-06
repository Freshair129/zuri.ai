import { describe, it, expect, beforeAll } from 'vitest'
import prisma from '@/lib/db'
import { makeViewer, makeOperatorViewer, ownsElsewhere } from '../factories/viewer'
// The real service on purpose: this suite's subject IS who may create scope, so
// it must not go through tests/factories/scope.js, which exists to authorize
// arrangement elsewhere.
import {
  createPortfolio,
  createTenant,
  createLegalEntity,
  createBusiness,
  createBusinessInGroup,
  createBranch,
  createWorkspace,
} from '@/modules/project-manager/application/scope-service'

// @req FR-074 — every scope creator is authorized at the scope it writes.
// @req FR-075 — the primitives above any Tenant require operator authority.
// @spec SEC-001, SEC-008, BR-001
//
// `/api/scope` was the last route on the baseline that no guard could repay,
// because five of its seven creators write at or above the Business boundary and
// nothing above Business was expressible. Two authorities answer it: `ownsTenant`
// (a tenant-wide OWNER Membership that already existed in the data) and the
// installation-operator capability. Every refusal here is paired with the control
// that proves the refusal is causal.

let operator, tenantOwner, businessOwner, ownsEverything
let portfolio, tenant, business, founderPerson

async function refusalFrom(fn) {
  try {
    await fn()
  } catch (error) {
    return error
  }
  throw new Error('expected the call to be refused, but it resolved')
}

describe('FR-074 scope creation authorization', () => {
  beforeAll(async () => {
    operator = makeOperatorViewer({ visibleBusinessIds: [], ownedBusinessIds: [] })
    portfolio = await createPortfolio({ name: 'Authz Scope Group', code: 'PF-AZS' }, { viewer: operator })
    tenant = await createTenant(
      { portfolioId: portfolio.id, name: 'Authz Scope Tenant', code: 'TNT-AZS' }, { viewer: operator },
    )
    tenantOwner = makeViewer({
      role: 'OWNER', visibleBusinessIds: [], ownedBusinessIds: [], ownedTenantIds: [tenant.id],
    })
    business = await createBusiness(
      { tenantId: tenant.id, name: 'Authz Scope Business', code: 'BUS-AZS' }, { viewer: tenantOwner },
    )
    businessOwner = makeViewer({ visibleBusinessIds: [business.id], ownedBusinessIds: [business.id] })
    // Owns every Business in the installation and is still not an operator, and
    // still does not own the Tenant. This is the viewer that makes the two new
    // authorities mean something.
    ownsEverything = makeViewer({
      visibleBusinessIds: [business.id], ownedBusinessIds: [business.id],
    })
    founderPerson = await prisma.person.create({ data: { code: 'PER-AZS', displayName: 'Founder' } })
  })

  describe('above any Tenant — operator only (FR-075)', () => {
    it('refuses a viewer who owns every Business, and permits the operator', async () => {
      const before = await prisma.portfolio.count()
      const error = await refusalFrom(() =>
        createPortfolio({ name: 'Sneaky', code: 'PF-AZS-NO' }, { viewer: ownsEverything }),
      )
      expect(error.status).toBe(403)
      expect(error.message).toMatch(/operator authority/)
      expect(await prisma.portfolio.count()).toBe(before)

      // The control: identical call, an operator.
      const created = await createPortfolio({ name: 'Fine', code: 'PF-AZS-OK' }, { viewer: operator })
      expect(created.code).toBe('PF-AZS-OK')
    })

    it('refuses Tenant and LegalEntity creation the same way', async () => {
      const tenantsBefore = await prisma.tenant.count()
      const tenantError = await refusalFrom(() =>
        createTenant({ portfolioId: portfolio.id, name: 'No', code: 'TNT-AZS-NO' }, { viewer: tenantOwner }),
      )
      expect(tenantError.status).toBe(403)
      expect(await prisma.tenant.count()).toBe(tenantsBefore)

      const entityError = await refusalFrom(() =>
        createLegalEntity({ portfolioId: portfolio.id, legalName: 'No Ltd', code: 'LE-AZS-NO' }, { viewer: businessOwner }),
      )
      expect(entityError.status).toBe(403)

      await expect(
        createTenant({ portfolioId: portfolio.id, name: 'Yes', code: 'TNT-AZS-OK' }, { viewer: operator }),
      ).resolves.toMatchObject({ code: 'TNT-AZS-OK' })
    })

    it('owning a Tenant is not operator authority — the two are different scopes', async () => {
      // The whole point of naming a separate capability: no amount of ownership
      // beneath the boundary adds up to authority above it.
      const error = await refusalFrom(() =>
        createWorkspace(
          { name: 'Shared', scopeType: 'PORTFOLIO', portfolioId: portfolio.id, code: 'WS-AZS-PF' },
          { viewer: tenantOwner },
        ),
      )
      expect(error.status).toBe(403)
      await expect(
        createWorkspace(
          { name: 'Shared', scopeType: 'PORTFOLIO', portfolioId: portfolio.id, code: 'WS-AZS-PF' },
          { viewer: operator },
        ),
      ).resolves.toMatchObject({ scopeType: 'PORTFOLIO' })
    })
  })

  describe('Tenant scope (FR-074b)', () => {
    it('refuses a Business owner who does not own the Tenant, and permits the Tenant owner', async () => {
      const before = await prisma.business.count()
      const error = await refusalFrom(() =>
        createBusiness({ tenantId: tenant.id, name: 'No', code: 'BUS-AZS-NO' }, { viewer: businessOwner }),
      )
      expect(error.status).toBe(404)
      expect(error.message).toBe('Tenant not found')
      expect(await prisma.business.count()).toBe(before)

      await expect(
        createBusiness({ tenantId: tenant.id, name: 'Yes', code: 'BUS-AZS-OK' }, { viewer: tenantOwner }),
      ).resolves.toMatchObject({ code: 'BUS-AZS-OK' })
    })

    it('answers for an unowned Tenant exactly as for one that does not exist', async () => {
      const real = await refusalFrom(() =>
        createBusiness({ tenantId: tenant.id, name: 'x', code: 'BUS-AZS-X1' }, { viewer: businessOwner }),
      )
      const fabricated = await refusalFrom(() =>
        createBusiness({ tenantId: 'no-such-tenant', name: 'x', code: 'BUS-AZS-X2' }, { viewer: businessOwner }),
      )
      expect(real.status).toBe(fabricated.status)
      expect(real.message).toBe(fabricated.message)
    })

    it('a TENANT-scoped Space takes the same authority', async () => {
      const error = await refusalFrom(() =>
        createWorkspace(
          { name: 'T', scopeType: 'TENANT', tenantId: tenant.id, code: 'WS-AZS-T-NO' }, { viewer: businessOwner },
        ),
      )
      expect(error.status).toBe(404)
      await expect(
        createWorkspace(
          { name: 'T', scopeType: 'TENANT', tenantId: tenant.id, code: 'WS-AZS-T-OK' }, { viewer: tenantOwner },
        ),
      ).resolves.toMatchObject({ scopeType: 'TENANT' })
    })
  })

  describe('Business scope (FR-074a)', () => {
    it('refuses the attacker on a Branch and permits the Business owner', async () => {
      const before = await prisma.branch.count()
      const attacker = ownsElsewhere({ sees: business.id })
      const error = await refusalFrom(() =>
        createBranch(
          { tenantId: tenant.id, businessId: business.id, name: 'No', code: 'BR-AZS-NO' }, { viewer: attacker },
        ),
      )
      expect(error.status).toBe(404)
      expect(await prisma.branch.count()).toBe(before)

      await expect(
        createBranch(
          { tenantId: tenant.id, businessId: business.id, name: 'Yes', code: 'BR-AZS-OK' }, { viewer: businessOwner },
        ),
      ).resolves.toMatchObject({ code: 'BR-AZS-OK' })
    })

    it('a BUSINESS-scoped Space takes the same authority', async () => {
      const attacker = ownsElsewhere({ sees: business.id })
      const error = await refusalFrom(() =>
        createWorkspace(
          { name: 'B', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-AZS-B-NO' }, { viewer: attacker },
        ),
      )
      expect(error.status).toBe(404)
      await expect(
        createWorkspace(
          { name: 'B', scopeType: 'BUSINESS', businessId: business.id, code: 'WS-AZS-B-OK' }, { viewer: businessOwner },
        ),
      ).resolves.toMatchObject({ scopeType: 'BUSINESS' })
    })
  })

  describe('self-service provisioning (FR-074c)', () => {
    it('lets any authenticated principal provision, and binds them as OWNER', async () => {
      const founder = makeViewer({
        principal: { id: founderPerson.id, code: founderPerson.code, displayName: founderPerson.displayName },
        visibleBusinessIds: ['b-none'],
        ownedBusinessIds: [],
      })
      const result = await createBusinessInGroup({ name: 'Self Serve', code: 'BUS-AZS-SELF' }, { viewer: founder })

      const membership = await prisma.membership.findFirst({
        where: { tenantId: result.tenant.id, personId: founderPerson.id },
      })
      // Without this the caller would provision scope they cannot then write to —
      // the defect this clause fixes as well as authorizes.
      expect(membership).not.toBeNull()
      expect(membership.role).toBe('OWNER')
      expect(membership.businessId).toBeNull()
    })

    it('is still not anonymous — a missing viewer is a loud crash, not a quiet write', async () => {
      const before = await prisma.tenant.count()
      const error = await refusalFrom(() => createBusinessInGroup({ name: 'Anon', code: 'BUS-AZS-ANON' }))
      expect(error.message).toMatch(/viewer is required/)
      expect(error.status).toBeUndefined()
      expect(await prisma.tenant.count()).toBe(before)
    })
  })

  it('refuses a Space scope type nobody declared a creation authority for', async () => {
    // Two gates, and this asserts the outer one. `zWorkspaceInput` types
    // scopeType as the enum, so garbage never reaches the authorizer lookup —
    // which is why this asserts rejection rather than a status: a ZodError
    // carries none.
    //
    // The inner gate is the deny-by-default lookup in createWorkspace. It has no
    // reachable case today, because all three enum values have an authorizer,
    // and that is precisely its job: whoever adds a fourth value to
    // WORKSPACE_SCOPE_TYPES gets a refusal until they declare how it is
    // authorized, instead of a hand-written `if` silently permitting it.
    await expect(
      createWorkspace({ name: 'X', scopeType: 'GALAXY', businessId: business.id, code: 'WS-AZS-GX' }, { viewer: operator }),
    ).rejects.toThrow()
    const before = await prisma.workspace.count()
    await refusalFrom(() =>
      createWorkspace({ name: 'X', scopeType: 'GALAXY', businessId: business.id, code: 'WS-AZS-GX' }, { viewer: operator }),
    )
    expect(await prisma.workspace.count()).toBe(before)
  })
})
