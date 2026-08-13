import { describe, expect, it, vi } from 'vitest'
import { addProjectTeamMember, membershipScopeForWorkspace } from '@/modules/project-manager/application/project-team-service'

describe('project team service', () => {
  it('includes exact-business and tenant-wide memberships, never another business', () => {
    expect(membershipScopeForWorkspace({ tenantId: 'tenant-a', businessId: 'business-a' })).toEqual({
      tenantId: 'tenant-a',
      OR: [{ businessId: 'business-a' }, { businessId: null }],
    })
  })

  it('refuses Group project mutation because its membership would be tenant-wide', async () => {
    const db = { project: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, workspace: { tenantId: 'tenant-a', businessId: null } }) } }
    await expect(addProjectTeamMember('project-a', { personId: 'person-a' }, { db })).rejects.toThrow('read-only')
  })

  it('adds a business-scoped membership and records an audit event', async () => {
    const auditEvent = { create: vi.fn().mockResolvedValue({}) }
    const db = {
      project: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, workspace: { id: 'workspace-a', tenantId: 'tenant-a', businessId: 'business-a' } }) },
      person: { findUnique: vi.fn().mockResolvedValue({ id: 'person-a' }) },
      membership: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'membership-a', person: { id: 'person-a', displayName: 'A' } }),
      },
      auditEvent,
    }
    await addProjectTeamMember('project-a', { personId: 'person-a', role: 'MEMBER' }, { db })
    expect(db.membership.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: 'tenant-a', businessId: 'business-a', role: 'MEMBER' }),
    }))
    expect(auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'TEAM_MEMBER_ADDED' }) }))
  })
})
