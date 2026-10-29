import { describe, expect, it } from 'vitest'
import { canonicalJson, sha256 } from '@/modules/agent/execution-trace'
import { createMissionDraftPort } from '@/modules/agent/mission-draft'

const ids = Object.freeze({
  mission: 'mission-01',
  sourceAgent: 'agent-session-01',
  draft: 'draft-01',
  actor: 'person-source-01',
  submitter: 'person-submitter-02',
  turn: 'turn-01',
  execution: 'execution-01',
  event: 'event-proposal-01',
  traceEvent: 'trace-event-01',
  workItem: 'work-item-01',
  evidence: 'evidence-01',
})

const scope = Object.freeze({
  tenantId: 'tenant-01',
  businessId: 'business-01',
  workspaceId: 'workspace-01',
  projectId: 'project-01',
  workstreamId: 'workstream-01',
})

const content = Object.freeze({ title: 'Prepare Q4 customer onboarding plan', summary: 'Draft a bounded onboarding mission.' })
const draftDigest = sha256(canonicalJson(content))

function draft(overrides = {}) {
  return {
    draftId: ids.draft,
    sourceAgentRef: ids.sourceAgent,
    missionId: ids.mission,
    schemaVersion: 'agent-mission-draft.v1',
    revision: 1,
    version: 1,
    scope: { ...scope },
    actorPersonId: ids.actor,
    sourceTurnId: ids.turn,
    executionId: ids.execution,
    sourceEventId: ids.event,
    sourceTraceEventId: ids.traceEvent,
    digest: draftDigest,
    content: { ...content },
    status: 'ACTIVE',
    createdAt: '2026-10-29T09:00:00.000Z',
    ...overrides,
  }
}

function target(overrides = {}) {
  const normalizedSnapshot = {
    workItemId: ids.workItem,
    workItemVersion: 1,
    status: 'PLANNED',
    subtype: 'TASK',
    assigneeRef: null,
    scope: { ...scope },
    title: content.title,
    containerId: null,
  }
  return {
    status: 'found',
    eligible: true,
    workItem: {
      workItemId: ids.workItem,
      workItemVersion: 1,
      status: 'PLANNED',
      subtype: 'TASK',
      assigneeRef: null,
      scope: { ...scope },
      normalizedSnapshot,
      snapshotDigest: sha256(canonicalJson(normalizedSnapshot)),
      ...overrides,
    },
  }
}

function repository({ readResult = { status: 'found', sourceVerified: true, draft: draft() }, draftResult,
  targetResult = target(), existing = null, insertResult = { evidenceId: ids.evidence } } = {}) {
  const calls = { read: [], forTransaction: [], resolveDraft: [], existing: [], target: [], insert: [], openedTransactions: 0, resolveTurn: [], sourceDraft: [], insertDraft: [] }
  let storedDraft = null
  const repo = {
    calls,
    async resolveAuthorizedMissionDraft(input) {
      calls.read.push(input)
      return readResult
    },
    forTransaction(tx) {
      calls.forTransaction.push(tx)
      return {
        async resolveCurrentAgentTurn(input) {
          calls.resolveTurn.push(input)
          return {
            status: 'verified', agentVerified: true, turnExecutionVerified: true,
            traceLinked: true, scopeVerified: true,
            sourceAgentRef: ids.sourceAgent, actorPersonId: ids.actor,
            sourceTurnId: ids.turn, executionId: ids.execution,
            sourceTraceEventId: ids.traceEvent, scope: { ...scope },
          }
        },
        async findMissionDraftBySource(input) {
          calls.sourceDraft.push(input)
          return storedDraft
        },
        async insertMissionDraft(row) {
          calls.insertDraft.push(row)
          storedDraft = row
          return row
        },
        async resolveMissionDraft(input) {
          calls.resolveDraft.push(input)
          return draftResult ?? { status: 'found', sourceVerified: true, draft: draft() }
        },
        async findSubmissionBySource(input) {
          calls.existing.push(input)
          return existing
        },
        async resolveEligibleWorkItem(input) {
          calls.target.push(input)
          return targetResult
        },
        async insertPmSubmissionEvidence(input) {
          calls.insert.push(input)
          return insertResult
        },
      }
    },
    async findMissionDraftBySource(input) {
      calls.sourceDraft.push(input)
      return storedDraft
    },
    async transaction(callback) { calls.openedTransactions += 1; return callback(Object.freeze({ transaction: 'synthetic' })) },
  }
  return repo
}

function codeOf(promise, code) {
  return expect(promise).rejects.toMatchObject({ code, message: code })
}

function authorization() {
  const authContext = Object.freeze({
    transport: Object.freeze({ signatureVerified: true }),
    actor: Object.freeze({ principalId: ids.actor, principalType: 'CUSTOMER', identityVerified: true }),
    scope: Object.freeze({ tenantId: scope.tenantId, businessId: scope.businessId, workspaceId: scope.workspaceId, projectId: scope.projectId }),
    request: Object.freeze({ agentId: ids.sourceAgent }),
    authorization: Object.freeze({ decision: Object.freeze({ allowed: true }) }),
  })
  return Object.freeze({ authContext })
}

describe('Agent Mission draft port (TASK-ZAI-012 revision 2026-10-29c)', () => {
  it('creates a draft from a current authenticated turn and returns the same receipt on an identical retry', async () => {
    const repo = repository()
    const port = createMissionDraftPort({ repository: repo, now: () => new Date('2026-10-29T10:00:00.000Z') })
    const request = {
      authorization: authorization(), turnId: ids.turn, executionId: ids.execution,
      mission: content, callerIdentity: 'attacker', scope: { tenantId: 'caller-tenant' },
    }
    const created = await port.createMissionDraftFromTurn(request)
    const retried = await port.createMissionDraftFromTurn(request)
    expect(created.status).toBe('created')
    expect(retried).toEqual({ status: 'existing', draft: created.draft })
    expect(created.draft).toMatchObject({
      revision: 1, schemaVersion: 'agent-mission-draft.v1',
      tenantId: scope.tenantId, businessId: scope.businessId,
      workspaceId: scope.workspaceId, projectId: scope.projectId,
      sourceAgentRef: ids.sourceAgent, sourceTurnId: ids.turn,
      executionId: ids.execution, sourceTraceEventId: ids.traceEvent,
      digest: draftDigest, status: 'ACTIVE',
    })
    expect(created.draft).not.toHaveProperty('summary')
    expect(repo.calls.openedTransactions).toBe(2)
    expect(repo.calls.resolveTurn[0].authClaims).toMatchObject({
      sourceAgentRef: ids.sourceAgent, actorPersonId: ids.actor,
      tenantId: scope.tenantId, businessId: scope.businessId,
    })
    expect(repo.calls.insertDraft).toHaveLength(1)
  })

  it('fails closed without authenticated current-turn provenance and rejects changed retries', async () => {
    const repo = repository()
    const port = createMissionDraftPort({ repository: repo })
    const request = { authorization: authorization(), turnId: ids.turn, executionId: ids.execution, mission: content }
    const noProofRepo = repository()
    noProofRepo.forTransaction = () => ({
      resolveCurrentAgentTurn: async () => ({ status: 'unavailable' }),
      findMissionDraftBySource: async () => null,
      insertMissionDraft: async () => { throw new Error('must not insert') },
    })
    await codeOf(createMissionDraftPort({ repository: noProofRepo }).createMissionDraftFromTurn(request), 'MISSION_SOURCE_UNAVAILABLE')

    const created = await port.createMissionDraftFromTurn(request)
    const changed = port.createMissionDraftFromTurn({ ...request, mission: { ...content, summary: 'Changed content' } })
    expect(created.status).toBe('created')
    await codeOf(changed, 'MISSION_DRAFT_IDEMPOTENCY_CONFLICT')
    expect(repo.calls.insertDraft).toHaveLength(1)
  })

  it('rejects caller-fabricated or unverified Agent authorization', async () => {
    const port = createMissionDraftPort({ repository: repository() })
    await codeOf(port.createMissionDraftFromTurn({
      authorization: { authContext: { request: { agentId: ids.sourceAgent } } },
      turnId: ids.turn, executionId: ids.execution, mission: content,
    }), 'MISSION_SOURCE_UNAVAILABLE')
  })

  it('resolves a unique-source race only after the create transaction rolls back', async () => {
    const repo = repository()
    let transactionFinished = false
    repo.transaction = async callback => {
      try { return await callback(Object.freeze({ transaction: 'race' })) }
      finally { transactionFinished = true }
    }
    const txFactory = repo.forTransaction.bind(repo)
    repo.forTransaction = tx => {
      const adapter = txFactory(tx)
      adapter.insertMissionDraft = async () => { throw Object.assign(new Error('unique'), { code: 'P2002' }) }
      return adapter
    }
    repo.findMissionDraftBySource = async () => {
      expect(transactionFinished).toBe(true)
      return draft({ revision: 1 })
    }
    const port = createMissionDraftPort({ repository: repo })
    const result = await port.createMissionDraftFromTurn({
      authorization: authorization(), turnId: ids.turn, executionId: ids.execution, mission: content,
    })
    expect(result.status).toBe('existing')
    expect(result.draft.digest).toBe(draftDigest)
  })

  it('returns only the verified display snapshot and provenance fields', async () => {
    const repo = repository()
    const port = createMissionDraftPort({ repository: repo })
    const result = await port.readMissionDraft({ missionId: ids.mission, requesterPersonId: ids.submitter })
    expect(result).toEqual({
      missionId: ids.mission, sourceAgentRef: ids.sourceAgent, revision: 1,
      digest: draftDigest, scope, sourceTurnId: ids.turn, executionId: ids.execution,
      sourceEventId: ids.event, sourceTraceEventId: ids.traceEvent,
      title: content.title, summary: content.summary, createdAt: '2026-10-29T09:00:00.000Z',
    })
    expect(result).not.toHaveProperty('actorPersonId')
    expect(result).not.toHaveProperty('content')
    expect(repo.calls.read).toEqual([{ missionId: ids.mission, requesterPersonId: ids.submitter }])
  })

  it('fails closed when no persisted draft producer has created the mission', async () => {
    const port = createMissionDraftPort({ repository: repository({ readResult: { status: 'not_found' } }) })
    await codeOf(port.readMissionDraft({ missionId: ids.mission, requesterPersonId: ids.submitter }), 'MISSION_NOT_FOUND')
  })

  it('preserves forbidden and unavailable outcomes without raw adapter errors', async () => {
    const forbidden = createMissionDraftPort({ repository: repository({ readResult: { status: 'forbidden' } }) })
    await codeOf(forbidden.readMissionDraft({ missionId: ids.mission, requesterPersonId: ids.submitter }), 'MISSION_FORBIDDEN')

    const unavailableRepo = repository()
    unavailableRepo.resolveAuthorizedMissionDraft = async () => {
      throw Object.assign(new Error('private connection string'), { code: 'SOME_UNMAPPED_ERROR' })
    }
    const unavailable = createMissionDraftPort({ repository: unavailableRepo })
    await codeOf(unavailable.readMissionDraft({ missionId: ids.mission, requesterPersonId: ids.submitter }), 'MISSION_SOURCE_UNAVAILABLE')
  })

  it('refuses unverifiable source traces, digest changes, and non-display content', async () => {
    const noTraceProof = createMissionDraftPort({ repository: repository({
      readResult: { status: 'found', sourceVerified: false, draft: draft() },
    }) })
    await codeOf(noTraceProof.readMissionDraft({ missionId: ids.mission, requesterPersonId: ids.submitter }), 'MISSION_SOURCE_UNAVAILABLE')

    const changedDigest = createMissionDraftPort({ repository: repository({
      readResult: { status: 'found', sourceVerified: true, draft: draft({ digest: 'a'.repeat(64) }) },
    }) })
    await codeOf(changedDigest.readMissionDraft({ missionId: ids.mission, requesterPersonId: ids.submitter }), 'MISSION_SOURCE_CONFLICT')

    const secretContent = createMissionDraftPort({ repository: repository({
      readResult: { status: 'found', sourceVerified: true, draft: draft({ content: { ...content, rawPrompt: 'must not leak' } }) },
    }) })
    await codeOf(secretContent.readMissionDraft({ missionId: ids.mission, requesterPersonId: ids.submitter }), 'MISSION_SOURCE_CONFLICT')
  })

  it('requires exact five-part scope and stable source references', async () => {
    const badScope = createMissionDraftPort({ repository: repository({
      readResult: { status: 'found', sourceVerified: true, draft: draft({ scope: { tenantId: scope.tenantId } }) },
    }) })
    await codeOf(badScope.readMissionDraft({ missionId: ids.mission, requesterPersonId: ids.submitter }), 'MISSION_SCOPE_INVALID')

    const badReference = createMissionDraftPort({ repository: repository({
      readResult: { status: 'found', sourceVerified: true, draft: draft({ sourceTraceEventId: '' }) },
    }) })
    await codeOf(badReference.readMissionDraft({ missionId: ids.mission, requesterPersonId: ids.submitter }), 'MISSION_SOURCE_CONFLICT')
  })

  it('binds a PM-created PLANNED task in the supplied transaction and stores stable identity evidence', async () => {
    const repo = repository()
    const port = createMissionDraftPort({ repository: repo, now: () => new Date('2026-10-29T10:00:00.000Z') })
    const tx = Object.freeze({ marker: 'PM transaction' })
    const result = await port.recordPmSubmissionInTransaction(tx, {
      missionId: ids.mission,
      expectedRevision: 1,
      expectedDigest: draftDigest,
      submittedByPersonId: ids.submitter,
      workItemId: ids.workItem,
    })
    expect(result).toEqual({
      evidenceId: ids.evidence,
      sourceMissionId: ids.mission,
      sourceRevision: 1,
      sourceDigest: draftDigest,
      workItemId: ids.workItem,
      workItemVersion: 1,
    })
    expect(repo.calls.forTransaction).toEqual([tx])
    expect(repo.calls.openedTransactions).toBe(0)
    expect(repo.calls.insert).toHaveLength(1)
    expect(repo.calls.insert[0]).toMatchObject({
      draftId: ids.draft,
      sourceAgentRef: ids.sourceAgent,
      missionId: ids.mission,
      origin: 'AGENT_DRAFT_HUMAN_CONFIRMED',
      confirmationKind: 'PM_SUBMISSION',
      submittedByPersonId: ids.submitter,
      submittedAt: '2026-10-29T10:00:00.000Z',
      scope,
      sourceRevision: 1,
      sourceDigest: draftDigest,
      workItemId: ids.workItem,
      workItemVersion: 1,
      missionSnapshotJson: canonicalJson({
        mission: content,
        workItem: {
          workstreamId: scope.workstreamId,
          subtype: 'TASK', title: content.title, status: 'PLANNED', assigneeRef: null,
        },
      }),
      missionSnapshotDigest: sha256(canonicalJson({
        mission: content,
        workItem: {
          workstreamId: scope.workstreamId,
          subtype: 'TASK', title: content.title, status: 'PLANNED', assigneeRef: null,
        },
      })),
    })
    expect(repo.calls.insert[0].idempotencyKey).toBe(sha256(canonicalJson({
      sourceAgentRef: ids.sourceAgent, missionId: ids.mission,
      tenantId: scope.tenantId, businessId: scope.businessId,
      workspaceId: scope.workspaceId, projectId: scope.projectId,
      workstreamId: scope.workstreamId,
    })))
    expect(repo.calls.target).toEqual([{ workItemId: ids.workItem, submittedByPersonId: ids.submitter }])
  })

  it('does not open a nested transaction and evidence rolls back with the PM transaction', async () => {
    const repo = repository()
    const port = createMissionDraftPort({ repository: repo })
    const committed = []
    async function pmTransaction(callback) {
      const pending = []
      const tx = Object.freeze({ pending })
      try {
        const value = await callback(tx)
        committed.push(...pending)
        return value
      } catch (error) {
        throw error
      }
    }
    const txRepo = repo.forTransaction.bind(repo)
    repo.forTransaction = tx => {
      const adapter = txRepo(tx)
      const insert = adapter.insertPmSubmissionEvidence
      adapter.insertPmSubmissionEvidence = async value => {
        tx.pending.push(value)
        return insert(value)
      }
      return adapter
    }
    await expect(pmTransaction(async tx => {
      await port.recordPmSubmissionInTransaction(tx, {
        missionId: ids.mission, expectedRevision: 1, expectedDigest: draftDigest,
        submittedByPersonId: ids.submitter, workItemId: ids.workItem,
      })
      throw Object.assign(new Error('synthetic PM writer failure'), { code: 'PM_WRITE_FAILED' })
    })).rejects.toMatchObject({ code: 'PM_WRITE_FAILED' })
    expect(committed).toEqual([])
    expect(repo.calls.openedTransactions).toBe(0)
  })

  it('rejects changed source revisions and digests before evidence insertion', async () => {
    const stale = repository({ draftResult: { status: 'found', sourceVerified: true, draft: draft({ revision: 4 }) } })
    const port = createMissionDraftPort({ repository: stale })
    await codeOf(port.recordPmSubmissionInTransaction({}, {
      missionId: ids.mission, expectedRevision: 1, expectedDigest: draftDigest,
      submittedByPersonId: ids.submitter, workItemId: ids.workItem,
    }), 'MISSION_SOURCE_CONFLICT')
    expect(stale.calls.insert).toEqual([])
  })

  it('rejects target scope, state, subtype, eligibility, snapshot, and digest mismatch', async () => {
    const mismatchedScope = repository({ targetResult: target({
      scope: { ...scope, projectId: 'another-project' },
    }) })
    const port1 = createMissionDraftPort({ repository: mismatchedScope })
    await codeOf(port1.recordPmSubmissionInTransaction({}, {
      missionId: ids.mission, expectedRevision: 1, expectedDigest: draftDigest,
      submittedByPersonId: ids.submitter, workItemId: ids.workItem,
    }), 'MISSION_SCOPE_INVALID')

    for (const changes of [{ status: 'IN_PROGRESS' }, { subtype: 'MILESTONE' }, { eligible: false }]) {
      const result = target(changes)
      if ('eligible' in changes) result.eligible = changes.eligible
      else Object.assign(result.workItem, changes)
      const repo = repository({ targetResult: result })
      const port = createMissionDraftPort({ repository: repo })
      await codeOf(port.recordPmSubmissionInTransaction({}, {
        missionId: ids.mission, expectedRevision: 1, expectedDigest: draftDigest,
        submittedByPersonId: ids.submitter, workItemId: ids.workItem,
      }), 'MISSION_TARGET_INVALID')
    }

    const unsafeSnapshot = target()
    unsafeSnapshot.workItem.normalizedSnapshot.rawPrompt = 'must not be persisted'
    unsafeSnapshot.workItem.snapshotDigest = sha256(canonicalJson(unsafeSnapshot.workItem.normalizedSnapshot))
    const port2 = createMissionDraftPort({ repository: repository({ targetResult: unsafeSnapshot }) })
    await codeOf(port2.recordPmSubmissionInTransaction({}, {
      missionId: ids.mission, expectedRevision: 1, expectedDigest: draftDigest,
      submittedByPersonId: ids.submitter, workItemId: ids.workItem,
    }), 'MISSION_TARGET_INVALID')

    const unexpectedSnapshotField = target()
    unexpectedSnapshotField.workItem.normalizedSnapshot.internalNotes = 'not in the evidence snapshot allowlist'
    unexpectedSnapshotField.workItem.snapshotDigest = sha256(canonicalJson(unexpectedSnapshotField.workItem.normalizedSnapshot))
    const port2b = createMissionDraftPort({ repository: repository({ targetResult: unexpectedSnapshotField }) })
    await codeOf(port2b.recordPmSubmissionInTransaction({}, {
      missionId: ids.mission, expectedRevision: 1, expectedDigest: draftDigest,
      submittedByPersonId: ids.submitter, workItemId: ids.workItem,
    }), 'MISSION_TARGET_INVALID')

    const wrongDigest = target()
    wrongDigest.workItem.snapshotDigest = 'b'.repeat(64)
    const port3 = createMissionDraftPort({ repository: repository({ targetResult: wrongDigest }) })
    await codeOf(port3.recordPmSubmissionInTransaction({}, {
      missionId: ids.mission, expectedRevision: 1, expectedDigest: draftDigest,
      submittedByPersonId: ids.submitter, workItemId: ids.workItem,
    }), 'MISSION_TARGET_INVALID')
  })

  it('requires the PM writer transaction and rejects any prior source association', async () => {
    const repo = repository({ existing: { evidenceId: 'already-submitted' } })
    const port = createMissionDraftPort({ repository: repo })
    await codeOf(port.recordPmSubmissionInTransaction(null, {
      missionId: ids.mission, expectedRevision: 1, expectedDigest: draftDigest,
      submittedByPersonId: ids.submitter, workItemId: ids.workItem,
    }), 'MISSION_TRANSACTION_REQUIRED')
    await codeOf(port.recordPmSubmissionInTransaction({}, {
      missionId: ids.mission, expectedRevision: 1, expectedDigest: draftDigest,
      submittedByPersonId: ids.submitter, workItemId: ids.workItem,
    }), 'MISSION_ALREADY_SUBMITTED')
    expect(repo.calls.insert).toEqual([])
  })

  it('maps a unique constraint race to the fixed already-submitted error', async () => {
    const repo = repository()
    const forTransaction = repo.forTransaction.bind(repo)
    repo.forTransaction = tx => {
      const adapter = forTransaction(tx)
      adapter.insertPmSubmissionEvidence = async () => { throw Object.assign(new Error('database detail'), { code: 'P2002' }) }
      return adapter
    }
    const port = createMissionDraftPort({ repository: repo })
    await codeOf(port.recordPmSubmissionInTransaction({}, {
      missionId: ids.mission, expectedRevision: 1, expectedDigest: draftDigest,
      submittedByPersonId: ids.submitter, workItemId: ids.workItem,
    }), 'MISSION_ALREADY_SUBMITTED')
  })
})
