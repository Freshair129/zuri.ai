import { describe, expect, it, vi } from 'vitest'
import { listUserPermissions, updateUserPermissions } from '@/modules/identity/profile-permission-service'
import { makeViewer, ownsElsewhere } from '../factories/viewer'

// Repaid from docs/.viewer-fixture-baseline.json on 2026-08-17: these viewers
// now come from the factory, so they carry every field resolveViewer emits and
// obey its invariants. The hand-built versions are what let three authorization
// holes ship green (.brain/rca/2026-08-16-global-role-is-not-per-business-authority.md).
const owner = async () => makeViewer({
  principal: { id: 'owner-a', code: 'PER-OWNER-A', displayName: 'Owner A' },
  visibleBusinessIds: ['business-a'],
  ownedBusinessIds: ['business-a'],
})

describe('profile and permission service', () => {
  it('refuses the owner-only user list to a MEMBER', async () => {
    await expect(listUserPermissions({ db: {}, resolve: async () => makeViewer() })).rejects.toMatchObject({ status: 403 })
  })

  it('writes Membership role and domain allow-list with an audit event', async () => {
    const db = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({ id: 'membership-a', businessId: 'business-a' }),
        update: vi.fn().mockResolvedValue({ id: 'membership-a', role: 'MEMBER', domainKeysJson: '["projects"]' }),
      },
      auditEvent: { create: vi.fn().mockResolvedValue({}) },
    }
    await updateUserPermissions({ membershipId: 'membership-a', role: 'MEMBER', domainKeys: ['projects'] }, { db, resolve: owner })
    expect(db.membership.update).toHaveBeenCalledWith(expect.objectContaining({ data: { role: 'MEMBER', domainKeysJson: '["projects"]' } }))
    expect(db.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'PERMISSIONS_UPDATED' }) }))
  })

  // T3e FIX 2 — the proven escalation chain: attacker is OWNER of Business A
  // (global role 'OWNER') and merely MEMBER of Business B. Business B is
  // legitimately in visibleBusinessIds (the MEMBER Membership populates it)
  // but must NOT be in ownedBusinessIds. The old gate — global role check +
  // visibleBusinessIds.includes(businessId) — passed this write and let the
  // attacker self-promote to OWNER of Business B (proven live against the
  // database). This must now be refused.
  it('refuses FR-038 self-promotion when the target Membership Business is visible but not owned', async () => {
    // The factory's name for this shape: global label OWNER, B visible via a
    // MEMBER Membership, B not owned.
    const attacker = async () => ownsElsewhere({
      owns: 'business-a',
      sees: 'business-b',
      principal: { id: 'attacker', code: 'PER-ATTACKER', displayName: 'Attacker' },
    })
    const db = {
      membership: {
        findUnique: vi.fn().mockResolvedValue({ id: 'membership-b', businessId: 'business-b' }),
        update: vi.fn(),
      },
      auditEvent: { create: vi.fn() },
    }
    await expect(
      updateUserPermissions({ membershipId: 'membership-b', role: 'OWNER', domainKeys: [] }, { db, resolve: attacker })
    ).rejects.toMatchObject({ status: 404 })
    expect(db.membership.update).not.toHaveBeenCalled()
    expect(db.auditEvent.create).not.toHaveBeenCalled()
  })
})
