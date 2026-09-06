import { describe, expect, it, vi } from 'vitest'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import {
  ROLE_PERMISSIONS,
  ROLE_PRODUCT_OWNER,
  hasPermission,
} from '@/modules/identity/rbac'
import { canManageProduct } from '@/modules/identity/product-owner-authority'
import {
  assignRoleBinding,
  updateRoleBindingStatus,
} from '@/modules/identity/rbac-service'
import { makeDevViewer, makeViewer, ownsElsewhere } from '../factories/viewer'

// @req FR-076 — Product Owner is a generic Business-scoped RBAC role binding.
// @spec ADR-033 — customer Workspace/Tenant ancestry and Product-only authority.
// @tested tests/unit/fr076-product-owner-business-assignment.test.js

const businesses = [
  { id: 'b-smartgift', tenantId: 't-etoh', code: 'BUS-SMARTGIFT', status: 'ACTIVE' },
  { id: 'b-mujeen', tenantId: 't-etoh', code: 'BUS-MUJEEN', status: 'ACTIVE' },
  { id: 'b-foreign', tenantId: 't-other', code: 'BUS-FOREIGN', status: 'ACTIVE' },
]

const person = (id) => ({ id, code: `PER-${id}`, displayName: id })

function viewerDb({ memberships = [], bindings = [], people = [person('p-product')], businessRows = businesses } = {}) {
  return {
    person: {
      findUnique: vi.fn(async ({ where }) => people.find((item) => item.id === where.id) || null),
    },
    membership: {
      findMany: vi.fn(async ({ where }) => memberships.filter((item) => item.personId === where.personId)),
    },
    business: {
      findMany: vi.fn(async () => businessRows),
    },
    roleBinding: {
      findMany: vi.fn(async () => bindings),
    },
  }
}

const owner = (businessId = 'b-smartgift') => makeViewer({
  principal: person('p-owner'),
  visibleBusinessIds: [businessId],
  ownedBusinessIds: [businessId],
})

describe('FR-076 Product Owner RBAC viewer authority', () => {
  it('resolves active Product Owner role bindings for multiple Businesses in one Tenant', async () => {
    const db = viewerDb({
      memberships: [{ personId: 'p-product', tenantId: 't-etoh', businessId: null, role: 'MEMBER', domainKeysJson: '[]' }],
      bindings: [
        { personId: 'p-product', tenantId: 't-etoh', businessId: 'b-smartgift', roleKey: ROLE_PRODUCT_OWNER, scopeType: 'BUSINESS', status: 'ACTIVE' },
        { personId: 'p-product', tenantId: 't-etoh', businessId: 'b-mujeen', roleKey: ROLE_PRODUCT_OWNER, scopeType: 'BUSINESS', status: 'ACTIVE' },
        { personId: 'p-product', tenantId: 't-etoh', businessId: 'b-foreign', roleKey: ROLE_PRODUCT_OWNER, scopeType: 'BUSINESS', status: 'ACTIVE' },
        { personId: 'p-product', tenantId: 't-etoh', businessId: 'b-smartgift', roleKey: ROLE_PRODUCT_OWNER, scopeType: 'BUSINESS', status: 'REVOKED' },
      ],
      people: [person('p-product')],
    })

    const viewer = await resolveViewer({ principalId: 'p-product', db })

    expect(viewer.rolesByBusinessId).toEqual({
      'b-smartgift': [ROLE_PRODUCT_OWNER],
      'b-mujeen': [ROLE_PRODUCT_OWNER],
    })
    expect(viewer.permissionsByBusinessId).toEqual({
      'b-smartgift': ROLE_PERMISSIONS[ROLE_PRODUCT_OWNER],
      'b-mujeen': ROLE_PERMISSIONS[ROLE_PRODUCT_OWNER],
    })
    expect(hasPermission(viewer, 'b-smartgift', 'product.plan.write')).toBe(true)
    expect(canManageProduct(viewer, 'b-smartgift')).toBe(true)
    expect(canManageProduct(viewer, 'b-mujeen')).toBe(true)
    expect(canManageProduct(viewer, 'b-foreign')).toBe(false)
  })

  it('does not infer Product authority from Business OWNER or platform DEV', () => {
    expect(canManageProduct(owner(), 'b-smartgift')).toBe(false)
    expect(canManageProduct(makeDevViewer({ visibleBusinessIds: ['b-smartgift'] }), 'b-smartgift')).toBe(false)
    expect(canManageProduct(ownsElsewhere({ owns: 'b-smartgift', sees: 'b-mujeen' }), 'b-mujeen')).toBe(false)
  })

  it('fails closed when an assigned Business is not active', async () => {
    const db = viewerDb({
      memberships: [{ personId: 'p-product', tenantId: 't-etoh', businessId: null, role: 'MEMBER', domainKeysJson: '[]' }],
      bindings: [{ personId: 'p-product', tenantId: 't-etoh', businessId: 'b-smartgift', roleKey: ROLE_PRODUCT_OWNER, scopeType: 'BUSINESS', status: 'ACTIVE' }],
      businessRows: businesses.map((business) => business.id === 'b-smartgift' ? { ...business, status: 'ARCHIVED' } : business),
    })

    const viewer = await resolveViewer({ principalId: 'p-product', db })

    expect(viewer.rolesByBusinessId).toEqual({})
    expect(canManageProduct(viewer, 'b-smartgift')).toBe(false)
  })
})

describe('FR-076 generic RoleBinding lifecycle', () => {
  function bindingDb(overrides = {}) {
    return {
      person: { findUnique: vi.fn().mockResolvedValue({ id: 'p-product' }) },
      membership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-etoh', businessId: null, tenantId: 't-etoh' }) },
      business: { findUnique: vi.fn().mockResolvedValue({ id: 'b-smartgift', tenantId: 't-etoh', status: 'ACTIVE' }) },
      roleBinding: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'binding-1', personId: 'p-product', tenantId: 't-etoh', businessId: 'b-smartgift', roleKey: ROLE_PRODUCT_OWNER, scopeType: 'BUSINESS', status: 'ACTIVE' }),
        update: vi.fn().mockResolvedValue({ id: 'binding-1', businessId: 'b-smartgift', tenantId: 't-etoh', roleKey: ROLE_PRODUCT_OWNER, status: 'REVOKED' }),
        ...overrides.roleBinding,
      },
      auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    }
  }

  it('assigns a generic Product Owner role binding only when the assigning viewer owns the target Business', async () => {
    const db = bindingDb()

    const result = await assignRoleBinding({
      personId: 'p-product',
      tenantId: 't-etoh',
      businessId: 'b-smartgift',
      roleKey: ROLE_PRODUCT_OWNER,
    }, { db, viewer: owner() })

    expect(result.status).toBe('ACTIVE')
    expect(db.roleBinding.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ roleKey: ROLE_PRODUCT_OWNER, scopeType: 'BUSINESS', status: 'ACTIVE', assignedBy: 'p-owner' }),
    }))
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entityType: 'ROLE_BINDING', action: 'ROLE_BINDING_ASSIGNED' }),
    }))
  })

  it('rejects an unknown role key before writing', async () => {
    const db = bindingDb()

    await expect(assignRoleBinding({
      personId: 'p-product', tenantId: 't-etoh', businessId: 'b-smartgift', roleKey: 'TENANT_OWNER',
    }, { db, viewer: owner() })).rejects.toMatchObject({ status: 400 })

    expect(db.roleBinding.create).not.toHaveBeenCalled()
  })

  it('rejects a visible-but-unowned Business and does not write or audit', async () => {
    const db = bindingDb()
    const viewer = ownsElsewhere({
      owns: 'b-smartgift',
      sees: 'b-mujeen',
      principal: person('p-owner'),
    })
    db.business.findUnique.mockResolvedValue({ id: 'b-mujeen', tenantId: 't-etoh', status: 'ACTIVE' })

    await expect(assignRoleBinding({
      personId: 'p-product', tenantId: 't-etoh', businessId: 'b-mujeen', roleKey: ROLE_PRODUCT_OWNER,
    }, { db, viewer })).rejects.toMatchObject({ status: 404 })

    expect(db.roleBinding.create).not.toHaveBeenCalled()
    expect(db.auditEvent.create).not.toHaveBeenCalled()
  })

  it('rejects a mismatched Tenant/Business ancestry', async () => {
    const db = bindingDb()
    db.business.findUnique.mockResolvedValue({ id: 'b-smartgift', tenantId: 't-other', status: 'ACTIVE' })

    await expect(assignRoleBinding({
      personId: 'p-product', tenantId: 't-etoh', businessId: 'b-smartgift', roleKey: ROLE_PRODUCT_OWNER,
    }, { db, viewer: owner() })).rejects.toThrow(/tenant/i)

    expect(db.roleBinding.create).not.toHaveBeenCalled()
  })

  it('revokes one RoleBinding and appends a redacted audit event', async () => {
    const db = bindingDb({
      roleBinding: {
        findUnique: vi.fn().mockResolvedValue({ id: 'binding-1', businessId: 'b-smartgift', tenantId: 't-etoh', roleKey: ROLE_PRODUCT_OWNER, status: 'ACTIVE' }),
      },
    })

    const result = await updateRoleBindingStatus('binding-1', 'REVOKED', { db, viewer: owner() })

    expect(result.status).toBe('REVOKED')
    expect(db.roleBinding.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'binding-1' },
      data: expect.objectContaining({ status: 'REVOKED' }),
    }))
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entityType: 'ROLE_BINDING', action: 'ROLE_BINDING_REVOKED' }),
    }))
  })
})
