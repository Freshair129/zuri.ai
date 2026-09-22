import { createHash, randomBytes, randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { hasPermission } from '@/modules/identity/rbac'
import { recordAudit } from './audit'
import { loadAuthorizedProject, loadRun } from './project-execution-trace-service'
import { canonicalize } from './execution-trace'

// @req FR-272 — exact-hash, two-party PM approval admission for effectful
// Agent/Fleet steps; read-only steps do not create an approval row.
// @spec ADR-103, PMR-013, PMT-013, SEC-001, SEC-003, SEC-008
// @tested tests/integration/project-approval-gateway.test.js, tests/unit/project-approval-gateway.test.js

export const APPROVAL_ACTION_CLASSES = Object.freeze([
  'READ_ONLY',
  'PROJECT_WRITE',
  'EXTERNAL_MESSAGE',
  'SPEND',
  'CREDENTIAL_CHANGE',
  'MERGE',
  'DEPLOY',
  'DESTRUCTIVE',
])

const APPROVAL_STATE_VALUES = Object.freeze({
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
  REVOKED: 'REVOKED',
  CONSUMED: 'CONSUMED',
  SUPERSEDED: 'SUPERSEDED',
})
export const APPROVAL_STATES = Object.freeze(Object.values(APPROVAL_STATE_VALUES))

export const APPROVAL_POLICY_VERSION = 'pm-approval-gateway.v1'
export const APPROVAL_MAX_SUMMARY_BYTES = 16 * 1024
export const APPROVAL_DEFAULT_TTL_MS = 15 * 60 * 1000
export const APPROVAL_MAX_TTL_MS = 24 * 60 * 60 * 1000
export const APPROVAL_ADMISSION_TTL_MS = 60 * 1000
export const APPROVAL_REQUEST_CAPABILITY = 'project.execution.request'

const HASH = /^[a-f0-9]{64}$/i
const COMMIT = /^[a-f0-9]{7,64}$/i
const SENSITIVE_KEY = /(secret|token|password|credential|audio|transcript|cookie|authorization|api.?key|private.?key|command|script)/i
const EFFECTFUL_STEP_STATES = new Set(['NOT_STARTED', 'READY', 'WAITING_APPROVAL'])

export class ApprovalGatewayError extends Error {
  constructor(code, message, status = 400, details = undefined) {
    super(message)
    this.name = 'ApprovalGatewayError'
    this.code = code
    this.status = status
    if (details !== undefined) this.details = details
  }
}

function fail(code, message, status = 400, details = undefined) {
  throw new ApprovalGatewayError(code, message, status, details)
}

function requiredText(value, name, max = 256) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    fail('APPROVAL_REQUEST_INVALID', `${name} is required and bounded`)
  }
  return value.trim()
}

function optionalText(value, name, max = 256) {
  if (value === null || value === undefined || value === '') return null
  return requiredText(value, name, max)
}

function actorId(viewer, fallback = null) {
  return viewer?.principal?.id || viewer?.personId || fallback || null
}

function requireActor(viewer, context) {
  const id = actorId(viewer)
  if (!id) fail('AUTH_REQUIRED', `${context} requires a resolved person`, 401)
  return id
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value)
  } catch {
    return fallback
  }
}

function assertSafeValue(value, path = '$', depth = 0) {
  if (depth > 6) fail('APPROVAL_SUMMARY_INVALID', `${path} is too deeply nested`)
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return
  if (Array.isArray(value)) {
    if (value.length > 64) fail('APPROVAL_SUMMARY_INVALID', `${path} has too many entries`)
    value.forEach((entry, index) => assertSafeValue(entry, `${path}[${index}]`, depth + 1))
    return
  }
  if (typeof value !== 'object') fail('APPROVAL_SUMMARY_INVALID', `${path} contains an unsupported value`)
  for (const [key, child] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) fail('APPROVAL_SUMMARY_SECRET', `${path}.${key} is not allowed in approval evidence`, 422)
    assertSafeValue(child, `${path}.${key}`, depth + 1)
  }
}

function boundedObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('APPROVAL_SUMMARY_INVALID', `${name} must be an object`)
  }
  assertSafeValue(value, name)
  const json = JSON.stringify(canonicalize(value))
  if (Buffer.byteLength(json, 'utf8') > APPROVAL_MAX_SUMMARY_BYTES) {
    fail('APPROVAL_SUMMARY_TOO_LARGE', `${name} exceeds ${APPROVAL_MAX_SUMMARY_BYTES} bytes`, 413)
  }
  return { value: JSON.parse(json), json }
}

function boundedHashes(value) {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value) || value.length > 32) fail('APPROVAL_REQUEST_INVALID', 'artifactHashes must be a bounded array')
  const hashes = value.map((hash) => requiredText(hash, 'artifact hash', 128).toLowerCase())
  if (hashes.some((hash) => !HASH.test(hash))) fail('APPROVAL_REQUEST_INVALID', 'artifactHashes must be SHA-256 digests')
  return [...new Set(hashes)].sort()
}

function boundedDigest(value, name) {
  const result = optionalText(value, name, 128)
  if (result !== null && !HASH.test(result)) fail('APPROVAL_REQUEST_INVALID', `${name} must be a SHA-256 digest`)
  return result?.toLowerCase() || null
}

function boundedCommit(value) {
  const result = optionalText(value, 'commitSha', 64)
  if (result !== null && !COMMIT.test(result)) fail('APPROVAL_REQUEST_INVALID', 'commitSha must be a commit SHA')
  return result?.toLowerCase() || null
}

function asDate(value, name) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(date.getTime())) fail('APPROVAL_REQUEST_INVALID', `${name} must be a valid date`)
  return date
}

function expiryDate(value, now) {
  const expiresAt = value === undefined || value === null
    ? new Date(now + APPROVAL_DEFAULT_TTL_MS)
    : asDate(value, 'expiresAt')
  const delta = expiresAt.getTime() - now
  if (delta <= 0) fail('APPROVAL_EXPIRED', 'Approval expiry must be in the future', 409)
  if (delta > APPROVAL_MAX_TTL_MS) fail('APPROVAL_REQUEST_INVALID', 'Approval expiry exceeds the maximum TTL')
  return expiresAt
}

function digestInput(input) {
  return {
    actionClass: input.actionClass,
    scope: {
      tenantId: input.tenantId,
      businessId: input.businessId,
      workspaceId: input.workspaceId,
      projectId: input.projectId,
    },
    executionRunId: input.executionRunId,
    executionStepId: input.executionStepId,
    effectKey: input.effectKey,
    manifestHash: input.manifestHash,
    inputHash: input.inputHash,
    artifactHashes: input.artifactHashes,
    commitSha: input.commitSha,
    expectedEffects: input.expectedEffects,
    eligibleReviewerCapability: input.eligibleReviewerCapability,
    policyVersion: input.policyVersion,
    expiresAt: input.expiresAt.toISOString(),
  }
}

export function buildApprovalDigest(input) {
  const canonical = JSON.stringify(canonicalize(digestInput(input)))
  return createHash('sha256').update(canonical).digest('hex')
}

function parseStoredApproval(row) {
  return {
    ...row,
    artifactHashes: parseJson(row.artifactHashesJson, []),
    payloadSummary: parseJson(row.payloadSummaryJson, {}),
    expectedEffects: parseJson(row.expectedEffectsJson, {}),
  }
}

function approvalDto(row) {
  const parsed = parseStoredApproval(row)
  return {
    approvalRequestId: parsed.approvalRequestId,
    tenantId: parsed.tenantId,
    businessId: parsed.businessId,
    workspaceId: parsed.workspaceId,
    projectId: parsed.projectId,
    executionRunId: parsed.executionRunId,
    executionStepId: parsed.executionStepId,
    actionClass: parsed.actionClass,
    effectKey: parsed.effectKey,
    manifestHash: parsed.manifestHash,
    inputHash: parsed.inputHash,
    artifactHashes: parsed.artifactHashes,
    commitSha: parsed.commitSha,
    payloadSummary: parsed.payloadSummary,
    expectedEffects: parsed.expectedEffects,
    eligibleReviewerCapability: parsed.eligibleReviewerCapability,
    policyVersion: parsed.policyVersion,
    requestedByPersonId: parsed.requestedByPersonId,
    requestedAt: new Date(parsed.requestedAt).toISOString(),
    expiresAt: new Date(parsed.expiresAt).toISOString(),
    requestDigest: parsed.requestDigest,
    state: parsed.state,
    decidedByPersonId: parsed.decidedByPersonId,
    decidedAt: parsed.decidedAt ? new Date(parsed.decidedAt).toISOString() : null,
    decisionReason: parsed.decisionReason,
    consumedAt: parsed.consumedAt ? new Date(parsed.consumedAt).toISOString() : null,
    auditEventId: parsed.auditEventId,
  }
}

function runInTransaction(db, callback) {
  return typeof db.$transaction === 'function' ? db.$transaction(callback) : callback(db)
}

function isUniqueConstraintError(error) {
  return error?.code === 'P2002'
}

function assertScope(project, run) {
  const tenantId = run.tenantId || project.business?.tenantId || project.workspace?.tenantId
  const businessId = run.businessId || project.businessId || project.workspace?.businessId
  if (!tenantId || !businessId || !project.id) {
    fail('SCOPE_NOT_ALLOWED', 'Approval requires a resolved Tenant, Business and Project scope', 403)
  }
  if (project.businessId && run.businessId && project.businessId !== run.businessId) {
    fail('SCOPE_NOT_ALLOWED', 'Execution run and Project belong to different Business scopes', 403)
  }
  return { tenantId, businessId, workspaceId: project.workspaceId, projectId: project.id }
}

function assertActionClass(value) {
  const actionClass = requiredText(value, 'actionClass', 64).toUpperCase()
  if (!APPROVAL_ACTION_CLASSES.includes(actionClass)) fail('APPROVAL_REQUEST_INVALID', 'actionClass is not allow-listed')
  return actionClass
}

function assertStepHash(currentHash, requestedHash) {
  if ((currentHash || null) !== (requestedHash || null)) {
    fail('INPUT_CHANGED', 'The current PM step input hash differs from the approval request', 409)
  }
}

function assertStepEligible(run, step) {
  if (run.status === 'UNKNOWN' || step.status === 'UNKNOWN') {
    fail('RECONCILIATION_REQUIRED', 'An unresolved external effect must be reconciled before approval admission', 409)
  }
  if (!EFFECTFUL_STEP_STATES.has(step.status)) {
    fail('APPROVAL_NOT_ELIGIBLE', `Step status ${step.status} cannot enter the approval gateway`, 409)
  }
}

async function loadApproval(db, approvalRequestId) {
  const row = await db.projectApprovalRequest.findUnique({
    where: { approvalRequestId },
    include: { run: true, step: true },
  })
  if (!row) fail('APPROVAL_NOT_FOUND', 'Approval request not found', 404)
  return row
}

async function loadApprovalScope(db, row, { viewer, projectId, executionRunId } = {}) {
  if (projectId && row.projectId !== projectId) fail('APPROVAL_NOT_FOUND', 'Approval request not found', 404)
  if (executionRunId && row.executionRunId !== executionRunId) fail('APPROVAL_NOT_FOUND', 'Approval request not found', 404)
  const project = await loadAuthorizedProject(row.projectId, { viewer, db })
  const run = await loadRun(row.projectId, row.executionRunId, { db })
  if (run.id !== row.executionRunDbId || row.executionStepDbId !== row.step.id) {
    fail('RECONCILIATION_REQUIRED', 'Approval request is not linked to the current PM trace rows', 409)
  }
  const scope = assertScope(project, run)
  if (row.tenantId !== scope.tenantId || row.businessId !== scope.businessId || row.workspaceId !== scope.workspaceId) {
    fail('SCOPE_NOT_ALLOWED', 'Approval request scope does not match the PM trace scope', 403)
  }
  return { project, run, step: row.step, scope }
}

function assertRequestAuthority(viewer, businessId) {
  if (!ownsBusiness(viewer, businessId) && !hasPermission(viewer, businessId, APPROVAL_REQUEST_CAPABILITY)) {
    fail('SCOPE_NOT_ALLOWED', 'Approval request authority is not granted in this Business', 403)
  }
}

function assertReviewer(viewer, approval) {
  const reviewerId = requireActor(viewer, 'Approval decision')
  if (reviewerId === approval.requestedByPersonId) {
    fail('REVIEWER_CONFLICT', 'The requester cannot approve their own protected step', 409)
  }
  if (!hasPermission(viewer, approval.businessId, approval.eligibleReviewerCapability)) {
    fail('REVIEWER_NOT_ELIGIBLE', 'Reviewer capability is not granted in the approval Business scope', 403)
  }
  return reviewerId
}

function transitionPayload({ row, state, reason, actorId, actorType }) {
  return {
    entityType: 'PROJECT_APPROVAL_REQUEST',
    entityId: row.id,
    action: `PM_APPROVAL_${state}`,
    actorType,
    actorId,
    tenantId: row.tenantId,
    businessId: row.businessId,
    reason: reason || null,
    beforeJson: { state: row.state, requestDigest: row.requestDigest },
    afterJson: { state, requestDigest: row.requestDigest },
    payload: {
      approvalRequestId: row.approvalRequestId,
      executionRunId: row.executionRunId,
      executionStepId: row.executionStepId,
      actionClass: row.actionClass,
      effectKey: row.effectKey,
      requestDigest: row.requestDigest,
      state,
      reason: reason || null,
    },
  }
}

async function appendTransitionAudit(tx, row, { state, reason = null, actorId = null, actorType = 'LOCAL_USER' }) {
  return recordAudit(tx, transitionPayload({ row, state, reason, actorId, actorType }))
}

async function supersedePriorRequests(tx, current, { actorId }) {
  const prior = await tx.projectApprovalRequest.findMany({
    where: {
      executionRunDbId: current.executionRunDbId,
      executionStepDbId: current.executionStepDbId,
      state: { in: ['PENDING', 'APPROVED'] },
      requestDigest: { not: current.requestDigest },
    },
  })
  for (const row of prior) {
    const audit = await appendTransitionAudit(tx, row, {
      state: 'SUPERSEDED',
      reason: 'A new material approval digest was created for the same PM step',
      actorId,
      actorType: 'LOCAL_USER',
    })
    await tx.projectApprovalRequest.update({
      where: { id: row.id },
      data: { state: 'SUPERSEDED', auditEventId: audit.id },
    })
  }
}

function normalizeRequest(input, scope, run, step, now) {
  const actionClass = assertActionClass(input.actionClass)
  const effectKey = requiredText(input.effectKey, 'effectKey', 512)
  const manifestHash = boundedDigest(input.manifestHash, 'manifestHash')
  const inputHash = boundedDigest(input.inputHash, 'inputHash')
  assertStepHash(step.inputHash, inputHash)
  const artifactHashes = boundedHashes(input.artifactHashes)
  const commitSha = boundedCommit(input.commitSha)
  const payloadSummary = boundedObject(input.payloadSummary || {}, 'payloadSummary')
  const expectedEffects = boundedObject(input.expectedEffects || {}, 'expectedEffects')
  const eligibleReviewerCapability = requiredText(input.eligibleReviewerCapability, 'eligibleReviewerCapability', 160)
  const policyVersion = optionalText(input.policyVersion, 'policyVersion', 160) || APPROVAL_POLICY_VERSION
  const expiresAt = expiryDate(input.expiresAt, now)
  const executionStepId = requiredText(input.executionStepId, 'executionStepId', 128)
  if (executionStepId !== step.executionStepId) fail('INPUT_CHANGED', 'Approval step identity does not match the current PM step', 409)
  const executionRunId = requiredText(input.executionRunId, 'executionRunId', 128)
  if (executionRunId !== run.executionRunId) fail('INPUT_CHANGED', 'Approval run identity does not match the current PM run', 409)
  if (actionClass !== 'READ_ONLY' && !effectKey) fail('APPROVAL_REQUEST_INVALID', 'Effectful approval requires effectKey')
  const normalized = {
    ...scope,
    executionRunId,
    executionStepId,
    actionClass,
    effectKey,
    manifestHash,
    inputHash,
    artifactHashes,
    commitSha,
    payloadSummary,
    expectedEffects,
    eligibleReviewerCapability,
    policyVersion,
    expiresAt,
  }
  return { ...normalized, requestDigest: buildApprovalDigest(normalized) }
}

async function requestApprovalTx(tx, input, { viewer, now }) {
  const project = await loadAuthorizedProject(input.projectId, { viewer, db: tx })
  const run = await loadRun(input.projectId, input.executionRunId, { db: tx })
  const step = run.steps.find((candidate) => candidate.executionStepId === input.executionStepId)
  if (!step) fail('APPROVAL_NOT_FOUND', 'Execution step not found', 404)
  const actionClass = assertActionClass(input.actionClass)
  if (actionClass === 'READ_ONLY') return { required: false, approval: null }
  assertStepEligible(run, step)
  const scope = assertScope(project, run)
  assertRequestAuthority(viewer, scope.businessId)
  const requestedByPersonId = requireActor(viewer, 'Approval request')
  const normalized = normalizeRequest({ ...input, actionClass }, scope, run, step, now)
  const existing = await tx.projectApprovalRequest.findFirst({
    where: {
      executionRunId: normalized.executionRunId,
      executionStepId: normalized.executionStepId,
      requestDigest: normalized.requestDigest,
    },
  })
  if (existing) return { required: true, approval: approvalDto(existing), idempotent: true }

  const row = await tx.projectApprovalRequest.create({
    data: {
      id: randomUUID(),
      approvalRequestId: randomUUID(),
      tenantId: normalized.tenantId,
      businessId: normalized.businessId,
      workspaceId: normalized.workspaceId,
      projectId: normalized.projectId,
      executionRunDbId: run.id,
      executionStepDbId: step.id,
      executionRunId: normalized.executionRunId,
      executionStepId: normalized.executionStepId,
      actionClass: normalized.actionClass,
      effectKey: normalized.effectKey,
      manifestHash: normalized.manifestHash,
      inputHash: normalized.inputHash,
      artifactHashesJson: JSON.stringify(normalized.artifactHashes),
      commitSha: normalized.commitSha,
      payloadSummaryJson: normalized.payloadSummary.json,
      expectedEffectsJson: normalized.expectedEffects.json,
      eligibleReviewerCapability: normalized.eligibleReviewerCapability,
      policyVersion: normalized.policyVersion,
      requestedByPersonId,
      requestedAt: new Date(now),
      expiresAt: normalized.expiresAt,
      requestDigest: normalized.requestDigest,
      state: 'PENDING',
    },
  })
  const audit = await appendTransitionAudit(tx, row, {
    state: 'PENDING',
    reason: 'Approval request created',
    actorId: requestedByPersonId,
  })
  const linked = await tx.projectApprovalRequest.update({
    where: { id: row.id },
    data: { auditEventId: audit.id },
  })
  await tx.projectExecutionStep.updateMany({
    where: {
      id: step.id,
      status: { in: ['NOT_STARTED', 'READY', 'WAITING_APPROVAL'] },
    },
    data: { status: 'WAITING_APPROVAL', auditEventId: audit.id },
  })
  await supersedePriorRequests(tx, linked, { actorId: requestedByPersonId })
  return { required: true, approval: approvalDto(linked), idempotent: false }
}

export async function requestApproval(input, { viewer, db = prisma, now = Date.now() } = {}) {
  if (!input?.projectId || !input?.executionRunId || !input?.executionStepId) {
    fail('APPROVAL_REQUEST_INVALID', 'projectId, executionRunId and executionStepId are required')
  }
  try {
    return await runInTransaction(db, (tx) => requestApprovalTx(tx, input, { viewer, now }))
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error

    // The composite digest constraint is the final idempotency fence when two
    // callers create the same request concurrently. Re-resolve the exact PM
    // rows after the losing transaction rolls back and return the winner.
    const project = await loadAuthorizedProject(input.projectId, { viewer, db })
    const run = await loadRun(input.projectId, input.executionRunId, { db })
    const step = run.steps.find((candidate) => candidate.executionStepId === input.executionStepId)
    if (!step) throw error
    const normalized = normalizeRequest(input, assertScope(project, run), run, step, now)
    const existing = await db.projectApprovalRequest.findFirst({
      where: {
        executionRunId: normalized.executionRunId,
        executionStepId: normalized.executionStepId,
        requestDigest: normalized.requestDigest,
      },
    })
    if (!existing) throw error
    return { required: true, approval: approvalDto(existing), idempotent: true }
  }
}

async function expireApprovalTx(tx, row, { actorId, reason }) {
  const changed = await tx.projectApprovalRequest.updateMany({
    where: { id: row.id, state: row.state, requestDigest: row.requestDigest },
    data: { state: 'EXPIRED' },
  })
  if (changed.count !== 1) return false
  const audit = await appendTransitionAudit(tx, row, { state: 'EXPIRED', reason, actorId })
  await tx.projectApprovalRequest.update({ where: { id: row.id }, data: { auditEventId: audit.id } })
  return true
}

function decisionValue(value) {
  const decision = requiredText(value, 'decision', 32).toUpperCase()
  if (!['APPROVE', 'REJECT'].includes(decision)) fail('APPROVAL_REQUEST_INVALID', 'decision must be APPROVE or REJECT')
  return decision
}

async function decideApprovalTx(tx, input, { viewer, now }) {
  const row = await loadApproval(tx, input.approvalRequestId)
  const context = await loadApprovalScope(tx, row, { viewer, projectId: input.projectId, executionRunId: input.executionRunId })
  const decision = decisionValue(input.decision)
  const reviewerId = assertReviewer(viewer, row)
  if (row.state !== 'PENDING') {
    if ((row.state === 'APPROVED' && decision === 'APPROVE') || (row.state === 'REJECTED' && decision === 'REJECT')) {
      return { approval: approvalDto(row), idempotent: true }
    }
    fail('APPROVAL_ALREADY_DECIDED', 'Approval request has already reached a terminal decision', 409)
  }
  if (now >= new Date(row.expiresAt).getTime()) {
    await expireApprovalTx(tx, row, { actorId: reviewerId, reason: 'Decision arrived after expiry' })
    return { error: { code: 'APPROVAL_EXPIRED', message: 'Approval request has expired', status: 409 } }
  }
  assertStepEligible(context.run, context.step)
  assertStepHash(context.step.inputHash, row.inputHash)
  const reason = optionalText(input.reason, 'reason', 500)
  if (decision === 'REJECT' && !reason) fail('APPROVAL_REQUEST_INVALID', 'A rejection requires a reason')
  const state = decision === 'APPROVE' ? 'APPROVED' : 'REJECTED'
  const changed = await tx.projectApprovalRequest.updateMany({
    where: { id: row.id, state: 'PENDING', requestDigest: row.requestDigest },
    data: {
      state,
      decidedByPersonId: reviewerId,
      decidedAt: new Date(now),
      decisionReason: reason,
    },
  })
  if (changed.count !== 1) return { race: true }
  const audit = await appendTransitionAudit(tx, row, {
    state,
    reason: reason || `Approval ${decision.toLowerCase()}d`,
    actorId: reviewerId,
  })
  const updated = await tx.projectApprovalRequest.update({
    where: { id: row.id },
    data: { auditEventId: audit.id },
  })
  await tx.projectExecutionStep.updateMany({
    where: { id: context.step.id, status: 'WAITING_APPROVAL' },
    data: { auditEventId: audit.id },
  })
  return { approval: approvalDto(updated), idempotent: false }
}

export async function decideApproval(
  approvalRequestId,
  input,
  { viewer, projectId, executionRunId, db = prisma, now = Date.now() } = {},
) {
  const result = await runInTransaction(db, (tx) => decideApprovalTx(tx, {
    ...input,
    approvalRequestId,
    projectId,
    executionRunId,
  }, { viewer, now }))
  if (result?.error) fail(result.error.code, result.error.message, result.error.status)
  if (result?.race) {
    const row = await loadApproval(db, approvalRequestId)
    const requestedDecision = decisionValue(input.decision)
    if ((row.state === 'APPROVED' && requestedDecision === 'APPROVE')
      || (row.state === 'REJECTED' && requestedDecision === 'REJECT')) {
      return { approval: approvalDto(row), idempotent: true }
    }
    fail('APPROVAL_ALREADY_DECIDED', 'Approval decision lost a compare-and-set race', 409)
  }
  return result
}

function stateRefusal(row) {
  if (row.state === 'PENDING') return new ApprovalGatewayError('APPROVAL_REQUIRED', 'Approval is required before admission', 409)
  if (row.state === 'EXPIRED') return new ApprovalGatewayError('APPROVAL_EXPIRED', 'Approval request has expired', 409)
  if (row.state === 'REVOKED') return new ApprovalGatewayError('APPROVAL_REVOKED', 'Approval request has been revoked', 409)
  if (row.state === 'SUPERSEDED') return new ApprovalGatewayError('APPROVAL_SUPERSEDED', 'Approval request has been superseded', 409)
  if (row.state === 'REJECTED') return new ApprovalGatewayError('APPROVAL_ALREADY_DECIDED', 'Approval request was rejected', 409)
  if (row.state === 'CONSUMED') return new ApprovalGatewayError('APPROVAL_ALREADY_DECIDED', 'Approval request was already admitted', 409)
  return new ApprovalGatewayError('APPROVAL_REQUIRED', 'Approval is required before admission', 409)
}

async function revokeApprovalTx(tx, row, { actorId, actorType, reason, state = 'REVOKED' }) {
  if (!['PENDING', 'APPROVED'].includes(row.state)) return false
  const changed = await tx.projectApprovalRequest.updateMany({
    where: { id: row.id, state: row.state, requestDigest: row.requestDigest },
    data: { state },
  })
  if (changed.count !== 1) return false
  const audit = await appendTransitionAudit(tx, row, { state, reason, actorId, actorType })
  await tx.projectApprovalRequest.update({ where: { id: row.id }, data: { auditEventId: audit.id } })
  return true
}

async function admitApprovedStepTx(tx, input, { now }) {
  const row = await loadApproval(tx, input.approvalRequestId)
  const executorViewer = input.executor?.viewer || input.executor?.identityViewer
  const context = await loadApprovalScope(tx, row, { viewer: executorViewer })
  if (row.state !== 'APPROVED') throw stateRefusal(row)
  if (input.requestDigest !== row.requestDigest) {
    await revokeApprovalTx(tx, row, {
      actorId: input.executor?.executorId || null,
      actorType: 'EXECUTOR',
      reason: 'Executor supplied a digest different from the approved request',
      state: 'SUPERSEDED',
    })
    return { error: { code: 'INPUT_CHANGED', message: 'Admission digest differs from the approved request', status: 409 } }
  }
  if (now >= new Date(row.expiresAt).getTime()) {
    await expireApprovalTx(tx, row, { actorId: input.executor?.executorId || null, reason: 'Admission arrived after expiry' })
    return { error: { code: 'APPROVAL_EXPIRED', message: 'Approval request has expired', status: 409 } }
  }
  if (!hasPermission(executorViewer, row.businessId, row.eligibleReviewerCapability)) {
    await revokeApprovalTx(tx, row, {
      actorId: input.executor?.executorId || null,
      actorType: 'EXECUTOR',
      reason: 'Current Identity capability is no longer granted in the approval scope',
      state: 'REVOKED',
    })
    return { error: { code: 'APPROVAL_REVOKED', message: 'Approval reviewer capability is no longer active', status: 409 } }
  }
  assertStepEligible(context.run, context.step)
  assertStepHash(context.step.inputHash, row.inputHash)
  const leaseEpoch = requiredText(input.leaseEpoch, 'leaseEpoch', 256)
  if (leaseEpoch !== context.step.attemptId) {
    fail('APPROVAL_LEASE_MISMATCH', 'Executor lease epoch does not match the current PM attempt', 409)
  }
  if (row.admissionLeaseEpoch) throw stateRefusal({ ...row, state: 'CONSUMED' })
  const admissionReceipt = randomBytes(32).toString('hex')
  const admissionReceiptHash = createHash('sha256').update(admissionReceipt).digest('hex')
  const admissionExpiresAt = new Date(now + APPROVAL_ADMISSION_TTL_MS)
  const claimed = await tx.projectApprovalRequest.updateMany({
    where: {
      id: row.id,
      state: 'APPROVED',
      requestDigest: row.requestDigest,
      admissionLeaseEpoch: null,
    },
    data: {
      state: 'CONSUMED',
      admissionLeaseEpoch: leaseEpoch,
      admissionReceiptHash,
      admissionExpiresAt,
      consumedAt: new Date(now),
    },
  })
  if (claimed.count !== 1) {
    const current = await loadApproval(tx, row.approvalRequestId)
    throw stateRefusal(current)
  }
  const audit = await appendTransitionAudit(tx, row, {
    state: 'CONSUMED',
    reason: 'Executor admission receipt issued',
    actorId: input.executor?.executorId || null,
    actorType: 'EXECUTOR',
  })
  await tx.projectApprovalRequest.update({ where: { id: row.id }, data: { auditEventId: audit.id } })
  await tx.projectExecutionStep.updateMany({
    where: { id: context.step.id, attemptId: leaseEpoch, status: { in: ['WAITING_APPROVAL', 'READY', 'NOT_STARTED'] } },
    data: { status: 'RUNNING', auditEventId: audit.id },
  })
  await tx.projectExecutionRun.updateMany({
    where: { id: context.run.id, status: { in: ['WAITING_APPROVAL', 'RUNNING'] } },
    data: { status: 'RUNNING', auditEventId: audit.id },
  })
  return {
    admitted: true,
    approvalRequestId: row.approvalRequestId,
    requestDigest: row.requestDigest,
    executionRunId: row.executionRunId,
    executionStepId: row.executionStepId,
    effectKey: row.effectKey,
    leaseEpoch,
    admissionReceipt,
    admissionExpiresAt: admissionExpiresAt.toISOString(),
    auditEventId: audit.id,
  }
}

export async function admitApprovedStep(
  approvalRequestId,
  requestDigest,
  leaseEpoch,
  executor,
  { db = prisma, now = Date.now() } = {},
) {
  const result = await runInTransaction(db, (tx) => admitApprovedStepTx(tx, {
    approvalRequestId,
    requestDigest,
    leaseEpoch,
    executor,
  }, { now }))
  if (result?.error) fail(result.error.code, result.error.message, result.error.status)
  return result
}

export async function revokeOrSupersede(
  approvalRequestId,
  reason,
  cause = 'REVOKED',
  { db = prisma, actorId = null, actorType = 'SYSTEM' } = {},
) {
  const state = cause === 'SUPERSEDED' ? 'SUPERSEDED' : 'REVOKED'
  const result = await runInTransaction(db, async (tx) => {
    const row = await loadApproval(tx, approvalRequestId)
    const changed = await revokeApprovalTx(tx, row, { actorId, actorType, reason: requiredText(reason, 'reason', 500), state })
    return { approval: approvalDto(await loadApproval(tx, approvalRequestId)), changed }
  })
  return result
}

export async function listApprovals(projectId, executionRunId, { viewer, db = prisma } = {}) {
  const project = await loadAuthorizedProject(projectId, { viewer, db })
  const run = await loadRun(projectId, executionRunId, { db })
  const scope = assertScope(project, run)
  const rows = await db.projectApprovalRequest.findMany({
    where: { projectId, executionRunId, tenantId: scope.tenantId, businessId: scope.businessId },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  })
  return { executionRunId, approvals: rows.map(approvalDto) }
}
