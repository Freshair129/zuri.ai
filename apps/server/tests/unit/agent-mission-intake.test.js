import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createAgentMissionIntakeService, agentMissionRequestHash } from '@/modules/project-manager/application/agent-mission-intake'

const viewer = { principal: { id: 'person-human-submit' } }
const scope = {
  projectId: 'project-1',
  workstreamId: 'workstream-1',
  businessId: 'business-1',
  tenantId: 'tenant-1',
}

function setup(overrides = {}) {
  const tx = {
    membership: { findFirst: vi.fn().mockResolvedValue({ id: 'membership-1' }) },
    workItem: { findFirst: vi.fn() },
  }
  const db = { marker: 'root-db' }
  const authorizeWorkstream = vi.fn().mockResolvedValue({ id: scope.workstreamId })
  const resolveScope = vi.fn().mockResolvedValue(scope)
  const transaction = vi.fn(async (_db, callback) => callback(tx))
  const workItemWriter = vi.fn().mockResolvedValue({ id: 'work-item-1', status: 'PLANNED' })
  const provenancePort = {
    verify: vi.fn().mockResolvedValue({ verified: true, opaqueReceipt: 'verified-source' }),
    findByIdempotencyKey: vi.fn().mockResolvedValue(null),
    record: vi.fn().mockResolvedValue({ id: 'provenance-1' }),
  }
  const service = createAgentMissionIntakeService({
    db,
    provenancePort,
    workItemWriter,
    authorizeWorkstream,
    resolveScope,
    transaction,
    ...overrides,
  })
  const input = {
    idempotencyKey: 'mission-1-v1',
    workstreamId: scope.workstreamId,
    title: 'Review replenishment exceptions',
    subtype: 'CHECKLIST_ITEM',
    sourceProof: { opaque: 'source-reference' },
  }
  return { service, input, db, tx, authorizeWorkstream, resolveScope, transaction, workItemWriter, provenancePort }
}

describe('PM Agent mission intake boundary', () => {
  it('rejects caller-supplied assignee, role, approval tier or status fields', async () => {
    for (const extra of [
      { assigneeRef: 'agent:OPERATIONS' },
      { agentRoleId: 'OPERATIONS' },
      { approvalTier: 'L4' },
      { status: 'IN_PROGRESS' },
      { sourceProof: null },
    ]) {
      const f = setup()
      await expect(f.service.submit({ ...f.input, ...extra }, { viewer }))
        .rejects.toMatchObject({ code: 'MISSION_INPUT_INVALID', status: 400 })
      expect(f.authorizeWorkstream).not.toHaveBeenCalled()
      expect(f.workItemWriter).not.toHaveBeenCalled()
    }
  })

  it('fails closed when the verified provenance adapter is unavailable', async () => {
    const f = setup({ provenancePort: null })
    await expect(f.service.submit(f.input, { viewer }))
      .rejects.toMatchObject({ code: 'MISSION_PROVENANCE_UNAVAILABLE', status: 503 })
    expect(f.authorizeWorkstream).toHaveBeenCalledOnce()
    expect(f.workItemWriter).not.toHaveBeenCalled()
  })

  it('authorizes the target before asking the provenance port to inspect it', async () => {
    const f = setup({ authorizeWorkstream: vi.fn().mockRejectedValue(Object.assign(new Error('not found'), { status: 404 })) })
    await expect(f.service.submit(f.input, { viewer })).rejects.toMatchObject({ status: 404 })
    expect(f.provenancePort.verify).not.toHaveBeenCalled()
    expect(f.workItemWriter).not.toHaveBeenCalled()
  })

  it('rejects an unverified source before opening a write transaction', async () => {
    const f = setup({
      provenancePort: {
        ...setup().provenancePort,
        verify: vi.fn().mockResolvedValue({ verified: false }),
      },
    })
    await expect(f.service.submit(f.input, { viewer }))
      .rejects.toMatchObject({ code: 'MISSION_PROVENANCE_INVALID', status: 403 })
    expect(f.transaction).not.toHaveBeenCalled()
    expect(f.workItemWriter).not.toHaveBeenCalled()
  })

  it('creates exactly one PLANNED WorkItem assigned to the authenticated human and records provenance atomically', async () => {
    const f = setup()
    const result = await f.service.submit(f.input, { viewer })
    expect(result).toMatchObject({ workItem: { id: 'work-item-1', status: 'PLANNED' }, provenance: { id: 'provenance-1' }, replayed: false })
    expect(f.transaction).toHaveBeenCalledWith(f.db, expect.any(Function))
    expect(f.workItemWriter).toHaveBeenCalledOnce()
    expect(f.workItemWriter).toHaveBeenCalledWith(expect.objectContaining({
      status: 'PLANNED',
      assigneeRef: viewer.principal.id,
      workstreamId: scope.workstreamId,
    }), { viewer, db: f.tx })
    expect(f.provenancePort.record).toHaveBeenCalledWith(expect.objectContaining({
      scope,
      idempotencyKey: f.input.idempotencyKey,
      requestHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      workItemId: 'work-item-1',
      submittedByPersonId: viewer.principal.id,
      verifiedSource: { verified: true, opaqueReceipt: 'verified-source' },
    }), { db: f.tx })
  })

  it('replays an exact same-key binding without creating another WorkItem', async () => {
    const f = setup()
    f.provenancePort.findByIdempotencyKey.mockResolvedValue({
      requestHash: agentMissionRequestHash({
        scope,
        item: { containerId: null, title: f.input.title, subtype: f.input.subtype, weight: 1, startAt: null, targetAt: null },
        sourceProof: f.input.sourceProof,
        submittedByPersonId: viewer.principal.id,
      }),
      workItemId: 'work-item-1',
    })
    f.tx.workItem.findFirst.mockResolvedValue({ id: 'work-item-1', status: 'PLANNED' })
    const result = await f.service.submit(f.input, { viewer })
    expect(result).toMatchObject({ workItem: { id: 'work-item-1' }, replayed: true })
    expect(f.workItemWriter).not.toHaveBeenCalled()
    expect(f.provenancePort.record).not.toHaveBeenCalled()
  })

  it('refuses same-key reuse when the content or accountable human differs', async () => {
    const f = setup()
    f.provenancePort.findByIdempotencyKey.mockResolvedValue({ requestHash: 'different-hash', workItemId: 'work-item-1' })
    await expect(f.service.submit(f.input, { viewer })).rejects.toMatchObject({
      code: 'MISSION_IDEMPOTENCY_CONFLICT', status: 409,
    })
    expect(f.workItemWriter).not.toHaveBeenCalled()
    expect(f.provenancePort.record).not.toHaveBeenCalled()
  })

  it('fails if the authorized Project/Workstream scope changes before commit', async () => {
    const f = setup()
    f.resolveScope.mockResolvedValueOnce(scope).mockResolvedValueOnce({ ...scope, projectId: 'project-2' })
    await expect(f.service.submit(f.input, { viewer })).rejects.toMatchObject({
      code: 'MISSION_SCOPE_CHANGED', status: 409,
    })
    expect(f.workItemWriter).not.toHaveBeenCalled()
  })

  it('rejects a submitter without an active, unexpired Business membership', async () => {
    const f = setup()
    f.tx.membership.findFirst.mockResolvedValue(null)
    await expect(f.service.submit(f.input, { viewer })).rejects.toMatchObject({
      code: 'MISSION_SUBMITTER_NOT_IN_BUSINESS', status: 403,
    })
    expect(f.workItemWriter).not.toHaveBeenCalled()
  })
})
