import { describe, expect, it } from 'vitest'
import { resolveViewer, VIEWER_DOMAINS } from '@/modules/identity/resolve-viewer'

// @req FR-031 — every future shell route reads one resolved viewer scope.
// @spec ADR-008 §D4, docs/features/FR-031-viewer-gate.md — DEV is a platform grant, not Membership.
// @tested tests/unit/viewer-gate.test.js

const BUSINESSES = [
  { id: 'b-1', code: 'BUS-001', name: 'One', tenantId: 't-1' },
  { id: 'b-2', code: 'BUS-002', name: 'Two', tenantId: 't-1' },
  { id: 'b-3', code: 'BUS-003', name: 'Three', tenantId: 't-2' },
]

function fakeDb({ people = [], memberships = [] } = {}) {
  return {
    person: {
      findUnique: async ({ where }) => people.find((p) => p.id === where.id || p.code === where.code) || null,
    },
    membership: {
      findMany: async ({ where }) => memberships.filter((m) => m.personId === where.personId),
    },
    business: {
      findMany: async () => BUSINESSES,
    },
  }
}

describe('resolveViewer', () => {
  it('keeps a business-scoped MEMBER inside only the assigned business', async () => {
    const viewer = await resolveViewer({
      db: fakeDb({
        people: [{ id: 'p-member', code: 'PER-MEMBER', displayName: 'Member' }],
        memberships: [{ personId: 'p-member', tenantId: 't-1', businessId: 'b-2', role: 'MEMBER', domainKeysJson: '["projects"]' }],
      }),
      principalId: 'p-member',
    })

    expect(viewer.role).toBe('MEMBER')
    expect(viewer.visibleBusinessIds).toEqual(['b-2'])
    expect(viewer.visibleDomains).toEqual(['projects'])
    expect(viewer.isPlatform).toBe(false)
    expect(viewer.ownedBusinessIds).toEqual([])
  })

  it('expands a tenant-wide OWNER membership only within that tenant', async () => {
    const viewer = await resolveViewer({
      db: fakeDb({
        people: [{ id: 'p-owner', code: 'PER-OWNER-1', displayName: 'Owner' }],
        memberships: [{ personId: 'p-owner', tenantId: 't-1', businessId: null, role: 'OWNER' }],
      }),
      principalId: 'p-owner',
    })

    expect(viewer.role).toBe('OWNER')
    expect(viewer.visibleBusinessIds).toEqual(['b-1', 'b-2'])
    // ownedBusinessIds mirrors the same tenant-wide expansion: every Business in
    // that tenant, and none outside it (b-3 belongs to t-2).
    expect(viewer.ownedBusinessIds).toEqual(['b-1', 'b-2'])
    expect(viewer.ownedBusinessIds).not.toContain('b-3')
  })

  it('SECURITY REGRESSION: a principal who is OWNER of one Business and merely MEMBER of another does not gain ownership of the second', async () => {
    // This is the exact hole: role is a global 'OWNER'|'MEMBER' label, so without
    // ownedBusinessIds a downstream `role === 'OWNER'` check plus a
    // `visibleBusinessIds` check would wrongly authorize writes to Business B.
    const viewer = await resolveViewer({
      db: fakeDb({
        people: [{ id: 'p-mixed', code: 'PER-MIXED', displayName: 'Mixed' }],
        memberships: [
          { personId: 'p-mixed', tenantId: 't-1', businessId: 'b-1', role: 'OWNER' },
          { personId: 'p-mixed', tenantId: 't-1', businessId: 'b-2', role: 'MEMBER', domainKeysJson: '["projects"]' },
        ],
      }),
      principalId: 'p-mixed',
    })

    // The global label is still (and remains) 'OWNER' — this task does not change that.
    expect(viewer.role).toBe('OWNER')
    // Both businesses are visible...
    expect(viewer.visibleBusinessIds).toEqual(['b-1', 'b-2'])
    // ...but ownership is per-Business: only b-1, never b-2.
    expect(viewer.ownedBusinessIds).toEqual(['b-1'])
    expect(viewer.ownedBusinessIds).not.toContain('b-2')
  })

  it('allows cross-tenant visibility only through an explicit DEV platform grant, and DEV owns nothing', async () => {
    const viewer = await resolveViewer({
      db: fakeDb({ people: [{ id: 'p-dev', code: 'PER-DEV', displayName: 'Developer' }] }),
      principalId: 'p-dev',
      platformGrant: true,
    })

    expect(viewer.role).toBe('DEV')
    expect(viewer.isPlatform).toBe(true)
    expect(viewer.visibleBusinessIds).toEqual(['b-1', 'b-2', 'b-3'])
    expect(viewer.visibleDomains).toEqual(VIEWER_DOMAINS)
    // A platform DEV grant is not derived from Membership and is not per-Business
    // OWNER authority — it must not confer ownership of any Business.
    expect(viewer.ownedBusinessIds).toEqual([])
  })

  it('uses the seeded local owner as OWNER-of-all only for the explicit development fallback', async () => {
    const viewer = await resolveViewer({
      db: fakeDb({ people: [{ id: 'p-local', code: 'PER-OWNER', displayName: 'Local Owner' }] }),
      allowDevelopmentFallback: true,
    })

    expect(viewer.principal.id).toBe('p-local')
    expect(viewer.role).toBe('OWNER')
    expect(viewer.visibleBusinessIds).toEqual(['b-1', 'b-2', 'b-3'])
    // The local development owner exercises every shell path, so it owns every
    // seeded Business too — every existing local demo / e2e edit path depends on this.
    expect(viewer.ownedBusinessIds).toEqual(['b-1', 'b-2', 'b-3'])
  })

  it('refuses to invent a production principal', async () => {
    await expect(resolveViewer({ db: fakeDb(), allowDevelopmentFallback: false })).rejects.toThrow('Viewer principal is required')
  })

  it('ownedBusinessIds is always an array, never undefined, across every branch', async () => {
    const memberViewer = await resolveViewer({
      db: fakeDb({
        people: [{ id: 'p-member2', code: 'PER-MEMBER-2', displayName: 'Member' }],
        memberships: [{ personId: 'p-member2', tenantId: 't-1', businessId: 'b-1', role: 'MEMBER', domainKeysJson: '[]' }],
      }),
      principalId: 'p-member2',
    })
    expect(Array.isArray(memberViewer.ownedBusinessIds)).toBe(true)

    const devViewer = await resolveViewer({
      db: fakeDb({ people: [{ id: 'p-dev2', code: 'PER-DEV-2', displayName: 'Dev' }] }),
      principalId: 'p-dev2',
      platformGrant: true,
    })
    expect(Array.isArray(devViewer.ownedBusinessIds)).toBe(true)

    const localViewer = await resolveViewer({
      db: fakeDb({ people: [{ id: 'p-local2', code: 'PER-OWNER', displayName: 'Local Owner' }] }),
      allowDevelopmentFallback: true,
    })
    expect(Array.isArray(localViewer.ownedBusinessIds)).toBe(true)
  })
})
