import { createHash } from 'node:crypto'
import { CUSTOMER_LIFECYCLE } from '@/lib/validation/enums'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { authorizeScope, resolveAuthorizationContext } from '@/modules/identity/authorization-context'
import { listActiveDirectBusinessOwnerIds } from '@/modules/identity/authorization-context'

const QUORUM_BY_TIER = Object.freeze({ L1: 1, L2: 2, L3: 3, L4: 4 })
const REQUEST_LIFETIME_MS = 24 * 60 * 60 * 1000
const TERMINAL_STATUSES = new Set(['REJECTED', 'EXPIRED', 'STALE', 'EXECUTED', 'RESTORE_INVALIDATED'])

function approvalError(code, status) {
  const error = new Error(code)
  error.status = status
  return error
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  }
  return value
}

export function digestAgentActionInput({ tenantId, businessId, requesterPersonId, requesterExternalIdentityId, actionName, target, payload }) {
  const canonical = JSON.stringify(stableValue({
    tenantId, businessId, requesterPersonId, requesterExternalIdentityId, actionName, target, payload,
  }))
  return createHash('sha256').update(canonical).digest('hex')
}

function reviewInputSummary(action, payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw approvalError('AGENT_ACTION_INPUT_INVALID', 400)
  }
  if (action.name === 'set_customer_lifecycle') {
    if (typeof payload.lifecycleStage !== 'string' || !CUSTOMER_LIFECYCLE.includes(payload.lifecycleStage)) {
      throw approvalError('AGENT_ACTION_INPUT_INVALID', 400)
    }
    return { lifecycleStage: payload.lifecycleStage }
  }
  return {}
}

function safeFailureCode(error, fallback = 'AGENT_APPROVAL_REFUSED') {
  if (error?.code === 'P2002') return 'AGENT_APPROVAL_DECISION_DUPLICATE'
  const code = /^[A-Z][A-Z0-9_]+/.exec(error?.message || '')?.[0]
  return code && (code.startsWith('AGENT_') || code.startsWith('STEP_UP_')) ? code : fallback
}

function targetIdFor(action, target) {
  const field = action.targetField
  if (!field || !target || typeof target !== 'object' || Array.isArray(target)) {
    throw approvalError('AGENT_ACTION_TARGET_INVALID', 400)
  }
  const allowedFields = new Set([field, 'businessId'])
  if (Object.keys(target).some((key) => !allowedFields.has(key)) ||
      (Object.hasOwn(target, 'businessId') && (typeof target.businessId !== 'string' || !target.businessId.trim() || target.businessId !== target.businessId.trim()))) {
    throw approvalError('AGENT_ACTION_TARGET_INVALID', 400)
  }
  const id = field && target?.[field]
  if (typeof id !== 'string' || !id.trim()) throw approvalError('AGENT_ACTION_TARGET_REQUIRED', 400)
  if (id !== id.trim()) throw approvalError('AGENT_ACTION_TARGET_INVALID', 400)
  return { field, id }
}

function requestTarget(request) {
  return {
    targetKind: request.targetKind,
    targetId: request.conversationId ?? request.customerId,
  }
}

function publicApprovalRequest(request) {
  const safeRequest = { ...request }
  delete safeRequest.requesterExternalIdentityId
  delete safeRequest.inputDigest
  delete safeRequest.inputSummaryJson
  return safeRequest
}

export async function resolveActionTarget(db, { tenantId, action, target }) {
  const { field, id } = targetIdFor(action, target)
  let record
  if (action.targetKind === 'CONVERSATION' && field === 'conversationId') {
    record = await db.conversation.findFirst({ where: { id, tenantId } })
  } else if (action.targetKind === 'CUSTOMER' && field === 'customerId') {
    record = await db.customer.findFirst({ where: { id, tenantId, deletedAt: null } })
  } else {
    throw new Error('AGENT_ACTION_TARGET_UNSUPPORTED')
  }
  if (!record) throw new Error('AGENT_ACTION_TARGET_NOT_FOUND')
  if (!record.businessId) throw new Error('AGENT_ACTION_BUSINESS_SCOPE_REQUIRED')
  if (target.businessId && target.businessId !== record.businessId) throw new Error('AGENT_ACTION_TARGET_SCOPE_MISMATCH')
  const [tenant, business] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { id: true, status: true } }),
    db.business.findUnique({ where: { id: record.businessId }, select: { id: true, tenantId: true, status: true } }),
  ])
  if (!tenant || tenant.status !== 'ACTIVE' || !business || business.tenantId !== tenantId || business.status !== 'ACTIVE') {
    throw new Error('AGENT_ACTION_BUSINESS_SCOPE_DENIED')
  }
  const targetVersion = action.targetKind === 'CUSTOMER'
    ? `v:${record.version}`
    : `s:${record.status}|u:${new Date(record.updatedAt).toISOString()}`
  return { record, field, targetId: id, businessId: record.businessId, targetVersion }
}

function targetForeignKey(action, targetId) {
  if (action.targetKind === 'CONVERSATION') return { conversationId: targetId, customerId: null }
  if (action.targetKind === 'CUSTOMER') return { conversationId: null, customerId: targetId }
  throw new Error('AGENT_ACTION_TARGET_UNSUPPORTED')
}

export async function assertDirectBusinessOwner(db, { personId, tenantId, businessId, now = new Date() }) {
  const eligible = await listActiveDirectBusinessOwnerIds({
    personIds: [personId], tenantId, businessId, now, db,
  })
  if (!eligible.includes(personId)) {
    throw approvalError('AGENT_APPROVAL_OWNER_REQUIRED', 403)
  }
  return true
}

async function currentTargetVersion(db, request) {
  if (request.targetKind === 'CONVERSATION' && request.conversationId) {
    const row = await db.conversation.findFirst({ where: { id: request.conversationId, tenantId: request.tenantId } })
    if (!row || row.businessId !== request.businessId) return null
    return `s:${row.status}|u:${new Date(row.updatedAt).toISOString()}`
  }
  if (request.targetKind === 'CUSTOMER' && request.customerId) {
    const row = await db.customer.findFirst({ where: { id: request.customerId, tenantId: request.tenantId, deletedAt: null } })
    if (!row || row.businessId !== request.businessId) return null
    return `v:${row.version}`
  }
  return null
}

async function eligibleApprovalPeople(db, request, now) {
  const decisions = await db.agentApprovalDecision.findMany({
    where: { requestId: request.id, tenantId: request.tenantId, businessId: request.businessId, decision: 'APPROVE' },
    select: { personId: true },
  })
  const ids = [...new Set(decisions.map(({ personId }) => personId).filter((id) => id !== request.requesterPersonId))]
  if (!ids.length) return []
  return listActiveDirectBusinessOwnerIds({
    personIds: ids, tenantId: request.tenantId, businessId: request.businessId, now, db,
  })
}

async function markTerminal(db, request, status, actorId, reason, actorType = 'LOCAL_USER') {
  const changed = await db.agentApprovalRequest.updateMany({
    where: { id: request.id, status: request.status, version: request.version },
    data: { status, version: { increment: 1 } },
  })
  if (changed.count !== 1) throw approvalError('AGENT_APPROVAL_REQUEST_NOT_OPEN', 409)
  const updated = await db.agentApprovalRequest.findUnique({ where: { id: request.id } })
  await recordAudit(db, {
    entityType: 'AGENT_APPROVAL_REQUEST', entityId: request.id, action: status,
    actorType, actorId, tenantId: request.tenantId, businessId: request.businessId,
    payload: { requestId: request.id, actionName: request.actionName, ...requestTarget(request), reason },
  })
  return updated
}

export async function createAgentApprovalRequest(db, {
  tenantId, requesterPersonId, requesterExternalIdentityId, action, target, payload,
}) {
  const tier = action.approvalTier
  const quorum = QUORUM_BY_TIER[tier]
  if (!quorum) throw new Error('AGENT_APPROVAL_TIER_INVALID')
  const requesterIdentity = await db.externalIdentity.findFirst({
    where: {
      id: requesterExternalIdentityId,
      tenantId,
      personId: requesterPersonId,
      provider: 'LINE',
      revokedAt: null,
    },
    select: { id: true },
  })
  if (!requesterIdentity) throw approvalError('AGENT_ACTION_DENIED', 403)
  const bound = await resolveActionTarget(db, { tenantId, action, target })
  const context = await resolveAuthorizationContext({
    personId: requesterPersonId, tenantId, businessId: bound.businessId, action: 'WRITE', db,
  })
  const authorization = authorizeScope(context, {
    action: 'WRITE', businessId: bound.businessId, requiredRoles: action.allowRoles,
  })
  if (!authorization.allowed) throw approvalError('AGENT_ACTION_DENIED', 403)
  const request = await db.agentApprovalRequest.create({
    data: {
      tenantId, businessId: bound.businessId, requesterPersonId,
      requesterExternalIdentityId: requesterIdentity.id, actionName: action.name,
      tier: Number(tier.slice(1)), quorum, targetKind: action.targetKind,
      ...targetForeignKey(action, bound.targetId), targetVersion: bound.targetVersion,
      inputSummaryJson: JSON.stringify(reviewInputSummary(action, payload)),
      inputDigest: digestAgentActionInput({
        tenantId, businessId: bound.businessId, requesterPersonId,
        requesterExternalIdentityId: requesterIdentity.id,
        actionName: action.name, target, payload,
      }),
      status: 'PENDING', expiresAt: new Date(Date.now() + REQUEST_LIFETIME_MS),
    },
  })
  await recordAudit(db, {
    entityType: 'AGENT_APPROVAL_REQUEST', entityId: request.id, action: 'CREATED', actorType: 'AGENT',
    actorId: requesterPersonId, tenantId, businessId: bound.businessId,
    payload: { requestId: request.id, actionName: action.name, tier, quorum, ...requestTarget(request) },
  })
  return request
}

export async function listAgentApprovalQueue(db, { personId, businessId, now = new Date() }) {
  const business = await db.business.findUnique({ where: { id: businessId }, select: { id: true, tenantId: true } })
  if (!business) throw new Error('AGENT_APPROVAL_BUSINESS_NOT_FOUND')
  await assertDirectBusinessOwner(db, { personId, tenantId: business.tenantId, businessId, now })
  const requests = await db.agentApprovalRequest.findMany({
    where: { tenantId: business.tenantId, businessId, status: 'PENDING', expiresAt: { gt: now } },
    orderBy: { createdAt: 'asc' },
    include: { requester: { select: { id: true, displayName: true } }, decisions: { select: { personId: true, decision: true } } },
  })
  return Promise.all(requests.map(async ({ requester, decisions, inputDigest, inputSummaryJson, ...request }) => ({
    ...publicApprovalRequest(request),
    requester: { id: requester.id, displayName: requester.displayName },
    inputSummary: JSON.parse(inputSummaryJson || '{}'),
    decisionCount: decisions.length,
    approvedCount: (await eligibleApprovalPeople(db, request, now)).length,
    decidedByMe: decisions.some(({ personId: voterId }) => voterId === personId),
  })))
}

export async function decideAgentApprovalRequest(db, { requestId, personId, decision, now = new Date() }) {
  if (decision !== 'APPROVE' && decision !== 'REJECT') throw approvalError('AGENT_APPROVAL_DECISION_INVALID', 400)
  try {
    return await db.$transaction(async (tx) => {
      const request = await tx.agentApprovalRequest.findUnique({ where: { id: requestId } })
      if (!request) throw approvalError('AGENT_APPROVAL_REQUEST_NOT_FOUND', 404)
      await assertDirectBusinessOwner(tx, { personId, tenantId: request.tenantId, businessId: request.businessId, now })
      if (personId === request.requesterPersonId) throw approvalError('AGENT_APPROVAL_REQUESTER_CANNOT_VOTE', 403)
      if (TERMINAL_STATUSES.has(request.status) || request.status !== 'PENDING') {
        throw approvalError('AGENT_APPROVAL_REQUEST_NOT_OPEN', 409)
      }
      const rejectedDecision = await tx.agentApprovalDecision.findFirst({
        where: { requestId: request.id, tenantId: request.tenantId, businessId: request.businessId, decision: 'REJECT' },
        select: { id: true },
      })
      if (rejectedDecision) {
        const rejected = await markTerminal(tx, request, 'REJECTED', personId, 'a REJECT decision already exists')
        return { request: publicApprovalRequest(rejected), decision: null }
      }
      if (request.expiresAt.getTime() <= now.getTime()) {
        const expired = await markTerminal(tx, request, 'EXPIRED', personId, 'fixed 24-hour expiry elapsed')
        return { request: publicApprovalRequest(expired), decision: null }
      }
      const liveVersion = await currentTargetVersion(tx, request)
      if (liveVersion !== request.targetVersion) {
        const stale = await markTerminal(tx, request, 'STALE', personId, 'target version or scope changed')
        return { request: publicApprovalRequest(stale), decision: null }
      }
      const eligible = decision === 'APPROVE' ? await eligibleApprovalPeople(tx, request, now) : []
      const actionTier = `L${request.tier}`
      const quorum = QUORUM_BY_TIER[actionTier]
      const nextStatus = decision === 'REJECT'
        ? 'REJECTED'
        : quorum && new Set([...eligible, personId]).size >= quorum ? 'APPROVED' : 'PENDING'
      const claimed = await tx.agentApprovalRequest.updateMany({
        where: { id: request.id, status: 'PENDING', version: request.version },
        data: { status: nextStatus, version: { increment: 1 } },
      })
      if (claimed.count !== 1) throw approvalError('AGENT_APPROVAL_REQUEST_CONFLICT', 409)
      const row = await tx.agentApprovalDecision.create({
        data: { requestId, tenantId: request.tenantId, businessId: request.businessId, personId, decision },
      })
      await recordAudit(tx, {
        entityType: 'AGENT_APPROVAL_DECISION', entityId: row.id, action: decision,
        actorType: 'LOCAL_USER', actorId: personId, tenantId: request.tenantId, businessId: request.businessId,
        payload: { requestId: request.id, actionName: request.actionName, decision, ...requestTarget(request) },
      })
      const updated = await tx.agentApprovalRequest.findUnique({ where: { id: request.id } })
      return { request: publicApprovalRequest(updated), decision: row }
    })
  } catch (error) {
    const mappedError = error?.code === 'P2002'
      ? approvalError('AGENT_APPROVAL_DECISION_DUPLICATE', 409)
      : error
    const request = typeof requestId === 'string' && requestId
      ? await db.agentApprovalRequest.findUnique({
          where: { id: requestId }, select: { id: true, tenantId: true, businessId: true, actionName: true, targetKind: true, conversationId: true, customerId: true },
        })
      : null
    if (request) {
      await recordAudit(db, {
        entityType: 'AGENT_APPROVAL_DECISION', entityId: requestId, action: 'DENIED',
        actorType: 'LOCAL_USER', actorId: personId, tenantId: request.tenantId, businessId: request.businessId,
        payload: { requestId, actionName: request.actionName, ...requestTarget(request), reason: safeFailureCode(mappedError) },
      })
    }
    throw mappedError
  }
}

export async function consumeAgentApprovalRequest(tx, {
  requestId, tenantId, requesterPersonId, action, target, payload, principal, now = new Date(),
}) {
  const request = await tx.agentApprovalRequest.findUnique({ where: { id: requestId } })
  if (!request || request.tenantId !== tenantId || request.requesterPersonId !== requesterPersonId || request.actionName !== action.name) {
    throw approvalError('AGENT_APPROVAL_REQUEST_BINDING_MISMATCH', request ? 409 : 404)
  }
  const rejectedDecision = await tx.agentApprovalDecision.findFirst({
    where: { requestId: request.id, tenantId, businessId: request.businessId, decision: 'REJECT' },
    select: { id: true },
  })
  if (request.status === 'REJECTED' || rejectedDecision) {
    if (request.status === 'PENDING' && rejectedDecision) {
      await markTerminal(tx, request, 'REJECTED', requesterPersonId, 'a REJECT decision already exists', 'AGENT')
      return { blocked: 'AGENT_APPROVAL_REJECTED' }
    }
    throw approvalError('AGENT_APPROVAL_REJECTED', 409)
  }
  if (TERMINAL_STATUSES.has(request.status) || !['PENDING', 'APPROVED'].includes(request.status)) {
    throw approvalError('AGENT_APPROVAL_REQUEST_NOT_OPEN', 409)
  }
  if (request.expiresAt.getTime() <= now.getTime()) {
    await markTerminal(tx, request, 'EXPIRED', requesterPersonId, 'fixed 24-hour expiry elapsed', 'AGENT')
    return { blocked: 'AGENT_APPROVAL_EXPIRED' }
  }
  let bound
  try {
    bound = await resolveActionTarget(tx, { tenantId, action, target })
  } catch (error) {
    const code = safeFailureCode(error, '')
    if (['AGENT_ACTION_TARGET_NOT_FOUND', 'AGENT_ACTION_TARGET_SCOPE_MISMATCH', 'AGENT_ACTION_BUSINESS_SCOPE_REQUIRED', 'AGENT_ACTION_BUSINESS_SCOPE_DENIED'].includes(code)) {
      await markTerminal(tx, request, 'STALE', requesterPersonId, 'target was removed or its active scope changed', 'AGENT')
      return { blocked: 'AGENT_APPROVAL_BINDING_MISMATCH' }
    }
    throw error
  }
  const digest = digestAgentActionInput({
    tenantId, businessId: bound.businessId, requesterPersonId,
    requesterExternalIdentityId: principal?.externalIdentityId,
    actionName: action.name, target, payload,
  })
  const storedTargetId = action.targetKind === 'CONVERSATION' ? request.conversationId : request.customerId
  if (request.requesterExternalIdentityId !== principal?.externalIdentityId ||
      request.businessId !== bound.businessId || storedTargetId !== bound.targetId ||
      request.targetKind !== action.targetKind || request.targetVersion !== bound.targetVersion || request.inputDigest !== digest) {
    await markTerminal(tx, request, 'STALE', requesterPersonId, 'request binding or target changed', 'AGENT')
    return { blocked: 'AGENT_APPROVAL_BINDING_MISMATCH' }
  }
  const freshContext = await resolveAuthorizationContext({
    personId: requesterPersonId, tenantId, businessId: request.businessId, action: 'WRITE', db: tx,
  })
  const authorization = authorizeScope(freshContext, {
    action: 'WRITE', businessId: request.businessId, requiredRoles: action.allowRoles,
  })
  if (!authorization.allowed) {
    await markTerminal(tx, request, 'STALE', requesterPersonId, 'requester authorization is no longer active', 'AGENT')
    return { blocked: 'AGENT_ACTION_DENIED' }
  }
  const eligible = await eligibleApprovalPeople(tx, request, now)
  const tier = `L${request.tier}`
  if (action.approvalTier !== tier || request.quorum !== QUORUM_BY_TIER[tier]) {
    await markTerminal(tx, request, 'STALE', requesterPersonId, 'current active same-Business OWNER quorum no longer holds', 'AGENT')
    return { blocked: 'AGENT_APPROVAL_QUORUM_INVALID' }
  }
  const external = await tx.externalIdentity.findFirst({
    where: {
      id: request.requesterExternalIdentityId,
      tenantId,
      personId: requesterPersonId,
      provider: 'LINE',
      revokedAt: null,
    },
    select: { id: true },
  })
  if (!external || principal?.externalIdentityId !== request.requesterExternalIdentityId) {
    await markTerminal(tx, request, 'STALE', requesterPersonId, 'requester LINE Identity changed or is no longer active', 'AGENT')
    return { blocked: 'AGENT_APPROVAL_BINDING_MISMATCH' }
  }
  if (eligible.length < request.quorum) {
    if (request.status === 'PENDING') return { pending: true, request }
    await markTerminal(tx, request, 'STALE', requesterPersonId, 'current active same-Business OWNER quorum no longer holds', 'AGENT')
    return { blocked: 'AGENT_APPROVAL_QUORUM_INVALID' }
  }
  if (request.status === 'PENDING') {
    const approved = await tx.agentApprovalRequest.updateMany({
      where: { id: request.id, status: 'PENDING', version: request.version },
      data: { status: 'APPROVED', version: { increment: 1 } },
    })
    if (approved.count !== 1) throw approvalError('AGENT_APPROVAL_REQUEST_CONFLICT', 409)
    await recordAudit(tx, {
      entityType: 'AGENT_APPROVAL_REQUEST', entityId: request.id, action: 'APPROVED',
      actorType: 'AGENT', actorId: requesterPersonId, tenantId, businessId: request.businessId,
      payload: { requestId: request.id, actionName: request.actionName, quorum: request.quorum, ...requestTarget(request) },
    })
    const promoted = await tx.agentApprovalRequest.findUnique({ where: { id: request.id } })
    request.status = promoted.status
    request.version = promoted.version
    request.updatedAt = promoted.updatedAt
  }
  const executed = await tx.agentApprovalRequest.updateMany({
    where: { id: request.id, status: 'APPROVED', version: request.version },
    data: { status: 'EXECUTED', version: { increment: 1 } },
  })
  if (executed.count !== 1) throw approvalError('AGENT_APPROVAL_REQUEST_CONFLICT', 409)
  await recordAudit(tx, {
    entityType: 'AGENT_APPROVAL_REQUEST', entityId: request.id, action: 'EXECUTED',
    actorType: 'AGENT', actorId: requesterPersonId, tenantId, businessId: request.businessId,
    payload: { requestId: request.id, actionName: request.actionName, ...requestTarget(request) },
  })
  const executedRequest = await tx.agentApprovalRequest.findUnique({ where: { id: request.id } })
  return { blocked: null, request: executedRequest, businessId: request.businessId, targetVersion: request.targetVersion, stepUpNotBefore: request.updatedAt }
}

export const AGENT_APPROVAL_QUORUM = QUORUM_BY_TIER
