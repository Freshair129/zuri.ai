import { describe, expect, it, vi } from 'vitest'
import { listUserPermissions, updateUserPermissions } from '@/modules/identity/profile-permission-service'

const owner = async () => ({ role: 'OWNER', principal: { id: 'owner-a' }, visibleBusinessIds: ['business-a'] })

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
})
