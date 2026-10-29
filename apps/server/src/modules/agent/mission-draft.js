import { randomUUID } from 'node:crypto'
import { canonicalJson, sha256 } from './execution-trace'

// TASK-ZAI-012 revision 2026-10-29c. Injected Agent service seam; no Prisma adapter
// or runtime caller is wired in this checkpoint.

const SCOPE_KEYS = Object.freeze(['tenantId', 'businessId', 'workspaceId', 'projectId', 'workstreamId'])
const WORK_ITEM_SNAPSHOT_KEYS = new Set([
  'workItemId', 'workItemVersion', 'status', 'subtype', 'assigneeRef', 'scope', 'title', 'containerId',
])
const HASH = /^[a-f0-9]{64}$/
const SECRET_OR_EXECUTABLE_KEY = /(?:prompt|reason|thought|secret|token|credential|authori[sz]ation|payload|action|effect|execute|provider|raw)/i
const MAX_IDENTIFIER_LENGTH = 512
const MAX_TITLE_LENGTH = 240
// Local safe upper bound until PM confirms the shared summary bound before wiring.
const MAX_SUMMARY_LENGTH = 4096
const MAX_SNAPSHOT_BYTES = 16 * 1024
const MISSION_ERRORS = new Set([
  'MISSION_NOT_FOUND', 'MISSION_FORBIDDEN', 'MISSION_SOURCE_UNAVAILABLE',
  'MISSION_SOURCE_CONFLICT', 'MISSION_SCOPE_INVALID', 'MISSION_TARGET_INVALID',
  'MISSION_ALREADY_SUBMITTED', 'MISSION_TRANSACTION_REQUIRED', 'MISSION_DRAFT_IDEMPOTENCY_CONFLICT',
])

function fail(code) {
  throw Object.assign(new Error(code), { code })
}

function rethrowMissionError(error) {
  if (MISSION_ERRORS.has(error?.code)) fail(error.code)
  fail('MISSION_SOURCE_UNAVAILABLE')
}

function requiredText(value, code, max = MAX_IDENTIFIER_LENGTH) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || value.trim() !== value) fail(code)
  return value
}

function normalizeScope(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== SCOPE_KEYS.length
    || Object.keys(value).some(key => !SCOPE_KEYS.includes(key))) fail('MISSION_SCOPE_INVALID')
  return Object.freeze(Object.fromEntries(SCOPE_KEYS.map(key => [key, requiredText(value[key], 'MISSION_SCOPE_INVALID')])))
}

function assertSameScope(left, right) {
  for (const key of SCOPE_KEYS) if (left[key] !== right[key]) fail('MISSION_SCOPE_INVALID')
}

function safeJson(value, depth = 0) {
  if (depth > 16) fail('MISSION_TARGET_INVALID')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(item => safeJson(item, depth + 1))
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail('MISSION_TARGET_INVALID')
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_OR_EXECUTABLE_KEY.test(key)) fail('MISSION_TARGET_INVALID')
    result[key] = safeJson(child, depth + 1)
  }
  return result
}

function parseCreatedAt(value, code) {
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(date.getTime())) fail(code)
  return date.toISOString()
}

function normalizeDraft(result, missionId) {
  if (!result || result.status === 'not_found') fail('MISSION_NOT_FOUND')
  if (result.status === 'forbidden') fail('MISSION_FORBIDDEN')
  if (result.status === 'unavailable') fail('MISSION_SOURCE_UNAVAILABLE')
  if (result.status === 'conflict' || result.status === 'revoked' || result.status === 'erased') fail('MISSION_SOURCE_CONFLICT')
  if (result.status !== 'found' || result.sourceVerified !== true) fail('MISSION_SOURCE_UNAVAILABLE')

  const row = result.draft
  if (!row || row.missionId !== missionId || row.status !== 'ACTIVE'
    || row.schemaVersion !== 'agent-mission-draft.v1' || row.revision !== 1
    || !Number.isSafeInteger(row.version) || row.version < 1
    || !HASH.test(row.digest ?? '')
    || !row.content || typeof row.content !== 'object' || Array.isArray(row.content)
    || Object.keys(row.content).length !== 2
    || Object.keys(row.content).some(key => !['title', 'summary'].includes(key))) fail('MISSION_SOURCE_CONFLICT')

  const sourceAgentRef = requiredText(row.sourceAgentRef, 'MISSION_SOURCE_CONFLICT')
  const normalizedMissionId = requiredText(row.missionId, 'MISSION_SOURCE_CONFLICT')
  const title = requiredText(row.content.title, 'MISSION_SOURCE_CONFLICT', MAX_TITLE_LENGTH)
  const summary = requiredText(row.content.summary, 'MISSION_SOURCE_CONFLICT', MAX_SUMMARY_LENGTH)
  const content = { title, summary }
  if (sha256(canonicalJson(content)) !== row.digest) fail('MISSION_SOURCE_CONFLICT')
  const scope = normalizeScope(row.scope)
  const sourceTurnId = requiredText(row.sourceTurnId, 'MISSION_SOURCE_CONFLICT')
  const executionId = requiredText(row.executionId, 'MISSION_SOURCE_CONFLICT')
  const sourceEventId = requiredText(row.sourceEventId, 'MISSION_SOURCE_CONFLICT')
  const sourceTraceEventId = requiredText(row.sourceTraceEventId, 'MISSION_SOURCE_CONFLICT')
  const actorPersonId = requiredText(row.actorPersonId, 'MISSION_SOURCE_CONFLICT')
  const draftId = requiredText(row.draftId, 'MISSION_SOURCE_CONFLICT')

  return Object.freeze({
    draftId, sourceAgentRef, missionId: normalizedMissionId, revision: row.revision,
    digest: row.digest, scope, actorPersonId, sourceTurnId, executionId,
    sourceEventId, sourceTraceEventId, title, summary,
    createdAt: parseCreatedAt(row.createdAt, 'MISSION_SOURCE_CONFLICT'),
  })
}

function normalizeTarget(result, draft, workItemId) {
  if (!result || result.status === 'not_found' || result.status === 'unavailable') fail('MISSION_TARGET_INVALID')
  if (result.status !== 'found' || result.eligible !== true) fail('MISSION_TARGET_INVALID')
  const target = result.workItem
  if (!target || target.workItemId !== workItemId || target.status !== 'PLANNED' || target.subtype !== 'TASK'
    || target.assigneeRef !== null || !Number.isSafeInteger(target.workItemVersion) || target.workItemVersion < 1) fail('MISSION_TARGET_INVALID')
  const scope = normalizeScope(target.scope)
  assertSameScope(draft.scope, scope)
  const snapshot = safeJson(target.normalizedSnapshot)
  if (!snapshot || Array.isArray(snapshot) || typeof snapshot !== 'object'
    || Object.keys(snapshot).some(key => !WORK_ITEM_SNAPSHOT_KEYS.has(key))
    || snapshot.workItemId !== workItemId
    || snapshot.workItemVersion !== target.workItemVersion
    || snapshot.status !== 'PLANNED' || snapshot.subtype !== 'TASK'
    || snapshot.assigneeRef !== null
    || canonicalJson(normalizeScope(snapshot.scope)) !== canonicalJson(scope)
    || snapshot.title !== draft.title) fail('MISSION_TARGET_INVALID')
  const snapshotJson = canonicalJson(snapshot)
  if (Buffer.byteLength(snapshotJson, 'utf8') > MAX_SNAPSHOT_BYTES) fail('MISSION_TARGET_INVALID')
  const snapshotDigest = sha256(snapshotJson)
  if (target.snapshotDigest !== snapshotDigest) fail('MISSION_TARGET_INVALID')
  return Object.freeze({
    workItemId, workItemVersion: target.workItemVersion, scope,
    normalizedSnapshot: Object.freeze(snapshot), snapshotDigest,
  })
}

function typedResult(status) {
  if (status === 'not_found') fail('MISSION_NOT_FOUND')
  if (status === 'forbidden') fail('MISSION_FORBIDDEN')
  if (status === 'unavailable') fail('MISSION_SOURCE_UNAVAILABLE')
  if (status === 'conflict') fail('MISSION_SOURCE_CONFLICT')
  if (status === 'revoked' || status === 'erased') fail('MISSION_SOURCE_CONFLICT')
}

function verifiedAuthClaims(authorization) {
  const context = authorization?.authContext
  const actor = context?.actor
  const scope = context?.scope
  const agentId = context?.request?.agentId
  if (!context || !Object.isFrozen(context) || !Object.isFrozen(context.transport)
    || !Object.isFrozen(actor) || !Object.isFrozen(scope) || !Object.isFrozen(context.request)
    || context.transport?.signatureVerified !== true || actor?.identityVerified !== true
    || actor?.principalType === 'UNKNOWN' || context.authorization?.decision?.allowed !== true) {
    fail('MISSION_SOURCE_UNAVAILABLE')
  }
  return Object.freeze({
    actorPersonId: requiredText(actor.principalId, 'MISSION_SOURCE_UNAVAILABLE'),
    sourceAgentRef: requiredText(agentId, 'MISSION_SOURCE_UNAVAILABLE'),
    tenantId: requiredText(scope.tenantId, 'MISSION_SOURCE_UNAVAILABLE'),
    businessId: requiredText(scope.businessId, 'MISSION_SOURCE_UNAVAILABLE'),
    workspaceId: scope.workspaceId == null ? null : requiredText(scope.workspaceId, 'MISSION_SOURCE_UNAVAILABLE'),
    projectId: scope.projectId == null ? null : requiredText(scope.projectId, 'MISSION_SOURCE_UNAVAILABLE'),
  })
}

function normalizeMissionInput(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Object.keys(value).length !== 2
    || Object.keys(value).some(key => !['title', 'summary'].includes(key))) fail('MISSION_SOURCE_CONFLICT')
  const mission = Object.freeze({
    title: requiredText(value.title, 'MISSION_SOURCE_CONFLICT', MAX_TITLE_LENGTH),
    summary: requiredText(value.summary, 'MISSION_SOURCE_CONFLICT', MAX_SUMMARY_LENGTH),
  })
  return Object.freeze({ mission, digest: sha256(canonicalJson(mission)) })
}

function sourceIdentity(provenance) {
  return Object.freeze({
    tenantId: provenance.scope.tenantId,
    businessId: provenance.scope.businessId,
    sourceAgentRef: provenance.sourceAgentRef,
    sourceTurnId: provenance.sourceTurnId,
    executionId: provenance.executionId,
  })
}

function sameSourceDraft(existing, expected) {
  try {
    const actualScope = normalizeScope(existing.scope)
    return existing.status === 'ACTIVE'
      && existing.schemaVersion === 'agent-mission-draft.v1'
      && existing.revision === 1
      && existing.sourceAgentRef === expected.sourceAgentRef
      && existing.sourceTurnId === expected.sourceTurnId
      && existing.executionId === expected.executionId
      && existing.actorPersonId === expected.actorPersonId
      && existing.sourceTraceEventId === expected.sourceTraceEventId
      && existing.digest === expected.digest
      && canonicalJson(actualScope) === canonicalJson(expected.scope)
      && sha256(canonicalJson(existing.content)) === expected.digest
  } catch {
    return false
  }
}

function draftReceipt(row) {
  return Object.freeze({
    draftId: requiredText(row.draftId, 'MISSION_SOURCE_UNAVAILABLE'),
    missionId: requiredText(row.missionId, 'MISSION_SOURCE_UNAVAILABLE'),
    revision: 1,
    schemaVersion: 'agent-mission-draft.v1',
    tenantId: requiredText(row.scope.tenantId, 'MISSION_SOURCE_UNAVAILABLE'),
    businessId: requiredText(row.scope.businessId, 'MISSION_SOURCE_UNAVAILABLE'),
    workspaceId: requiredText(row.scope.workspaceId, 'MISSION_SOURCE_UNAVAILABLE'),
    projectId: requiredText(row.scope.projectId, 'MISSION_SOURCE_UNAVAILABLE'),
    workstreamId: requiredText(row.scope.workstreamId, 'MISSION_SOURCE_UNAVAILABLE'),
    sourceAgentRef: requiredText(row.sourceAgentRef, 'MISSION_SOURCE_UNAVAILABLE'),
    sourceTurnId: requiredText(row.sourceTurnId, 'MISSION_SOURCE_UNAVAILABLE'),
    executionId: requiredText(row.executionId, 'MISSION_SOURCE_UNAVAILABLE'),
    sourceEventId: requiredText(row.sourceEventId, 'MISSION_SOURCE_UNAVAILABLE'),
    sourceTraceEventId: requiredText(row.sourceTraceEventId, 'MISSION_SOURCE_UNAVAILABLE'),
    digest: row.digest,
    status: 'ACTIVE',
  })
}

function normalizeCurrentProvenance(result, claims, turnId, executionId) {
  if (!result || result.status !== 'verified' || result.agentVerified !== true
    || result.turnExecutionVerified !== true || result.traceLinked !== true || result.scopeVerified !== true) {
    fail('MISSION_SOURCE_UNAVAILABLE')
  }
  if (result.sourceAgentRef !== claims.sourceAgentRef || result.actorPersonId !== claims.actorPersonId
    || result.sourceTurnId !== turnId || result.executionId !== executionId) fail('MISSION_SOURCE_UNAVAILABLE')
  const scope = normalizeScope(result.scope)
  if (scope.tenantId !== claims.tenantId || scope.businessId !== claims.businessId
    || (claims.workspaceId && scope.workspaceId !== claims.workspaceId)
    || (claims.projectId && scope.projectId !== claims.projectId)) fail('MISSION_SCOPE_INVALID')
  const sourceTraceEventId = requiredText(result.sourceTraceEventId, 'MISSION_SOURCE_UNAVAILABLE')
  return Object.freeze({
    sourceAgentRef: claims.sourceAgentRef,
    actorPersonId: claims.actorPersonId,
    sourceTurnId: turnId,
    executionId,
    sourceEventId: randomUUID(),
    sourceTraceEventId,
    scope,
  })
}

/**
 * Creates the Agent read and PM submission association port over an injected
 * persistence adapter. The adapter is the trust boundary for authenticated
 * requester derivation and persisted trace resolution. Tests use synthetic
 * adapters; no default runtime adapter exists in this checkpoint.
 *
 * Adapter contract:
 * - resolveAuthorizedMissionDraft({missionId, requesterPersonId}) validates the
 *   PM session viewer and current scope, then returns a bounded draft or typed status.
 * - forTransaction(tx) binds these methods to the exact PM transaction without
 *   opening another transaction: resolveMissionDraft({missionId}),
 *   findSubmissionBySource({sourceAgentRef, missionId}),
 *   resolveEligibleWorkItem({workItemId}), insertPmSubmissionEvidence(input).
 * - resolveEligibleWorkItem is a schema-specific current DB query that proves
 *   non-deleted eligibility and complete scope ancestry, and returns a normalized
 *   allowlisted snapshot plus its digest. The snapshot carries WorkItem ID/version,
 *   state, subtype, null assignee, scope, title, and optional containerId. Mission
 *   summary stays in the immutable draft snapshot; it is not a WorkItem field.
 *   Evidence insertion receives missionSnapshotJson plus missionSnapshotDigest
 *   over {mission:{title,summary},workItem:{workstreamId,containerId?,subtype,
 *   title,status,assigneeRef}} and a server-computed flat-scope idempotency hash.
 * - transaction(fn), tx.resolveCurrentAgentTurn({turnId, executionId, authClaims,
 *   missionDigest}), tx.findMissionDraftBySource(identity), tx.insertMissionDraft(row),
 *   and repository.findMissionDraftBySource(identity) for a post-rollback unique race.
 *   resolveCurrentAgentTurn must verify the current runtime claim, authenticated
 *   Agent provenance, trace linkage, and DB-derived scope in the same transaction.
 *   It must resolve active Project and Workstream IDs because current Agent auth
 *   context carries no Workstream identifier.
 */
export function createMissionDraftPort({ repository, now = () => new Date() } = {}) {
  if (!repository || typeof repository.resolveAuthorizedMissionDraft !== 'function'
    || typeof repository.forTransaction !== 'function') fail('MISSION_SOURCE_UNAVAILABLE')

  return Object.freeze({
    async createMissionDraftFromTurn({ authorization, turnId, executionId, mission } = {}) {
      if (typeof repository.transaction !== 'function') fail('MISSION_SOURCE_UNAVAILABLE')
      turnId = requiredText(turnId, 'MISSION_SOURCE_UNAVAILABLE')
      executionId = requiredText(executionId, 'MISSION_SOURCE_UNAVAILABLE')
      const claims = verifiedAuthClaims(authorization)
      const { mission: content, digest } = normalizeMissionInput(mission)
      const authClaims = Object.freeze({ ...claims })
      let verifiedSource = null
      let expectedDraft = null
      try {
        return await repository.transaction(async tx => {
          const txRepository = repository.forTransaction(tx)
          if (!txRepository || typeof txRepository.resolveCurrentAgentTurn !== 'function'
            || typeof txRepository.findMissionDraftBySource !== 'function'
            || typeof txRepository.insertMissionDraft !== 'function') fail('MISSION_SOURCE_UNAVAILABLE')
          const sourceResult = await txRepository.resolveCurrentAgentTurn({
            turnId,
            executionId,
            authClaims,
            missionDigest: digest,
          })
          verifiedSource = normalizeCurrentProvenance(sourceResult, authClaims, turnId, executionId)
          const identity = sourceIdentity(verifiedSource)
          const expected = {
            ...identity, actorPersonId: verifiedSource.actorPersonId,
            sourceTraceEventId: verifiedSource.sourceTraceEventId,
            digest, scope: verifiedSource.scope,
          }
          expectedDraft = expected

          const existing = await txRepository.findMissionDraftBySource(identity)
          if (existing) {
            if (!sameSourceDraft(existing, expected)) fail('MISSION_DRAFT_IDEMPOTENCY_CONFLICT')
            return Object.freeze({ status: 'existing', draft: draftReceipt(existing) })
          }

          const row = Object.freeze({
            draftId: randomUUID(),
            missionId: randomUUID(),
            revision: 1,
            schemaVersion: 'agent-mission-draft.v1',
            tenantId: verifiedSource.scope.tenantId,
            businessId: verifiedSource.scope.businessId,
            workspaceId: verifiedSource.scope.workspaceId,
            projectId: verifiedSource.scope.projectId,
            workstreamId: verifiedSource.scope.workstreamId,
            sourceAgentRef: verifiedSource.sourceAgentRef,
            actorPersonId: verifiedSource.actorPersonId,
            sourceTurnId: verifiedSource.sourceTurnId,
            executionId: verifiedSource.executionId,
            sourceEventId: verifiedSource.sourceEventId,
            sourceTraceEventId: verifiedSource.sourceTraceEventId,
            scope: verifiedSource.scope,
            content,
            digest,
            status: 'ACTIVE',
            createdAt: parseCreatedAt(now(), 'MISSION_SOURCE_UNAVAILABLE'),
            version: 1,
          })
          const inserted = await txRepository.insertMissionDraft(row)
          if (!inserted || inserted.draftId !== row.draftId || inserted.missionId !== row.missionId
            || inserted.sourceEventId !== row.sourceEventId || !sameSourceDraft(inserted, expected)) {
            fail('MISSION_SOURCE_UNAVAILABLE')
          }
          return Object.freeze({ status: 'created', draft: draftReceipt(inserted) })
        })
      } catch (error) {
        if (error?.code === 'P2002' || error?.code === 'MISSION_UNIQUE_CONFLICT') {
          if (!verifiedSource || !expectedDraft || typeof repository.findMissionDraftBySource !== 'function') {
            fail('MISSION_SOURCE_UNAVAILABLE')
          }
          try {
            const winner = await repository.findMissionDraftBySource(sourceIdentity(verifiedSource))
            if (winner && sameSourceDraft(winner, expectedDraft)) {
              return Object.freeze({ status: 'existing', draft: draftReceipt(winner) })
            }
          } catch (lookupError) {
            rethrowMissionError(lookupError)
          }
          fail('MISSION_DRAFT_IDEMPOTENCY_CONFLICT')
        }
        rethrowMissionError(error)
      }
    },

    async readMissionDraft({ missionId, requesterPersonId } = {}) {
      missionId = requiredText(missionId, 'MISSION_NOT_FOUND')
      requesterPersonId = requiredText(requesterPersonId, 'MISSION_FORBIDDEN')
      try {
        const result = await repository.resolveAuthorizedMissionDraft({ missionId, requesterPersonId })
        const draft = normalizeDraft(result, missionId)
        return Object.freeze({
          missionId: draft.missionId,
          sourceAgentRef: draft.sourceAgentRef,
          revision: draft.revision,
          digest: draft.digest,
          scope: draft.scope,
          sourceTurnId: draft.sourceTurnId,
          executionId: draft.executionId,
          sourceEventId: draft.sourceEventId,
          sourceTraceEventId: draft.sourceTraceEventId,
          title: draft.title,
          summary: draft.summary,
          createdAt: draft.createdAt,
        })
      } catch (error) {
        rethrowMissionError(error)
      }
    },

    async recordPmSubmissionInTransaction(tx, {
      missionId, expectedRevision, expectedDigest, submittedByPersonId, workItemId,
    } = {}) {
      if (!tx || typeof tx !== 'object') fail('MISSION_TRANSACTION_REQUIRED')
      missionId = requiredText(missionId, 'MISSION_NOT_FOUND')
      submittedByPersonId = requiredText(submittedByPersonId, 'MISSION_FORBIDDEN')
      workItemId = requiredText(workItemId, 'MISSION_TARGET_INVALID')
      if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1 || !HASH.test(expectedDigest ?? '')) {
        fail('MISSION_SOURCE_CONFLICT')
      }

      let transactionRepository
      try { transactionRepository = repository.forTransaction(tx) } catch { fail('MISSION_TRANSACTION_REQUIRED') }
      if (!transactionRepository || typeof transactionRepository.resolveMissionDraft !== 'function'
        || typeof transactionRepository.findSubmissionBySource !== 'function'
        || typeof transactionRepository.resolveEligibleWorkItem !== 'function'
        || typeof transactionRepository.insertPmSubmissionEvidence !== 'function') fail('MISSION_TRANSACTION_REQUIRED')

      try {
        const draftResult = await transactionRepository.resolveMissionDraft({ missionId, submittedByPersonId })
        typedResult(draftResult?.status)
        const draft = normalizeDraft(draftResult, missionId)
        if (draft.revision !== expectedRevision || draft.digest !== expectedDigest) fail('MISSION_SOURCE_CONFLICT')

        const existing = await transactionRepository.findSubmissionBySource({
          sourceAgentRef: draft.sourceAgentRef, missionId: draft.missionId,
        })
        if (existing) fail('MISSION_ALREADY_SUBMITTED')

        const targetResult = await transactionRepository.resolveEligibleWorkItem({ workItemId, submittedByPersonId })
        const target = normalizeTarget(targetResult, draft, workItemId)

        const idempotencyKey = sha256(canonicalJson({
          sourceAgentRef: draft.sourceAgentRef,
          missionId: draft.missionId,
          tenantId: draft.scope.tenantId,
          businessId: draft.scope.businessId,
          workspaceId: draft.scope.workspaceId,
          projectId: draft.scope.projectId,
          workstreamId: draft.scope.workstreamId,
        }))
        const missionSnapshot = Object.freeze({
          mission: Object.freeze({ title: draft.title, summary: draft.summary }),
          workItem: Object.freeze({
            workstreamId: target.scope.workstreamId,
            ...(target.normalizedSnapshot.containerId == null ? {} : { containerId: target.normalizedSnapshot.containerId }),
            subtype: target.normalizedSnapshot.subtype,
            title: target.normalizedSnapshot.title,
            status: target.normalizedSnapshot.status,
            assigneeRef: null,
          }),
        })
        const missionSnapshotJson = canonicalJson(missionSnapshot)
        if (Buffer.byteLength(missionSnapshotJson, 'utf8') > MAX_SNAPSHOT_BYTES) fail('MISSION_TARGET_INVALID')
        const missionSnapshotDigest = sha256(missionSnapshotJson)
        const submittedAt = parseCreatedAt(now(), 'MISSION_SOURCE_UNAVAILABLE')
        const stored = await transactionRepository.insertPmSubmissionEvidence({
          draftId: draft.draftId,
          sourceAgentRef: draft.sourceAgentRef,
          missionId: draft.missionId,
          origin: 'AGENT_DRAFT_HUMAN_CONFIRMED',
          confirmationKind: 'PM_SUBMISSION',
          submittedByPersonId,
          submittedAt,
          scope: draft.scope,
          sourceRevision: draft.revision,
          sourceDigest: draft.digest,
          workItemId: target.workItemId,
          workItemVersion: target.workItemVersion,
          missionSnapshotJson,
          missionSnapshotDigest,
          idempotencyKey,
        })
        const evidenceId = requiredText(stored?.evidenceId, 'MISSION_SOURCE_UNAVAILABLE')
        return Object.freeze({
          evidenceId,
          sourceMissionId: draft.missionId,
          sourceRevision: draft.revision,
          sourceDigest: draft.digest,
          workItemId: target.workItemId,
          workItemVersion: target.workItemVersion,
        })
      } catch (error) {
        if (error?.code === 'P2002' || error?.code === 'MISSION_UNIQUE_CONFLICT') fail('MISSION_ALREADY_SUBMITTED')
        rethrowMissionError(error)
      }
    },
  })
}
