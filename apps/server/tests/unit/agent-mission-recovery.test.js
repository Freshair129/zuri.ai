import { describe, expect, it } from 'vitest'
import { validateAgentMissionEvidenceRecovery } from '@/modules/project-manager/application/backup-service'

const scope = Object.freeze({
  tenantId: 'tenant-1', businessId: 'business-1', workspaceId: 'workspace-1',
  projectId: 'project-1', workstreamId: 'workstream-1',
})
const source = Object.freeze({
  draftId: 'draft-1', missionId: 'mission-1', revision: 1, schemaVersion: 'agent-mission-draft.v1',
  sourceAgentRef: 'zuri-line-agent', actorPersonId: 'person-1', sourceTurnId: 'turn-1',
  executionId: 'execution-1', sourceEventId: 'event-1', sourceTraceEventId: 'trace-1',
  digest: 'a'.repeat(64),
})

function fixture({ event = {}, draft = {}, status = 'ACTIVE' } = {}) {
  const row = {
    id: source.draftId, schemaVersion: source.schemaVersion, sourceAgentRef: source.sourceAgentRef,
    missionId: source.missionId, revision: source.revision, ...scope,
    actorPersonId: source.actorPersonId, sourceTurnId: source.sourceTurnId, executionId: source.executionId,
    sourceEventId: source.sourceEventId, sourceTraceEventId: source.sourceTraceEventId,
    digest: source.digest, snapshotJson: JSON.stringify({ title: 'Mission title', summary: 'Mission summary' }),
    status, createdAt: '2026-10-29T10:00:00.000Z', revokedAt: null, erasedAt: null,
    version: 1, ...draft,
  }
  const eventPayload = {
    schemaVersion: 'agent-mission-draft-event.v1', eventType: 'MISSION_DRAFT_CREATED',
    draftId: row.id, missionId: row.missionId, revision: row.revision,
    sourceAgentRef: row.sourceAgentRef, actorPersonId: row.actorPersonId,
    sourceTurnId: row.sourceTurnId, executionId: row.executionId,
    sourceTraceEventId: row.sourceTraceEventId, digest: row.digest,
    scope: { tenantId: row.tenantId, businessId: row.businessId, workspaceId: row.workspaceId,
      projectId: row.projectId, workstreamId: row.workstreamId },
    ...event.payload,
  }
  const auditEvent = status === 'ERASED'
    ? (event.noTombstone ? null : {
        id: source.sourceEventId, entityType: 'AGENT_MISSION_DRAFT', entityId: source.missionId,
        action: 'MISSION_DRAFT_CREATED', actorType: 'SYSTEM', actorId: null,
        requestId: null, sessionId: null, reason: 'PERSON_ERASED', beforeJson: null, afterJson: null,
        tenantId: scope.tenantId, businessId: scope.businessId,
        payloadJson: JSON.stringify(event.tombstonePayload ?? {
          eventType: 'MISSION_DRAFT_CREATED', missionId: source.missionId, scope: { ...scope },
        }),
        ...event.columns,
      })
    : event.missing ? null : {
        id: row.sourceEventId, entityType: event.entityType ?? 'AGENT_MISSION_DRAFT', entityId: row.missionId,
        action: event.action ?? 'MISSION_DRAFT_CREATED', requestId: row.sourceTurnId,
        tenantId: row.tenantId, businessId: row.businessId,
        actorType: event.actorType ?? 'LINE_USER', actorId: row.actorPersonId,
        payloadJson: JSON.stringify(eventPayload),
      }
  return {
    agentMissionEvidenceRecovery: {
      schemaVersion: 'agent-mission-evidence-recovery.v2',
      requiredTables: ['agentMissionDraft', 'agentMissionEvidence'],
    },
    tables: {
      agentMissionDraft: [row], agentMissionEvidence: [],
      lineConversationJob: [{ id: row.sourceTurnId, tenantId: row.tenantId, businessId: row.businessId,
        executionId: row.executionId, errorCode: null }],
      auditEvent: auditEvent ? [auditEvent] : [],
      agentTraceEvent: [{ id: row.sourceTraceEventId, tenantId: row.tenantId, businessId: row.businessId,
        turnId: row.sourceTurnId, executionId: row.executionId, kind: 'CONTEXT_COMMITTED', payloadJson: '{}' }],
      workstream: [{ id: row.workstreamId, projectId: row.projectId }],
      project: [{ id: row.projectId, businessId: row.businessId, workspaceId: row.workspaceId }],
      workspace: [{ id: row.workspaceId, businessId: row.businessId, tenantId: row.tenantId }],
      business: [{ id: row.businessId, tenantId: row.tenantId }],
      workItem: [],
    },
  }
}

describe('Mission draft recovery source event', () => {
  it('accepts a persisted MISSION_DRAFT_CREATED event bound to the exact draft tuple', () => {
    expect(validateAgentMissionEvidenceRecovery(fixture()).status).toBe('AVAILABLE')
  })

  it('rejects a missing event and a legacy LINE proposal event for a new draft', () => {
    const missing = validateAgentMissionEvidenceRecovery(fixture({ event: { missing: true } }))
    expect(missing.errors.join(' ')).toContain('no matching MISSION_DRAFT_CREATED event')

    const wrongType = validateAgentMissionEvidenceRecovery(fixture({ event: { entityType: 'LINE_WORK_PROPOSAL' } }))
    expect(wrongType.errors.join(' ')).toContain('no matching MISSION_DRAFT_CREATED event')
  })

  it.each([
    ['scope', { scope: { ...scope, projectId: 'other-project' } }],
    ['digest', { digest: 'b'.repeat(64) }],
    ['source tuple', { executionId: 'other-execution' }],
    ['unexpected payload field', { missionText: 'must stay in the draft snapshot' }],
  ])('rejects an event payload with mismatched %s', (_label, mismatch) => {
    const report = validateAgentMissionEvidenceRecovery(fixture({ event: { payload: mismatch } }))
    expect(report.errors.join(' ')).toContain('no matching MISSION_DRAFT_CREATED event')
  })

  it('accepts an erased draft after source references and snapshot have been tombstoned', () => {
    const erased = fixture({ status: 'ERASED', draft: {
      sourceAgentRef: null, missionId: null, sourceTurnId: null, executionId: null,
      sourceEventId: null, sourceTraceEventId: null, digest: null, actorPersonId: null,
      snapshotJson: '{}', erasedAt: '2026-10-29T11:00:00.000Z',
    } })
    erased.tables.lineConversationJob = []
    erased.tables.agentTraceEvent = []
    expect(validateAgentMissionEvidenceRecovery(erased).status).toBe('AVAILABLE')
  })

  it('rejects erasure audit rows that retain actor, turn, digest, or mission content', () => {
    const retainedActor = fixture({ status: 'ERASED', event: { columns: { actorId: source.actorPersonId } }, draft: {
      sourceAgentRef: null, missionId: null, sourceTurnId: null, executionId: null,
      sourceEventId: null, sourceTraceEventId: null, digest: null, actorPersonId: null,
      snapshotJson: '{}', erasedAt: '2026-10-29T11:00:00.000Z',
    } })
    retainedActor.tables.lineConversationJob = []
    retainedActor.tables.agentTraceEvent = []
    expect(validateAgentMissionEvidenceRecovery(retainedActor).errors.join(' ')).toContain('minimal erasure tombstone')

    const retainedPayload = fixture({ status: 'ERASED', event: { tombstonePayload: {
      eventType: 'MISSION_DRAFT_CREATED', missionId: source.missionId, scope: { ...scope }, summary: 'private content',
    } }, draft: {
      sourceAgentRef: null, missionId: null, sourceTurnId: null, executionId: null,
      sourceEventId: null, sourceTraceEventId: null, digest: null, actorPersonId: null,
      snapshotJson: '{}', erasedAt: '2026-10-29T11:00:00.000Z',
    } })
    retainedPayload.tables.lineConversationJob = []
    retainedPayload.tables.agentTraceEvent = []
    expect(validateAgentMissionEvidenceRecovery(retainedPayload).errors.join(' ')).toContain('minimal erasure tombstone')

    const retainedAuditContent = fixture({ status: 'ERASED', event: { columns: { beforeJson: '{"summary":"private"}' } }, draft: {
      sourceAgentRef: null, missionId: null, sourceTurnId: null, executionId: null,
      sourceEventId: null, sourceTraceEventId: null, digest: null, actorPersonId: null,
      snapshotJson: '{}', erasedAt: '2026-10-29T11:00:00.000Z',
    } })
    retainedAuditContent.tables.lineConversationJob = []
    retainedAuditContent.tables.agentTraceEvent = []
    expect(validateAgentMissionEvidenceRecovery(retainedAuditContent).errors.join(' ')).toContain('minimal erasure tombstone')
  })

  it('keeps legacy LINE-confirmed evidence bound to LINE_WORK_PROPOSAL events', () => {
    const snapshot = fixture()
    snapshot.tables.lineConversationJob.push(
      { id: 'legacy-turn', tenantId: scope.tenantId, businessId: scope.businessId,
        executionId: 'legacy-execution', errorCode: null },
      { id: 'legacy-confirmation', tenantId: scope.tenantId, businessId: scope.businessId,
        executionId: 'confirmation-execution', inboundMessageId: 'confirmation-message', errorCode: null },
    )
    snapshot.tables.agentTraceEvent.push({ id: 'legacy-trace', tenantId: scope.tenantId,
      businessId: scope.businessId, turnId: 'legacy-turn', executionId: 'legacy-execution',
      kind: 'CONTEXT_COMMITTED', payloadJson: '{}' })
    snapshot.tables.auditEvent.push({ id: 'legacy-proposal', entityType: 'LINE_WORK_PROPOSAL',
      entityId: 'work-item-1', requestId: 'legacy-turn', tenantId: scope.tenantId,
      businessId: scope.businessId, actorId: source.actorPersonId })
    snapshot.tables.workItem.push({ id: 'work-item-1', workstreamId: scope.workstreamId, deletedAt: null })
    snapshot.tables.agentMissionEvidence.push({
      id: 'legacy-evidence', schemaVersion: 'agent-mission-evidence.v1', draftId: source.draftId,
      sourceAgentRef: source.sourceAgentRef, missionId: source.missionId, ...scope,
      workItemId: 'work-item-1', workItemVersion: 1, origin: 'AGENT_DRAFT_HUMAN_CONFIRMED',
      actorId: source.actorPersonId, sourceTurnId: 'legacy-turn', executionId: 'legacy-execution',
      sourceEventId: 'legacy-proposal', sourceTraceEventId: 'legacy-trace', sourceRevision: 1,
      sourceDigest: source.digest, missionSnapshotJson: '{}', missionSnapshotDigest: 'b'.repeat(64),
      idempotencyKey: 'legacy-key', confirmationKind: 'LINE_JOB', confirmationJobId: 'legacy-confirmation',
      confirmationInboundMessageId: 'confirmation-message', confirmationActorId: source.actorPersonId,
      confirmationIdentityVersion: 1, confirmationExecutionId: 'confirmation-execution',
      status: 'ACTIVE', createdAt: '2026-10-29T10:00:00.000Z',
    })
    expect(validateAgentMissionEvidenceRecovery(snapshot).status).toBe('AVAILABLE')
  })
})
