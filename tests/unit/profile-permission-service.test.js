import { describe, expect, it, vi } from 'vitest'
import { listUserPermissions, updateUserPermissions } from '@/modules/identity/profile-permission-service'

// `owner` reflects what resolveViewer() actually produces for a principal who
// is OWNER of business-a: ownedBusinessIds is always present (T3e) and, for a
// genuine single-Business OWNER, equals visibleBusinessIds. Backfilled here —
// without it every write would now fail closed on a fixture resolveViewer()
// could never itself return, which is not a real refusal (see T3e report).
const owner = async () => ({
  role: 'OWNER',
  principal: { id: 'owner-a' },
  visibleBusinessIds: ['business-a'],
  ownedBusinessIds: ['business-a'],
})

describe('profile and permission service', () => {
  it('refuses the owner-only user list to a MEMBER', async () => {
    await expect(listUserPermissions({ db: {}, resolve: async () => ({ role: 'MEMBER' }) })).rejects.toMatchObject({ status: 403 })
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
    const attacker = async () => ({
      role: 'OWNER', // global label: OWNER of Business A, elsewhere
      principal: { id: 'attacker' },
      visibleBusinessIds: ['business-a', 'business-b'], // B visible via MEMBER Membership
      ownedBusinessIds: ['business-a'], // B is NOT owned
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
