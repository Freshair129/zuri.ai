// @req FR-192/ADR-077 D3 — teaches `resolveViewer` the TENANT RoleBinding
//   scope, left inert on purpose when `scopeType` was added ("until the
//   resolver is taught to expand it"). This is the single most dangerous
//   edit in the identity resolver — three authorization escalations in this
//   repository came from editing it — so the change is proved narrowly: a
//   TENANT binding grants its permission on every ACTIVE Business the Tenant
//   holds TODAY, and on nothing outside that Tenant. `hasPermission` itself is
//   untouched (it only ever reads `permissionsByBusinessId`).
// @spec ADR-077 D3, ADR-033 D3, SEC-001
// @tested tests/unit/fr192-tenant-role-binding-resolver.test.js
import { describe, expect, it, vi } from 'vitest'
import { resolveViewer } from '@/modules/identity/resolve-viewer'
import { hasPermission, PURCHASE_ORDER_WRITE_PERMISSION, ROLE_PROCUREMENT_BUYER } from '@/modules/identity/rbac'

const person = (id) => ({ id, code: `PER-${id}`, displayName: id })

const businesses = [
  { id: 'b-1', tenantId: 't-home', code: 'BUS-1', status: 'ACTIVE' },
  { id: 'b-2', tenantId: 't-home', code: 'BUS-2', status: 'ACTIVE' },
  { id: 'b-archived', tenantId: 't-home', code: 'BUS-ARCHIVED', status: 'ARCHIVED' },
  { id: 'b-other', tenantId: 't-other', code: 'BUS-OTHER', status: 'ACTIVE' },
]

function db({ memberships = [], bindings = [] } = {}) {
  return {
    person: { findUnique: vi.fn(async () => person('p-1')) },
    membership: { findMany: vi.fn(async () => memberships) },
    business: {
      findMany: vi.fn(async ({ where }) => {
        // Mirrors the real query shapes resolveRoleBindings/resolveViewer issue:
        // an `id: { in }` lookup for BUSINESS-scoped bindings, and a
        // `tenantId: { in }, status` lookup for TENANT-scoped expansion.
        if (where?.id?.in) return businesses.filter((b) => where.id.in.includes(b.id))
        if (where?.tenantId?.in) {
          return businesses.filter((b) => where.tenantId.in.includes(b.tenantId) && (!where.status || b.status === where.status))
        }
        return businesses
      }),
    },
    roleBinding: { findMany: vi.fn(async ({ where }) => bindings.filter((b) => b.personId === where.personId)) },
  }
}

describe('FR-192 TENANT-scope RoleBinding resolution', () => {
  it('grants the permission on every ACTIVE Business the Tenant holds today, and on none outside it', async () => {
    const testDb = db({
      bindings: [
        { personId: 'p-1', tenantId: 't-home', businessId: null, roleKey: ROLE_PROCUREMENT_BUYER, scopeType: 'TENANT', status: 'ACTIVE' },
      ],
    })
    const viewer = await resolveViewer({ principalId: 'p-1', db: testDb })

    expect(viewer.rolesByBusinessId).toEqual({
      'b-1': [ROLE_PROCUREMENT_BUYER],
      'b-2': [ROLE_PROCUREMENT_BUYER],
    })
    // ARCHIVED and cross-Tenant Businesses never appear.
    expect(viewer.rolesByBusinessId['b-archived']).toBeUndefined()
    expect(viewer.rolesByBusinessId['b-other']).toBeUndefined()
    expect(hasPermission(viewer, 'b-1', PURCHASE_ORDER_WRITE_PERMISSION)).toBe(true)
    expect(hasPermission(viewer, 'b-2', PURCHASE_ORDER_WRITE_PERMISSION)).toBe(true)
    expect(hasPermission(viewer, 'b-other', PURCHASE_ORDER_WRITE_PERMISSION)).toBe(false)
    // Never expands visibility or ownership — only the permission map widens.
    expect(viewer.visibleBusinessIds).toEqual([])
    expect(viewer.ownedBusinessIds).toEqual([])
  })

  it('a REVOKED or a different Tenant`s TENANT binding grants nothing', async () => {
    const testDb = db({
      bindings: [
        { personId: 'p-1', tenantId: 't-home', businessId: null, roleKey: ROLE_PROCUREMENT_BUYER, scopeType: 'TENANT', status: 'REVOKED' },
        { personId: 'p-1', tenantId: 't-other', businessId: null, roleKey: ROLE_PROCUREMENT_BUYER, scopeType: 'TENANT', status: 'ACTIVE' },
      ],
    })
    // The REVOKED row never reaches the query (status: 'ACTIVE' filter), and
    // the other-Tenant ACTIVE row expands only to `b-other` — proving
    // "a TENANT binding is authority AT the Tenant it names", not a global grant.
    testDb.roleBinding.findMany = vi.fn(async ({ where }) => [
      { personId: 'p-1', tenantId: 't-other', businessId: null, roleKey: ROLE_PROCUREMENT_BUYER, scopeType: 'TENANT', status: 'ACTIVE' },
    ].filter((b) => b.personId === where.personId))

    const viewer = await resolveViewer({ principalId: 'p-1', db: testDb })
    expect(viewer.rolesByBusinessId).toEqual({ 'b-other': [ROLE_PROCUREMENT_BUYER] })
    expect(viewer.rolesByBusinessId['b-1']).toBeUndefined()
  })

  it('combines with a BUSINESS-scoped binding for a different role on a different Business, both resolving correctly', async () => {
    const testDb = db({
      memberships: [{ personId: 'p-1', tenantId: 't-home', businessId: 'b-1', scopeType: 'BUSINESS', role: 'MEMBER', status: 'ACTIVE', domainKeysJson: '[]', expiresAt: null, version: 1 }],
      bindings: [
        { personId: 'p-1', tenantId: 't-home', businessId: null, roleKey: ROLE_PROCUREMENT_BUYER, scopeType: 'TENANT', status: 'ACTIVE' },
        { personId: 'p-1', tenantId: 't-home', businessId: 'b-1', roleKey: 'PAYMENT_VERIFIER', scopeType: 'BUSINESS', status: 'ACTIVE' },
      ],
    })
    const viewer = await resolveViewer({ principalId: 'p-1', db: testDb })
    expect(viewer.rolesByBusinessId['b-1'].sort()).toEqual([ROLE_PROCUREMENT_BUYER, 'PAYMENT_VERIFIER'].sort())
    expect(viewer.rolesByBusinessId['b-2']).toEqual([ROLE_PROCUREMENT_BUYER])
  })

  it('an unknown roleKey on a TENANT binding grants nothing (ROLE_PERMISSIONS gate still applies)', async () => {
    const testDb = db({
      bindings: [{ personId: 'p-1', tenantId: 't-home', businessId: null, roleKey: 'NOT_A_REAL_ROLE', scopeType: 'TENANT', status: 'ACTIVE' }],
    })
    const viewer = await resolveViewer({ principalId: 'p-1', db: testDb })
    expect(viewer.rolesByBusinessId).toEqual({})
  })
})
