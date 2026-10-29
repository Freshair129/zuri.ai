import { beforeEach, describe, expect, it, vi } from 'vitest'

const stream = { id: 'workstream-1' }
const project = { id: 'project-1', workspaceId: 'workspace-1', businessId: 'business-1', deletedAt: null }

vi.mock('@/modules/project-manager/application/pipeline-transaction', () => ({
  withPipelineTransaction: async (db, callback) => callback(db),
}))
vi.mock('@/lib/db', () => ({ default: {} }))
vi.mock('@/modules/identity/channel-identity', () => ({
  findChannelIdentity: vi.fn(async () => ({ id: 'identity-1', personId: 'person-owner', version: 4, linkedAt: new Date('2026-10-01T00:00:00.000Z') })),
  channelIdentityIsVerified: vi.fn(() => true),
}))
vi.mock('@/modules/identity/resolve-viewer', () => ({ resolveViewer: vi.fn(async () => ({
  visibleBusinessIds: ['business-1'], domainsByBusinessId: { 'business-1': ['projects'] },
})) }))
vi.mock('@/modules/identity/viewer-authority', () => ({ ownsBusiness: vi.fn(() => true) }))
vi.mock('@/modules/project-manager/application/project-authorization', () => ({
  assertWorkstreamWritable: vi.fn(async (_viewer, workstreamId) => ({ id: workstreamId, projectId: 'project-1' })),
}))
vi.mock('@/modules/project-manager/application/work-service', () => ({
  createItem: vi.fn(), updateItem: vi.fn(),
}))
vi.mock('@/modules/agent/auth-context', () => ({
  DEFAULT_AGENT_ID: 'zuri-line-agent',
  resolveAgentAuthorization: vi.fn(),
}))

import { createLineProjectWorkTools } from '@/modules/agent/line-project-work-tools'
import { createMissionDraftPort } from '@/modules/agent/mission-draft'
import { canonicalJson, sha256 } from '@/modules/agent/execution-trace'
import { createItem } from '@/modules/project-manager/application/work-service'
import { ownsBusiness } from '@/modules/identity/viewer-authority'

const at = new Date('2026-10-29T12:00:00.000Z')
const claim = Object.freeze({
  executionMode: 'CONVERSATION_RUNTIME', claimantId: 'worker-1', version: 7,
  executionId: 'execution-1', tenantId: 'tenant-1', businessId: 'business-1',
})

function authResult() {
  const authContext = Object.freeze({
    transport: Object.freeze({ signatureVerified: true }),
    actor: Object.freeze({ principalId: 'person-owner', principalType: 'STAFF', identityVerified: true }),
    scope: Object.freeze({ tenantId: 'tenant-1', businessId: 'business-1', workspaceId: 'workspace-1', projectId: 'project-1' }),
    request: Object.freeze({ agentId: 'zuri-line-agent' }),
    authorization: Object.freeze({ decision: Object.freeze({ allowed: true }) }),
  })
  return Object.freeze({ authContext })
}

function testDb({ streamRows = [stream] } = {}) {
  const job = {
    id: 'turn-1', tenantId: 'tenant-1', businessId: 'business-1', accountId: 'account-1',
    executionId: 'execution-1', executionMode: 'CONVERSATION_RUNTIME', version: 7,
    claimantId: 'worker-1', status: 'CLAIMED', audienceKind: 'DIRECT',
    recipientId: 'line-user-1', sourceUserId: 'line-user-1', channelAccountId: 'oa-binding',
    transportEpoch: 2, leaseExpiresAt: new Date(at.getTime() + 60_000), expiresAt: new Date(at.getTime() + 120_000),
    errorCode: null, account: {
      id: 'account-1', tenantId: 'tenant-1', businessId: 'business-1', bindingCode: 'oa-binding',
      serverEnabled: true, transportMode: 'CLOUD', status: 'CONNECTED', transportEpoch: 2,
    },
    inbound: { body: 'make a mission draft', conversation: {
      id: 'conversation-1', channel: 'LINE', tenantId: 'tenant-1', businessId: 'business-1', channelAccountId: 'oa-binding',
    } },
  }
  let storedDraft = null
  const db = {
    job,
    workstream: {
      findMany: vi.fn(async () => streamRows),
    },
    project: {
      async findUnique() { return project },
    },
    lineConversationJob: { findUnique: vi.fn(async () => job) },
    agentTraceEvent: {
      async findFirst() { return {
        id: 'trace-context-1', tenantId: 'tenant-1', businessId: 'business-1',
        turnId: 'turn-1', executionId: 'execution-1',
      } },
    },
    agentMissionDraft: {
      findFirst: vi.fn(async () => storedDraft),
      create: vi.fn(async ({ data }) => { storedDraft = data; return data }),
    },
    workItem: { create: vi.fn() },
  }
  return { db, storedDraft: () => storedDraft }
}

describe('LINE structured Agent Mission draft tool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(ownsBusiness).mockReturnValue(true)
  })

  it('creates only a source draft under the verified OWNER turn and reuses its receipt on retry', async () => {
    const { db, storedDraft } = testDb()
    const authorizationResolver = vi.fn(async () => authResult())
    const tools = createLineProjectWorkTools('turn-1', { db, now: at, expectedClaim: claim, authorizationResolver })
    const tool = tools.find(item => item.name === 'create_mission_draft')
    expect(tool).toBeDefined()
    expect(Object.keys(tool.parameters.properties).sort()).toEqual(['summary', 'title'])
    expect(tool.parameters.additionalProperties).toBe(false)

    const input = { title: 'Prepare a launch plan', summary: 'A bounded mission for human review.' }
    const first = await tool.handler(input)
    const second = await tool.handler(input)
    expect(first.status).toBe('created')
    expect(second).toEqual({ status: 'existing', draft: first.draft })
    expect(first.draft).toMatchObject({
      sourceAgentRef: 'zuri-line-agent', sourceTurnId: 'turn-1', executionId: 'execution-1',
      tenantId: 'tenant-1', businessId: 'business-1', workspaceId: 'workspace-1',
      projectId: 'project-1', workstreamId: 'workstream-1', status: 'ACTIVE', revision: 1,
    })
    expect(db.agentMissionDraft.findFirst).toHaveBeenCalled()
    expect(db.agentMissionDraft.create).toHaveBeenCalledTimes(1)
    expect(authorizationResolver).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 'tenant-1', businessId: 'business-1', lineUserId: 'line-user-1',
      serverScope: expect.objectContaining({ agentId: 'zuri-line-agent', workspaceId: 'workspace-1', projectId: 'project-1' }),
    }))
    expect(db.workItem.create).not.toHaveBeenCalled()
    expect(createItem).not.toHaveBeenCalled()

    const saved = storedDraft()
    const pmDraftRow = {
      ...saved, draftId: saved.id, content: JSON.parse(saved.snapshotJson),
      scope: { tenantId: saved.tenantId, businessId: saved.businessId, workspaceId: saved.workspaceId,
        projectId: saved.projectId, workstreamId: saved.workstreamId },
    }
    const pmSnapshot = {
      workItemId: 'work-item-1', workItemVersion: 1, status: 'PLANNED', subtype: 'TASK',
      assigneeRef: null, scope: pmDraftRow.scope, title: pmDraftRow.content.title, containerId: null,
    }
    let writtenEvidence
    const pmPort = createMissionDraftPort({ repository: {
      async resolveAuthorizedMissionDraft() { return { status: 'unavailable' } },
      forTransaction() { return {
        async resolveMissionDraft() { return { status: 'found', sourceVerified: true, draft: pmDraftRow } },
        async findSubmissionBySource() { return null },
        async resolveEligibleWorkItem() { return { status: 'found', eligible: true, workItem: {
          workItemId: 'work-item-1', workItemVersion: 1, status: 'PLANNED', subtype: 'TASK',
          assigneeRef: null, scope: pmDraftRow.scope, normalizedSnapshot: pmSnapshot,
          snapshotDigest: sha256(canonicalJson(pmSnapshot)),
        } } },
        async insertPmSubmissionEvidence(value) { writtenEvidence = value; return { evidenceId: 'evidence-1' } },
      } },
    } })
    const intake = await pmPort.recordPmSubmissionInTransaction(Object.freeze({ tx: 'PM session transaction' }), {
      missionId: first.draft.missionId, expectedRevision: 1, expectedDigest: first.draft.digest,
      submittedByPersonId: 'person-human-pm', workItemId: 'work-item-1',
    })
    expect(intake).toMatchObject({ evidenceId: 'evidence-1', sourceMissionId: first.draft.missionId })
    expect(writtenEvidence).toMatchObject({
      draftId: saved.id, sourceAgentRef: 'zuri-line-agent', submittedByPersonId: 'person-human-pm',
      origin: 'AGENT_DRAFT_HUMAN_CONFIRMED', confirmationKind: 'PM_SUBMISSION',
    })
    expect(JSON.parse(writtenEvidence.missionSnapshotJson)).toEqual({
      mission: input,
      workItem: { workstreamId: 'workstream-1', subtype: 'TASK', title: input.title, status: 'PLANNED', assigneeRef: null },
    })
    expect(JSON.parse(writtenEvidence.missionSnapshotJson).workItem).not.toHaveProperty('summary')
  })

  it('fails closed when authorized Business scope has zero or multiple active Workstreams', async () => {
    const { db } = testDb({ streamRows: [stream, { id: 'workstream-2' }] })
    const tools = createLineProjectWorkTools('turn-1', {
      db, now: at, expectedClaim: claim, authorizationResolver: async () => authResult(),
    })
    const tool = tools.find(item => item.name === 'create_mission_draft')
    await expect(tool.handler({ title: 'Plan', summary: 'Review' })).rejects.toMatchObject({ code: 'MISSION_SCOPE_INVALID' })
    expect(db.agentMissionDraft.create).not.toHaveBeenCalled()
  })

  it('requires the existing Business OWNER write gate before resolving a target', async () => {
    vi.mocked(ownsBusiness).mockReturnValue(false)
    const { db } = testDb()
    const tools = createLineProjectWorkTools('turn-1', {
      db, now: at, expectedClaim: claim, authorizationResolver: async () => authResult(),
    })
    const tool = tools.find(item => item.name === 'create_mission_draft')
    await expect(tool.handler({ title: 'Plan', summary: 'Review' })).rejects.toMatchObject({ code: 'WORK_SCOPE_DENIED' })
    expect(db.workstream.findMany).not.toHaveBeenCalled()
    expect(db.agentMissionDraft.create).not.toHaveBeenCalled()
  })

  it('rejects caller-selected identity and scope fields before database access', async () => {
    const { db } = testDb()
    const tools = createLineProjectWorkTools('turn-1', { db, now: at, expectedClaim: claim })
    const tool = tools.find(item => item.name === 'create_mission_draft')
    expect(() => tool.handler({ title: 'Plan', summary: 'Review', workstreamId: 'workstream-1' }))
      .toThrow('MISSION_SOURCE_CONFLICT')
    expect(db.lineConversationJob.findUnique).not.toHaveBeenCalled()
  })
})
