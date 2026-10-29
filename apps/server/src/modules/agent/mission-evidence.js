import { createHash, randomUUID } from 'node:crypto'
import { canonicalJson } from './execution-trace'

// TASK-ZAI-012 / PM-MISSION-02 — Agent-owned, redacted provenance port.
// The injected repository is the trust boundary: its producer resolver must use
// the claimed LINE job and existing contextFor/assertWrite/targetFor checks, and
// its reader must authorize from server-derived context and current DB scope.
// This module deliberately does not accept actor or scope from callers.

const HASH = /^[a-f0-9]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ORIGINS = new Set(['HUMAN_AUTHORED', 'AGENT_DRAFT_HUMAN_CONFIRMED'])
const SECRET_KEYS = new Set([
  'authorization', 'password', 'passwd', 'secret', 'clientsecret', 'channelsecret',
  'webhooksecret', 'apikey', 'accesstoken', 'refreshtoken', 'idtoken', 'token',
])
const UNSAFE_KEYS = new Set(['__proto__', 'prototype', 'constructor'])
const MAX_SNAPSHOT_BYTES = 64 * 1024

function fail(code) { throw Object.assign(new Error(code), { code }) }
function text(value, code = 'MISSION_EVIDENCE_INVALID') {
  if (typeof value !== 'string' || !value.trim() || value.length > 512 || value.trim() !== value) fail(code)
  return value
}
function uuid(value) {
  const result = text(value)
  if (!UUID.test(result)) fail('MISSION_EVIDENCE_INVALID')
  return result.toLowerCase()
}
function safeSnapshot(value, depth = 0) {
  if (depth > 20) fail('MISSION_EVIDENCE_INVALID')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (Array.isArray(value)) return value.map(item => safeSnapshot(item, depth + 1))
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) fail('MISSION_EVIDENCE_INVALID')
  const result = {}
  for (const [key, child] of Object.entries(value)) {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase()
    if (SECRET_KEYS.has(normalized) || UNSAFE_KEYS.has(key.toLowerCase())) fail('MISSION_EVIDENCE_INVALID')
    result[key] = safeSnapshot(child, depth + 1)
  }
  return result
}
function digest(value) {
  const json = canonicalJson(safeSnapshot(value))
  if (Buffer.byteLength(json, 'utf8') > MAX_SNAPSHOT_BYTES) fail('MISSION_EVIDENCE_INVALID')
  return createHash('sha256').update(json).digest('hex')
}
function scopeOf(value) {
  return Object.freeze({
    tenantId: uuid(value?.tenantId),
    businessId: uuid(value?.businessId),
    projectId: uuid(value?.projectId),
    workstreamId: uuid(value?.workstreamId),
  })
}
function assertSameScope(left, right) {
  for (const key of ['tenantId', 'businessId', 'projectId', 'workstreamId']) {
    if (left[key] !== right[key]) fail('MISSION_EVIDENCE_SCOPE_MISMATCH')
  }
}
function normalizeProducer(source, proposalId, confirmationJobId) {
  if (!source || source.proposalId !== proposalId || source.confirmationJobId !== confirmationJobId) {
    fail('MISSION_EVIDENCE_CONFIRMATION_INVALID')
  }
  const origin = source.origin
  if (!ORIGINS.has(origin)) fail('MISSION_EVIDENCE_INVALID')
  const verifiedScope = scopeOf(source.scope)
  const target = Object.freeze({ workItemId: uuid(source.target?.workItemId), workItemVersion: source.target?.workItemVersion })
  if (!Number.isSafeInteger(target.workItemVersion) || target.workItemVersion < 1) fail('MISSION_EVIDENCE_INVALID')
  const actorId = uuid(source.actorId)
  const sourceTurnId = uuid(source.sourceTurnId)
  const executionId = uuid(source.executionId)
  const confirmation = {
    jobId: uuid(source.confirmation?.jobId),
    inboundId: uuid(source.confirmation?.inboundId),
    actorId: uuid(source.confirmation?.actorId),
    identityVersion: text(source.confirmation?.identityVersion),
  }
  if (confirmation.jobId !== confirmationJobId || confirmation.jobId === sourceTurnId
    || confirmation.actorId !== actorId) {
    fail('MISSION_EVIDENCE_CONFIRMATION_INVALID')
  }
  const missionDigest = digest(source.missionSnapshot)
  let agentDraft = null
  if (origin === 'AGENT_DRAFT_HUMAN_CONFIRMED') {
    const draft = source.agentDraft
    if (draft?.authority !== 'SERVER_PERSISTED_DRAFT' || uuid(draft.turnId) !== sourceTurnId
      || uuid(draft.executionId) !== executionId || uuid(draft.actorId) !== actorId) {
      fail('MISSION_EVIDENCE_DRAFT_UNVERIFIED')
    }
    const draftScope = scopeOf(draft.scope)
    assertSameScope(verifiedScope, draftScope)
    const draftDigest = text(draft.digest)
    if (!HASH.test(draftDigest) || draftDigest !== missionDigest) fail('MISSION_EVIDENCE_DRAFT_DIGEST_MISMATCH')
    agentDraft = Object.freeze({
      traceId: uuid(draft.traceId),
      eventId: uuid(draft.eventId),
      revision: draft.revision,
      digest: draftDigest,
    })
    if (!Number.isSafeInteger(agentDraft.revision) || agentDraft.revision < 1) fail('MISSION_EVIDENCE_INVALID')
  } else if (source.agentDraft != null) fail('MISSION_EVIDENCE_INVALID')
  return Object.freeze({
    schemaVersion: 'agent-mission-evidence.v1',
    evidenceId: uuid(source.evidenceId ?? randomUUID()),
    revision: 1,
    origin,
    actorId,
    scope: verifiedScope,
    target,
    source: Object.freeze({ turnId: sourceTurnId, executionId }),
    confirmation: Object.freeze(confirmation),
    agentDraft,
    digest: missionDigest,
    idempotencyKey: createHash('sha256').update(canonicalJson({
      proposalId, sourceTurnId, missionDigest,
    })).digest('hex'),
    status: 'ACTIVE',
  })
}

function sameImmutableEvidence(existing, expected) {
  try {
    return existing?.schemaVersion === expected.schemaVersion
      && existing?.idempotencyKey === expected.idempotencyKey
      && existing?.proposalId === expected.proposalId
      && Number.isSafeInteger(existing?.revision) && existing.revision === 1
      && existing?.status === 'ACTIVE'
      && UUID.test(existing?.evidenceId ?? '')
      && existing?.confirmation?.jobId === expected.confirmation.jobId
      && existing?.confirmation?.inboundId === expected.confirmation.inboundId
      && existing?.confirmation?.actorId === expected.confirmation.actorId
      && existing?.confirmation?.identityVersion === expected.confirmation.identityVersion
      && existing?.actorId === expected.actorId
      && existing?.digest === expected.digest
      && canonicalJson(existing?.scope) === canonicalJson(expected.scope)
      && canonicalJson(existing?.target) === canonicalJson(expected.target)
      && canonicalJson(existing?.source) === canonicalJson(expected.source)
      && canonicalJson(existing?.agentDraft ?? null) === canonicalJson(expected.agentDraft)
      && existing?.origin === expected.origin
  } catch {
    return false
  }
}

function validateStoredRow(row, evidenceId) {
  if (!row || row.schemaVersion !== 'agent-mission-evidence.v1' || row.evidenceId !== evidenceId
    || row.status !== 'ACTIVE' || !Number.isSafeInteger(row.revision) || row.revision < 1
    || !HASH.test(row.digest ?? '') || !ORIGINS.has(row.origin)) fail('MISSION_EVIDENCE_INVALID')
  const actorId = uuid(row.actorId)
  const scope = scopeOf(row.scope)
  const target = Object.freeze({ workItemId: uuid(row.target?.workItemId), workItemVersion: row.target?.workItemVersion })
  if (!Number.isSafeInteger(target.workItemVersion) || target.workItemVersion < 1) fail('MISSION_EVIDENCE_INVALID')
  const source = Object.freeze({ turnId: uuid(row.source?.turnId), executionId: uuid(row.source?.executionId) })
  const confirmation = Object.freeze({
    jobId: uuid(row.confirmation?.jobId),
    inboundId: uuid(row.confirmation?.inboundId),
    actorId: uuid(row.confirmation?.actorId),
    identityVersion: text(row.confirmation?.identityVersion),
  })
  if (confirmation.jobId === source.turnId || confirmation.actorId !== actorId) fail('MISSION_EVIDENCE_INVALID')
  let agentDraft = null
  if (row.origin === 'AGENT_DRAFT_HUMAN_CONFIRMED') {
    const traceId = uuid(row.agentDraft?.traceId)
    const eventId = uuid(row.agentDraft?.eventId)
    const revision = row.agentDraft?.revision
    if (!Number.isSafeInteger(revision) || revision < 1 || row.agentDraft?.digest !== row.digest
      || !HASH.test(row.agentDraft.digest)) fail('MISSION_EVIDENCE_INVALID')
    agentDraft = Object.freeze({ traceId, eventId, revision, digest: row.agentDraft.digest })
  } else if (row.agentDraft != null) fail('MISSION_EVIDENCE_INVALID')
  return { ...row, actorId, scope, target, source, confirmation, agentDraft }
}

function redact(row) {
  return Object.freeze({
    status: 'verified',
    evidence: Object.freeze({
      evidenceId: row.evidenceId,
      revision: row.revision,
      origin: row.origin,
      actorId: row.actorId,
      scope: Object.freeze({ ...row.scope }),
      target: Object.freeze({ ...row.target }),
      source: Object.freeze({ ...row.source }),
      confirmation: Object.freeze({ ...row.confirmation }),
      agentDraft: row.agentDraft ? Object.freeze({ ...row.agentDraft }) : null,
      digest: row.digest,
    }),
  })
}

/**
 * Create the Agent mission evidence port over an injected persistence adapter.
 *
 * Repository contract:
 * - transaction(fn)
 * - forTransaction(prismaTransactionClient): binds the existing PM write transaction
 *   to the same repository methods used by transaction(fn); it must not start another
 *   transaction.
 * - tx.resolveConfirmedMissionSource({proposalId, confirmationJobId}): resolves
 *   signed/claimed jobs, verified identity, explicit distinct human confirmation,
 *   ownership, target versions, canonical WorkItem ID/version and DB-validated
 *   Tenant/Business/Project/Workstream from the same transaction.
 *   It may set AGENT_DRAFT_HUMAN_CONFIRMED only when it resolves a persisted,
 *   authorized Agent draft receipt (never a generic trace event).
 * - tx.findByIdempotencyKey / tx.insertImmutable for immutable record creation;
 *   insertImmutable must be create-only and backed by a unique DB constraint.
 * - repository.findByIdempotencyKey outside a rolled-back transaction to resolve
 *   a uniqueness race (PostgreSQL transactions cannot query after P2002).
 * - authorizedRead({evidenceId}) obtains requester scope from server auth, checks
 *   current DB scope and revocation/erasure state, and returns a bounded row or a
 *   typed refusal. It must not trust a scope argument from the request.
 */
export function createMissionEvidencePort({ repository } = {}) {
  if (!repository || typeof repository.transaction !== 'function'
    || typeof repository.authorizedRead !== 'function') fail('MISSION_EVIDENCE_REPOSITORY_UNAVAILABLE')

  return Object.freeze({
    async recordConfirmed({ proposalId, confirmationJobId } = {}) {
      proposalId = uuid(proposalId)
      confirmationJobId = uuid(confirmationJobId)
      if (proposalId === confirmationJobId) fail('MISSION_EVIDENCE_CONFIRMATION_INVALID')
      let expectedRow = null
      try {
        return await repository.transaction(tx => recordInTransaction(tx, { proposalId, confirmationJobId }, row => { expectedRow = row }))
      } catch (error) {
        if (error?.code !== 'P2002' && error?.code !== 'MISSION_EVIDENCE_UNIQUE_CONFLICT') throw error
        if (!expectedRow || typeof repository.findByIdempotencyKey !== 'function') fail('MISSION_EVIDENCE_REPOSITORY_UNAVAILABLE')
        // Resolve the winner only after the failed transaction has rolled back.
        const winner = await repository.findByIdempotencyKey(expectedRow.idempotencyKey)
        if (sameImmutableEvidence(winner, expectedRow)) return Object.freeze({ ...redact(winner), duplicate: true })
        fail('MISSION_EVIDENCE_IDEMPOTENCY_CONFLICT')
      }
    },

    /**
     * Record inside the PM writer's already-open transaction. The repository binds
     * the Prisma tx to its methods but must not call `$transaction` again. Any unique
     * race is allowed to abort the caller's whole transaction; retry the whole PM
     * operation to resolve the winner safely after rollback.
     */
    async recordConfirmedInTransaction(transactionClient, { proposalId, confirmationJobId } = {}) {
      proposalId = uuid(proposalId)
      confirmationJobId = uuid(confirmationJobId)
      if (proposalId === confirmationJobId) fail('MISSION_EVIDENCE_CONFIRMATION_INVALID')
      if (typeof repository.forTransaction !== 'function') fail('MISSION_EVIDENCE_REPOSITORY_UNAVAILABLE')
      const tx = repository.forTransaction(transactionClient)
      return recordInTransaction(tx, { proposalId, confirmationJobId })
    },

    async read({ evidenceId } = {}) {
      let normalizedId
      try { normalizedId = uuid(evidenceId) } catch { return Object.freeze({ status: 'invalid', code: 'MISSION_EVIDENCE_INVALID' }) }
      try {
        const result = await repository.authorizedRead({ evidenceId: normalizedId })
        if (!result || result.status === 'unavailable') return Object.freeze({ status: 'unavailable', code: 'MISSION_EVIDENCE_UNAVAILABLE' })
        if (result.status === 'forbidden') return Object.freeze({ status: 'forbidden', code: 'MISSION_EVIDENCE_FORBIDDEN' })
        if (result.status === 'erased' || result.status === 'revoked') return Object.freeze({ status: 'unavailable', code: 'MISSION_EVIDENCE_REVOKED' })
        if (result.status !== 'found') return Object.freeze({ status: 'invalid', code: 'MISSION_EVIDENCE_INVALID' })
        const row = validateStoredRow(result.evidence, normalizedId)
        return redact(row)
      } catch (error) {
        if (error?.code === 'MISSION_EVIDENCE_FORBIDDEN') return Object.freeze({ status: 'forbidden', code: error.code })
        if (error?.code === 'MISSION_EVIDENCE_ERASED' || error?.code === 'MISSION_EVIDENCE_REVOKED') {
          return Object.freeze({ status: 'unavailable', code: 'MISSION_EVIDENCE_REVOKED' })
        }
        if (error?.code === 'MISSION_EVIDENCE_UNAVAILABLE') return Object.freeze({ status: 'unavailable', code: error.code })
        if (error?.code === 'MISSION_EVIDENCE_INVALID') return Object.freeze({ status: 'invalid', code: error.code })
        return Object.freeze({ status: 'unavailable', code: 'MISSION_EVIDENCE_UNAVAILABLE' })
      }
    },
  })
}

async function recordInTransaction(tx, { proposalId, confirmationJobId }, onExpected = () => {}) {
  if (!tx || typeof tx.resolveConfirmedMissionSource !== 'function'
    || typeof tx.findByIdempotencyKey !== 'function' || typeof tx.insertImmutable !== 'function') {
    fail('MISSION_EVIDENCE_REPOSITORY_UNAVAILABLE')
  }
  const source = await tx.resolveConfirmedMissionSource({ proposalId, confirmationJobId })
  if (!source || typeof source !== 'object') fail('MISSION_EVIDENCE_CONFIRMATION_INVALID')
  const evidence = normalizeProducer(source, proposalId, confirmationJobId)
  const row = Object.freeze({ ...evidence, proposalId })
  onExpected(row)
  const existing = await tx.findByIdempotencyKey(evidence.idempotencyKey)
  if (existing) {
    if (!sameImmutableEvidence(existing, row)) fail('MISSION_EVIDENCE_IDEMPOTENCY_CONFLICT')
    return Object.freeze({ ...redact(existing), duplicate: true })
  }
  const inserted = await tx.insertImmutable(row)
  if (!sameImmutableEvidence(inserted, row)) fail('MISSION_EVIDENCE_IDEMPOTENCY_CONFLICT')
  return Object.freeze({ ...redact(inserted), duplicate: false })
}
