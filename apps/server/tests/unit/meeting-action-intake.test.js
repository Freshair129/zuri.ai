import { describe, expect, it, vi } from 'vitest'
import { buildMeetingActionPlan, resolveMeetingIdentity } from '@/modules/project-manager/import/meeting-action-intake'
import { zPlanEnvelope, validatePlanSemantics } from '@/modules/project-manager/import/plan-schema'

const intake = {
  schemaVersion: 'meeting-action-intake.v1',
  trace: { correlationId: 'meeting-correlation-1', idempotencyKey: 'meeting-idempotency-1' },
  source: { app: 'FUNG', userId: 'fung-user-1' },
  scope: { workspaceCode: 'WS-BIZ-1' },
  meeting: { meetingId: 'meeting-1', recordingId: 'recording-1', transcriptRevision: 'rev-2' },
  actions: [{
    actionId: 'action-1',
    title: 'ส่งใบเสนอราคา',
    description: 'รวบรวมราคาและส่งให้ลูกค้า',
    tags: ['follow-up'],
    assignee: { sourceUserId: 'fung-user-2', displayName: 'Member' },
    targetAt: '2026-09-30',
    evidence: [{ type: 'TRANSCRIPT', ref: 'segment-12' }],
  }],
}

const target = {
  workspace: { id: 'ws-id', code: 'WS-BIZ-1' },
  business: { id: 'business-id', code: 'BIZ-1', name: 'Business One', tenantId: 'tenant-id' },
  project: null,
  workstream: null,
}

describe('meeting action adapter', () => {
  it('converts a candidate into the shared PlanEnvelope with canonical assignment', () => {
    const plan = buildMeetingActionPlan({
      intake,
      target,
      assignments: [{ status: 'RESOLVED', personId: 'person-member-1' }],
      generatedAt: '2026-09-22T10:00:00.000Z',
    })

    const item = plan.workstreams[0].items[0]
    expect(plan.schemaVersion).toBe('1.2')
    expect(plan.trace).toEqual(intake.trace)
    expect(zPlanEnvelope.safeParse(plan).success).toBe(true)
    expect(validatePlanSemantics(plan)).toEqual([])
    expect(item.assigneeRef).toBe('person-member-1')
    expect(item.targetAt).toBe('2026-09-30')
    expect(item.externalRefs).toEqual([{ system: 'MEETING_ACTION', id: 'BIZ-1:FUNG:meeting-1:action-1' }])
    expect(item.metadata).toMatchObject({
      intakeKind: 'MEETING_ACTION',
      meetingId: 'meeting-1',
      sourceApp: 'FUNG',
      tags: ['follow-up'],
      assignment: { resolution: 'RESOLVED', proposedSourceUserId: 'fung-user-2' },
    })
  })

  it('leaves unresolved assignment proposals for PM review', () => {
    const plan = buildMeetingActionPlan({ intake, target, assignments: [{ status: 'UNBOUND' }] })
    const item = plan.workstreams[0].items[0]
    expect(item).not.toHaveProperty('assigneeRef')
    expect(item.metadata.assignment.resolution).toBe('UNBOUND')
  })
})

describe('meeting identity resolution', () => {
  it('requires a verified active external identity and an active Business membership', async () => {
    const db = {
      externalIdentity: { findUnique: vi.fn().mockResolvedValue({ id: 'ext-1', personId: 'person-1', verifiedAt: new Date(), linkedAt: new Date(), revokedAt: null }) },
      person: { findUnique: vi.fn().mockResolvedValue({ id: 'person-1', accessDisabledAt: null }) },
      membership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-1', businessId: 'business-id', status: 'ACTIVE' }) },
    }
    await expect(resolveMeetingIdentity({ tenantId: 'tenant-id', businessId: 'business-id', sourceApp: 'LALIN_AI', sourceUserId: 'lalin-user-1', db })).resolves.toMatchObject({ status: 'RESOLVED', personId: 'person-1' })
    expect(db.externalIdentity.findUnique).toHaveBeenCalledWith({
      where: { tenantId_provider_providerSubject: { tenantId: 'tenant-id', provider: 'LALIN_AI', providerSubject: 'lalin-user-1' } },
    })
  })

  it('does not resolve a pending or revoked binding', async () => {
    const db = {
      externalIdentity: { findUnique: vi.fn().mockResolvedValue({ personId: 'person-1', verifiedAt: null, linkedAt: null, revokedAt: null }) },
      person: { findUnique: vi.fn() },
      membership: { findFirst: vi.fn() },
    }
    await expect(resolveMeetingIdentity({ tenantId: 'tenant-id', businessId: 'business-id', sourceApp: 'FUNG', sourceUserId: 'fung-user-1', db })).resolves.toEqual({ status: 'UNBOUND' })
    expect(db.person.findUnique).not.toHaveBeenCalled()
  })
})
