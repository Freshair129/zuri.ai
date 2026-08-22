import { describe, expect, it, vi } from 'vitest'
import { authorizeScope, resolveAuthorizationContext } from '@/modules/identity/authorization-context'

// @req FR-094, FR-096, FR-098, NFR-019 — identity and scope policy is one
// fail-closed decision before protected reads or writes.
// @spec ADR-045 D1-D4, SDD-052, BR-020, SEC-018
// @tested tests/unit/authorization-context.test.js

function dbFor({ memberships = [], bindings = [] } = {}) {
  return {
    person: { findUnique: vi.fn().mockResolvedValue({ id: 'person-1' }) },
    tenant: { findUnique: vi.fn().mockResolvedValue({ id: 'tenant-1', status: 'ACTIVE' }) },
    business: { findUnique: vi.fn().mockResolvedValue({ id: 'business-1', tenantId: 'tenant-1', status: 'ACTIVE' }) },
    membership: { findMany: vi.fn().mockResolvedValue(memberships) },
    roleBinding: { findMany: vi.fn().mockResolvedValue(bindings) },
  }
}

describe('FR-096 shared policy enforcement point', () => {
  it('allows an active Business membership and returns only server-owned scope', async () => {
    const context = await resolveAuthorizationContext({
      personId: 'person-1',
      tenantId: 'tenant-1',
      businessId: 'business-1',
      db: dbFor({ memberships: [{ id: 'membership-1', tenantId: 'tenant-1', businessId: 'business-1', role: 'MANAGER', status: 'ACTIVE' }] }),
    })

    expect(context.decision).toEqual({ allowed: true, reason: 'ACTIVE_MEMBERSHIP_ALLOWED' })
    expect(context.scope).toEqual({ tenantId: 'tenant-1', businessId: 'business-1' })
    expect(authorizeScope(context, { businessId: 'other-business' })).toEqual({
      allowed: false,
      reason: 'BUSINESS_SCOPE_MISMATCH',
    })
  })

  it('denies suspended membership before a tool or retrieval can use it', async () => {
    const context = await resolveAuthorizationContext({
      personId: 'person-1',
      tenantId: 'tenant-1',
      businessId: 'business-1',
      db: dbFor({ memberships: [] }),
    })

    expect(context.decision).toEqual({ allowed: false, reason: 'MEMBERSHIP_SCOPE_DENIED' })
    expect(authorizeScope(context)).toEqual(context.decision)
  })

  it('does not let a role-binding permission cross the selected Business', async () => {
    const context = await resolveAuthorizationContext({
      personId: 'person-1',
      tenantId: 'tenant-1',
      businessId: 'business-1',
      permission: 'product.plan.write',
      db: dbFor({
        memberships: [{ id: 'membership-1', tenantId: 'tenant-1', businessId: 'business-1', role: 'MEMBER', status: 'ACTIVE' }],
        bindings: [{ tenantId: 'tenant-1', businessId: 'business-1', roleKey: 'PRODUCT_OWNER', scopeType: 'BUSINESS', status: 'ACTIVE' }],
      }),
    })

    expect(context.decision.allowed).toBe(true)
    expect(authorizeScope(context, { permission: 'product.decision.write' }).allowed).toBe(true)
    expect(authorizeScope(context, { businessId: 'business-2' })).toMatchObject({ allowed: false })
  })
})
