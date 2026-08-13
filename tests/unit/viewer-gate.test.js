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
  })

  it('allows cross-tenant visibility only through an explicit DEV platform grant', async () => {
    const viewer = await resolveViewer({
      db: fakeDb({ people: [{ id: 'p-dev', code: 'PER-DEV', displayName: 'Developer' }] }),
      principalId: 'p-dev',
      platformGrant: true,
    })

    expect(viewer.role).toBe('DEV')
    expect(viewer.isPlatform).toBe(true)
    expect(viewer.visibleBusinessIds).toEqual(['b-1', 'b-2', 'b-3'])
    expect(viewer.visibleDomains).toEqual(VIEWER_DOMAINS)
  })

  it('uses the seeded local owner as OWNER-of-all only for the explicit development fallback', async () => {
    const viewer = await resolveViewer({
      db: fakeDb({ people: [{ id: 'p-local', code: 'PER-OWNER', displayName: 'Local Owner' }] }),
      allowDevelopmentFallback: true,
    })

    expect(viewer.principal.id).toBe('p-local')
    expect(viewer.role).toBe('OWNER')
    expect(viewer.visibleBusinessIds).toEqual(['b-1', 'b-2', 'b-3'])
  })

  it('refuses to invent a production principal', async () => {
    await expect(resolveViewer({ db: fakeDb(), allowDevelopmentFallback: false })).rejects.toThrow('Viewer principal is required')
  })
})
