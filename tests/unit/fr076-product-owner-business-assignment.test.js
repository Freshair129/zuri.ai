import { describe, expect, it, vi } from 'vitest'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import {
  PRODUCT_OWNER_CAPABILITY,
  canManageProduct,
} from '@/modules/identity/product-owner-authority'
import {
  assignProductOwner,
  updateProductOwnerAssignmentStatus,
} from '@/modules/identity/product-owner-service'
import { makeDevViewer, makeViewer, ownsElsewhere } from '../factories/viewer'

// @req FR-076 — Product Owner is an explicit Business-scoped Product capability.
// @spec ADR-033 — customer Workspace/Tenant ancestry and Product-only authority.
// @tested tests/unit/fr076-product-owner-business-assignment.test.js

const businesses = [
  { id: 'b-smartgift', tenantId: 't-etoh', code: 'BUS-SMARTGIFT' },
  { id: 'b-mujeen', tenantId: 't-etoh', code: 'BUS-MUJEEN' },
  { id: 'b-foreign', tenantId: 't-other', code: 'BUS-FOREIGN' },
]

const person = (id) => ({ id, code: `PER-${id}`, displayName: id })

function viewerDb({ memberships = [], assignments = [], people = [person('p-product')] } = {}) {
  return {
    person: {
      findUnique: vi.fn(async ({ where }) => people.find((item) => item.id === where.id) || null),
    },
    membership: {
      findMany: vi.fn(async ({ where }) => memberships.filter((item) => item.personId === where.personId)),
    },
    business: {
      findMany: vi.fn(async () => businesses),
    },
    productOwnerAssignment: {
      findMany: vi.fn(async () => assignments),
    },
  }
}

const owner = (businessId = 'b-smartgift') => makeViewer({
  principal: person('p-owner'),
  visibleBusinessIds: [businessId],
  ownedBusinessIds: [businessId],
})

describe('FR-076 Product Owner viewer authority', () => {
  it('resolves active Product assignments for multiple Businesses in one Tenant', async () => {
    const db = viewerDb({
      memberships: [{ personId: 'p-product', tenantId: 't-etoh', businessId: null, role: 'MEMBER', domainKeysJson: '[]' }],
      assignments: [
        { personId: 'p-product', tenantId: 't-etoh', businessId: 'b-smartgift', capability: PRODUCT_OWNER_CAPABILITY, status: 'ACTIVE' },
        { personId: 'p-product', tenantId: 't-etoh', businessId: 'b-mujeen', capability: PRODUCT_OWNER_CAPABILITY, status: 'ACTIVE' },
        { personId: 'p-product', tenantId: 't-etoh', businessId: 'b-foreign', capability: PRODUCT_OWNER_CAPABILITY, status: 'ACTIVE' },
        { personId: 'p-product', tenantId: 't-etoh', businessId: 'b-smartgift', capability: PRODUCT_OWNER_CAPABILITY, status: 'REVOKED' },
      ],
      people: [person('p-product')],
    })

    const viewer = await resolveViewer({ principalId: 'p-product', db })

    expect(viewer.productOwnerBusinessIds).toEqual(['b-smartgift', 'b-mujeen'])
    expect(viewer.productCapabilitiesByBusinessId).toEqual({
      'b-smartgift': [PRODUCT_OWNER_CAPABILITY],
      'b-mujeen': [PRODUCT_OWNER_CAPABILITY],
    })
    expect(canManageProduct(viewer, 'b-smartgift')).toBe(true)
    expect(canManageProduct(viewer, 'b-mujeen')).toBe(true)
    expect(canManageProduct(viewer, 'b-foreign')).toBe(false)
  })

  it('does not infer Product authority from Business OWNER or platform DEV', () => {
    expect(canManageProduct(owner(), 'b-smartgift')).toBe(false)
    expect(canManageProduct(makeDevViewer({ visibleBusinessIds: ['b-smartgift'] }), 'b-smartgift')).toBe(false)
    expect(canManageProduct(ownsElsewhere({ owns: 'b-smartgift', sees: 'b-mujeen' }), 'b-mujeen')).toBe(false)
  })
})

describe('FR-076 Product Owner assignment lifecycle', () => {
  function assignmentDb(overrides = {}) {
    return {
      person: { findUnique: vi.fn().mockResolvedValue({ id: 'p-product' }) },
      membership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-etoh', businessId: null, tenantId: 't-etoh' }) },
      business: { findUnique: vi.fn().mockResolvedValue({ id: 'b-smartgift', tenantId: 't-etoh' }) },
      productOwnerAssignment: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'assignment-1', personId: 'p-product', tenantId: 't-etoh', businessId: 'b-smartgift', capability: PRODUCT_OWNER_CAPABILITY, status: 'ACTIVE' }),
        update: vi.fn().mockResolvedValue({ id: 'assignment-1', businessId: 'b-smartgift', tenantId: 't-etoh', status: 'REVOKED' }),
        ...overrides.productOwnerAssignment,
      },
      auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-1' }) },
    }
  }

  it('assigns Product capability only when the assigning viewer owns the target Business', async () => {
    const db = assignmentDb()

    const result = await assignProductOwner({
      personId: 'p-product',
      tenantId: 't-etoh',
      businessId: 'b-smartgift',
    }, { db, viewer: owner() })

    expect(result.status).toBe('ACTIVE')
    expect(db.productOwnerAssignment.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ capability: PRODUCT_OWNER_CAPABILITY, status: 'ACTIVE', assignedBy: 'p-owner' }),
    }))
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entityType: 'PRODUCT_OWNER_ASSIGNMENT', action: 'PRODUCT_OWNER_ASSIGNED' }),
    }))
  })

  it('rejects a visible-but-unowned Business and does not write or audit', async () => {
    const db = assignmentDb()
    const viewer = ownsElsewhere({
      owns: 'b-smartgift',
      sees: 'b-mujeen',
      principal: person('p-owner'),
    })
    db.business.findUnique.mockResolvedValue({ id: 'b-mujeen', tenantId: 't-etoh' })

    await expect(assignProductOwner({
      personId: 'p-product', tenantId: 't-etoh', businessId: 'b-mujeen',
    }, { db, viewer })).rejects.toMatchObject({ status: 404 })

    expect(db.productOwnerAssignment.create).not.toHaveBeenCalled()
    expect(db.auditEvent.create).not.toHaveBeenCalled()
  })

  it('rejects a mismatched Tenant/Business ancestry', async () => {
    const db = assignmentDb()
    db.business.findUnique.mockResolvedValue({ id: 'b-smartgift', tenantId: 't-other' })

    await expect(assignProductOwner({
      personId: 'p-product', tenantId: 't-etoh', businessId: 'b-smartgift',
    }, { db, viewer: owner() })).rejects.toThrow(/tenant/i)

    expect(db.productOwnerAssignment.create).not.toHaveBeenCalled()
  })

  it('revokes an assignment and appends a redacted audit event', async () => {
    const db = assignmentDb({
      productOwnerAssignment: {
        findUnique: vi.fn().mockResolvedValue({ id: 'assignment-1', businessId: 'b-smartgift', tenantId: 't-etoh', status: 'ACTIVE' }),
      },
    })

    const result = await updateProductOwnerAssignmentStatus('assignment-1', 'REVOKED', { db, viewer: owner() })

    expect(result.status).toBe('REVOKED')
    expect(db.productOwnerAssignment.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'assignment-1' },
      data: expect.objectContaining({ status: 'REVOKED' }),
    }))
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entityType: 'PRODUCT_OWNER_ASSIGNMENT', action: 'PRODUCT_OWNER_REVOKED' }),
    }))
  })
})
