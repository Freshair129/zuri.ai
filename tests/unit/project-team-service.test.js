import { describe, expect, it, vi } from 'vitest'
import { addProjectTeamMember, membershipScopeForWorkspace } from '@/modules/project-manager/application/project-team-service'
import { makeViewer } from '../factories/viewer'

// Every call now carries a viewer that owns `business-a`. Before 2026-08-17
// these calls passed no viewer at all and succeeded, which is exactly what the
// route in front of them let an anonymous request do — see
// tests/unit/fr036-team-authorization.test.js for the escalation itself.
const owner = makeViewer({ visibleBusinessIds: ['business-a'], ownedBusinessIds: ['business-a'] })

describe('project team service', () => {
  it('includes exact-business and tenant-wide memberships, never another business', () => {
    expect(membershipScopeForWorkspace({ tenantId: 'tenant-a', businessId: 'business-a' })).toEqual({
      tenantId: 'tenant-a',
      OR: [{ businessId: 'business-a' }, { businessId: null }],
    })
  })

  it('refuses Group project mutation because its membership would be tenant-wide', async () => {
    const db = { project: { findUnique: vi.fn().mockResolvedValue({ deletedAt: null, workspace: { tenantId: 'tenant-a', businessId: null } }) } }
    await expect(addProjectTeamMember('project-a', { personId: 'person-a' }, { db, viewer: owner })).rejects.toThrow('read-only')
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
    await addProjectTeamMember('project-a', { personId: 'person-a', role: 'MEMBER' }, { db, viewer: owner })
    expect(db.membership.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ tenantId: 'tenant-a', businessId: 'business-a', role: 'MEMBER' }),
    }))
    expect(auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: 'TEAM_MEMBER_ADDED' }) }))
  })
})
