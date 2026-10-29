import { describe, expect, it, vi } from 'vitest'
import { createAgentMissionIntakeService } from '@/modules/project-manager/application/agent-mission-intake'

const viewer = { principal: { id: 'person-human-submit' } }
const scope = {
  tenantId: 'tenant-1',
  businessId: 'business-1',
  workspaceId: 'workspace-1',
  projectId: 'project-1',
  workstreamId: 'workstream-1',
}
const draft = {
  missionId: 'mission-1',
  sourceAgentRef: 'agent-ref-1',
  revision: 2,
  digest: 'a'.repeat(64),
  scope,
  sourceTurnId: 'turn-1',
  executionId: 'execution-1',
  sourceEventId: 'event-1',
  sourceTraceEventId: 'trace-1',
  title: 'Review replenishment exceptions',
  summary: 'Check the unresolved replenishment exceptions.',
  createdAt: new Date('2026-10-29T00:00:00Z'),
}
const input = {
  missionId: draft.missionId,
  expectedRevision: draft.revision,
  expectedDigest: draft.digest,
  workstreamId: scope.workstreamId,
  optionalContainerId: null,
}

function priorEvidence(overrides = {}) {
  return {
    evidenceId: 'evidence-1',
    sourceAgentRef: draft.sourceAgentRef,
    missionId: draft.missionId,
    origin: 'AGENT_DRAFT_HUMAN_CONFIRMED',
    confirmationKind: 'PM_SUBMISSION',
    status: 'ACTIVE',
    submittedByPersonId: viewer.principal.id,
    sourceRevision: draft.revision,
    sourceDigest: draft.digest,
    workItemId: 'work-item-1',
    workItemVersion: 1,
    ...scope,
    ...overrides,
  }
}

function setup(overrides = {}) {
  const tx = {
    workItem: { findFirst: vi.fn().mockResolvedValue({ id: 'work-item-1', status: 'PLANNED', version: 1 }) },
    marker: 'transaction-client',
  }
  const db = {
    marker: 'root-db',
    workItem: { findFirst: vi.fn().mockResolvedValue({ id: 'work-item-1', status: 'PLANNED', version: 1 }) },
  }
  const authorizeWorkstream = vi.fn().mockResolvedValue({ id: scope.workstreamId })
  const resolveScope = vi.fn().mockResolvedValue(scope)
  const transaction = vi.fn(async (_db, callback) => callback(tx))
  const workItemWriter = vi.fn().mockResolvedValue({ id: 'work-item-1', status: 'PLANNED', version: 1 })
  const findExistingSubmission = vi.fn().mockResolvedValue(null)
  const auditWriter = vi.fn().mockResolvedValue({ id: 'audit-1' })
  const agentMissionPort = {
    readMissionDraft: vi.fn().mockResolvedValue(draft),
    recordPmSubmissionInTransaction: vi.fn().mockResolvedValue({
      evidenceId: 'evidence-1',
      sourceMissionId: draft.missionId,
      sourceRevision: draft.revision,
      sourceDigest: draft.digest,
      workItemId: 'work-item-1',
      workItemVersion: 1,
    }),
  }
  const service = createAgentMissionIntakeService({
    db,
    agentMissionPort,
    workItemWriter,
    authorizeWorkstream,
    resolveScope,
    findExistingSubmission,
    transaction,
    auditWriter,
    ...overrides,
  })
  return {
    service, db, tx, authorizeWorkstream, resolveScope, transaction,
    workItemWriter, findExistingSubmission, auditWriter, agentMissionPort,
  }
}

describe('PM Agent mission intake', () => {
  it('accepts only the source identity, revision/digest and PM target fields', async () => {
    for (const extra of [
      { sourceAgentRef: draft.sourceAgentRef },
      { scope },
      { workItemId: 'caller-item' },
      { assigneeRef: 'agent:OPERATIONS' },
      { status: 'IN_PROGRESS' },
      { approvalTier: 'L4' },
      { execution: { runId: 'run-1' } },
      { release: true },
    ]) {
      const f = setup()
      await expect(f.service.submit({ ...input, ...extra }, { viewer }))
        .rejects.toMatchObject({ code: 'MISSION_INPUT_INVALID', status: 400 })
      expect(f.authorizeWorkstream).not.toHaveBeenCalled()
      expect(f.workItemWriter).not.toHaveBeenCalled()
    }
  })

  it('fails closed when Agent receipt methods are not wired', async () => {
    const f = setup({ agentMissionPort: null })
    await expect(f.service.submit(input, { viewer }))
      .rejects.toMatchObject({ code: 'MISSION_SOURCE_UNAVAILABLE', status: 503 })
    expect(f.authorizeWorkstream).toHaveBeenCalledOnce()
    expect(f.workItemWriter).not.toHaveBeenCalled()
  })

  it('authorizes PM write scope before asking Agent to read a mission', async () => {
    const f = setup({ authorizeWorkstream: vi.fn().mockRejectedValue(Object.assign(new Error('hidden'), { status: 404 })) })
    await expect(f.service.submit(input, { viewer })).rejects.toMatchObject({ status: 404 })
    expect(f.agentMissionPort.readMissionDraft).not.toHaveBeenCalled()
  })

  it('passes only authenticated requester identity to Agent reader', async () => {
    const f = setup()
    await f.service.submit(input, { viewer })
    expect(f.agentMissionPort.readMissionDraft).toHaveBeenCalledWith({ missionId: draft.missionId, requesterPersonId: viewer.principal.id })
  })

  it('maps fixed Agent refusals without exposing exception text', async () => {
    const f = setup({ agentMissionPort: {
      ...setup().agentMissionPort,
      readMissionDraft: vi.fn().mockRejectedValue(Object.assign(new Error('private source payload'), { code: 'MISSION_FORBIDDEN' })),
    } })
    await expect(f.service.submit(input, { viewer })).rejects.toMatchObject({ code: 'MISSION_FORBIDDEN', status: 403, message: 'MISSION_FORBIDDEN' })
  })

  it('rejects changed source revision, digest, or scope before opening the write transaction', async () => {
    for (const changed of [
      { revision: draft.revision + 1 },
      { digest: 'b'.repeat(64) },
      { scope: { ...scope, businessId: 'other-business' } },
    ]) {
      const f = setup({ agentMissionPort: { ...setup().agentMissionPort, readMissionDraft: vi.fn().mockResolvedValue({ ...draft, ...changed }) } })
      await expect(f.service.submit(input, { viewer })).rejects.toMatchObject({ status: 409 })
      expect(f.transaction).not.toHaveBeenCalled()
      expect(f.workItemWriter).not.toHaveBeenCalled()
    }
  })

  it('accepts the 4096-character evidence summary bound but never projects it onto WorkItem metadata', async () => {
    const exactLimit = setup({ agentMissionPort: {
      ...setup().agentMissionPort,
      readMissionDraft: vi.fn().mockResolvedValue({ ...draft, summary: 's'.repeat(4096) }),
    } })
    await exactLimit.service.submit(input, { viewer })
    expect(exactLimit.workItemWriter).toHaveBeenCalledWith(expect.not.objectContaining({ metadata: expect.anything() }), expect.anything())

    const overLimit = setup({ agentMissionPort: {
      ...setup().agentMissionPort,
      readMissionDraft: vi.fn().mockResolvedValue({ ...draft, summary: 's'.repeat(4097) }),
    } })
    await expect(overLimit.service.submit(input, { viewer })).rejects.toMatchObject({ code: 'MISSION_SOURCE_UNAVAILABLE', status: 503 })
    expect(overLimit.transaction).not.toHaveBeenCalled()
  })

  it('creates one PLANNED unassigned TASK through the canonical writer and records evidence plus bounded audit in the same transaction', async () => {
    const f = setup()
    const result = await f.service.submit(input, { viewer })
    expect(result).toMatchObject({ workItem: { id: 'work-item-1', status: 'PLANNED' }, evidence: { evidenceId: 'evidence-1' }, replayed: false })
    expect(f.workItemWriter).toHaveBeenCalledOnce()
    expect(f.workItemWriter).toHaveBeenCalledWith({
      workstreamId: scope.workstreamId,
      containerId: null,
      subtype: 'TASK',
      title: draft.title,
      status: 'PLANNED',
      assigneeRef: null,
    }, { viewer, db: f.tx })
    expect(f.agentMissionPort.recordPmSubmissionInTransaction).toHaveBeenCalledWith(f.tx, {
      missionId: draft.missionId,
      expectedRevision: draft.revision,
      expectedDigest: draft.digest,
      submittedByPersonId: viewer.principal.id,
      workItemId: 'work-item-1',
    })
    expect(f.auditWriter).toHaveBeenCalledWith(f.tx, expect.objectContaining({
      entityType: 'WORK_ITEM',
      entityId: 'work-item-1',
      action: 'MISSION_SUBMITTED',
      payload: { evidenceId: 'evidence-1', sourceRevision: draft.revision },
      actorId: viewer.principal.id,
    }))
    expect(f.auditWriter.mock.invocationCallOrder[0]).toBeLessThan(f.authorizeWorkstream.mock.invocationCallOrder.at(-1))
  })

  it('returns the already-bound WorkItem on an exact authorized retry without creating another', async () => {
    const f = setup({ findExistingSubmission: vi.fn().mockResolvedValue(priorEvidence()) })
    const result = await f.service.submit(input, { viewer })
    expect(result).toMatchObject({ workItem: { id: 'work-item-1' }, evidence: { evidenceId: 'evidence-1' }, replayed: true })
    expect(f.workItemWriter).not.toHaveBeenCalled()
    expect(f.agentMissionPort.recordPmSubmissionInTransaction).not.toHaveBeenCalled()
    expect(f.tx.workItem.findFirst).toHaveBeenCalledWith({ where: { id: 'work-item-1', workstreamId: scope.workstreamId, deletedAt: null } })
  })

  it('conflicts on revision/digest reuse and refuses inactive or cross-scope evidence', async () => {
    for (const existing of [
      priorEvidence({ sourceRevision: draft.revision - 1 }),
      priorEvidence({ sourceDigest: 'b'.repeat(64) }),
      priorEvidence({ status: 'REVOKED' }),
      priorEvidence({ businessId: 'other-business' }),
    ]) {
      const f = setup({ findExistingSubmission: vi.fn().mockResolvedValue(existing) })
      await expect(f.service.submit(input, { viewer })).rejects.toMatchObject({ status: 409 })
      expect(f.workItemWriter).not.toHaveBeenCalled()
    }
  })

  it('rolls back and resolves a unique-race winner outside the failed transaction', async () => {
    const winner = priorEvidence()
    let calls = 0
    const findExistingSubmission = vi.fn(async () => ++calls === 1 ? null : winner)
    const transaction = vi.fn(async (_db, callback) => {
      await callback({ ...setup().tx, workItem: { findFirst: vi.fn() } })
      const error = new Error('unique constraint detail')
      error.code = 'P2002'
      throw error
    })
    const f = setup({ transaction, findExistingSubmission })
    const result = await f.service.submit(input, { viewer })
    expect(result).toMatchObject({ replayed: true, workItem: { id: 'work-item-1' } })
    expect(findExistingSubmission).toHaveBeenNthCalledWith(1, expect.anything(), draft.sourceAgentRef, draft.missionId)
    expect(findExistingSubmission).toHaveBeenNthCalledWith(2, f.db, draft.sourceAgentRef, draft.missionId)
    expect(f.workItemWriter).toHaveBeenCalledOnce()
  })
})
