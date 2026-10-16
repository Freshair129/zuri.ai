import { createHash } from 'node:crypto'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { authorizeScope, resolveAuthorizationContext } from '@/modules/identity/authorization-context'
import { listActiveDirectBusinessOwnerIds } from '@/modules/identity/authorization-context'

const QUORUM_BY_TIER = Object.freeze({ L1: 1, L2: 2, L3: 3, L4: 4 })
const REQUEST_LIFETIME_MS = 24 * 60 * 60 * 1000
const TERMINAL_STATUSES = new Set(['REJECTED', 'EXPIRED', 'STALE', 'EXECUTED', 'RESTORE_INVALIDATED'])

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  }
  return value
}

export function digestAgentActionInput({ tenantId, businessId, requesterPersonId, actionName, target, payload }) {
  const canonical = JSON.stringify(stableValue({ tenantId, businessId, requesterPersonId, actionName, target, payload }))
  return createHash('sha256').update(canonical).digest('hex')
}

function reviewInputSummary(action, payload) {
  if (action.name === 'set_customer_lifecycle') {
    if (typeof payload.lifecycleStage !== 'string' || !payload.lifecycleStage.trim() || payload.lifecycleStage.length > 64) {
      throw new Error('AGENT_ACTION_INPUT_INVALID')
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
  const id = field && target?.[field]
  if (typeof id !== 'string' || !id.trim()) throw new Error('AGENT_ACTION_TARGET_REQUIRED')
  return { field, id: id.trim() }
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
    const error = new Error('AGENT_APPROVAL_OWNER_REQUIRED')
    error.status = 400
    throw error
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

async function markTerminal(db, request, status, actorId, reason) {
  const updated = await db.agentApprovalRequest.update({
    where: { id: request.id },
    data: { status, version: { increment: 1 } },
  })
  await recordAudit(db, {
    entityType: 'AGENT_APPROVAL_REQUEST', entityId: request.id, action: status,
    actorType: 'LOCAL_USER', actorId, tenantId: request.tenantId, businessId: request.businessId,
    payload: { requestId: request.id, actionName: request.actionName, reason },
  })
  return updated
}

export async function createAgentApprovalRequest(db, { tenantId, requesterPersonId, action, target, payload }) {
  const tier = action.approvalTier
  const quorum = QUORUM_BY_TIER[tier]
  if (!quorum) throw new Error('AGENT_APPROVAL_TIER_INVALID')
  const bound = await resolveActionTarget(db, { tenantId, action, target })
  const context = await resolveAuthorizationContext({
    personId: requesterPersonId, tenantId, businessId: bound.businessId, action: 'WRITE', db,
  })
  const authorization = authorizeScope(context, {
    action: 'WRITE', businessId: bound.businessId, requiredRoles: action.allowRoles,
  })
  if (!authorization.allowed) throw new Error('AGENT_ACTION_DENIED')
  const request = await db.agentApprovalRequest.create({
    data: {
      tenantId, businessId: bound.businessId, requesterPersonId, actionName: action.name,
      tier: Number(tier.slice(1)), quorum, targetKind: action.targetKind,
      ...targetForeignKey(action, bound.targetId), targetVersion: bound.targetVersion,
      inputSummaryJson: JSON.stringify(reviewInputSummary(action, payload)),
      inputDigest: digestAgentActionInput({ tenantId, businessId: bound.businessId, requesterPersonId, actionName: action.name, target, payload }),
      status: 'PENDING', expiresAt: new Date(Date.now() + REQUEST_LIFETIME_MS),
    },
  })
  await recordAudit(db, {
    entityType: 'AGENT_APPROVAL_REQUEST', entityId: request.id, action: 'CREATED', actorType: 'AGENT',
    actorId: requesterPersonId, tenantId, businessId: bound.businessId,
    payload: { requestId: request.id, actionName: action.name, tier, quorum, targetKind: action.targetKind },
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
    ...request,
    requester: { id: requester.id, displayName: requester.displayName },
    inputSummary: JSON.parse(inputSummaryJson || '{}'),
    decisionCount: decisions.length,
    approvedCount: (await eligibleApprovalPeople(db, request, now)).length,
    decidedByMe: decisions.some(({ personId: voterId }) => voterId === personId),
  })))
}

export async function decideAgentApprovalRequest(db, { requestId, personId, decision, now = new Date() }) {
  if (decision !== 'APPROVE' && decision !== 'REJECT') throw new Error('AGENT_APPROVAL_DECISION_INVALID')
  try {
    return await db.$transaction(async (tx) => {
      const request = await tx.agentApprovalRequest.findUnique({ where: { id: requestId } })
      if (!request) throw new Error('AGENT_APPROVAL_REQUEST_NOT_FOUND')
      await assertDirectBusinessOwner(tx, { personId, tenantId: request.tenantId, businessId: request.businessId, now })
      if (personId === request.requesterPersonId) throw new Error('AGENT_APPROVAL_REQUESTER_CANNOT_VOTE')
      if (TERMINAL_STATUSES.has(request.status) || request.status === 'APPROVED') throw new Error('AGENT_APPROVAL_REQUEST_NOT_OPEN')
      if (request.expiresAt.getTime() <= now.getTime()) {
        const expired = await markTerminal(tx, request, 'EXPIRED', personId, 'fixed 24-hour expiry elapsed')
        return { request: expired, decision: null }
      }
      const liveVersion = await currentTargetVersion(tx, request)
      if (liveVersion !== request.targetVersion) {
        const stale = await markTerminal(tx, request, 'STALE', personId, 'target version or scope changed')
        return { request: stale, decision: null }
      }
      const row = await tx.agentApprovalDecision.create({
        data: { requestId, tenantId: request.tenantId, businessId: request.businessId, personId, decision },
      })
      if (decision === 'REJECT') {
        await tx.agentApprovalRequest.update({ where: { id: request.id }, data: { status: 'REJECTED', version: { increment: 1 } } })
      } else {
        const eligible = await eligibleApprovalPeople(tx, request, now)
        const actionTier = `L${request.tier}`
        const quorum = QUORUM_BY_TIER[actionTier]
        const status = quorum && eligible.length >= quorum ? 'APPROVED' : 'PENDING'
        await tx.agentApprovalRequest.update({ where: { id: request.id }, data: { status, version: { increment: 1 } } })
      }
      await recordAudit(tx, {
        entityType: 'AGENT_APPROVAL_DECISION', entityId: row.id, action: decision,
        actorType: 'LOCAL_USER', actorId: personId, tenantId: request.tenantId, businessId: request.businessId,
        payload: { requestId: request.id, actionName: request.actionName, decision },
      })
      const updated = await tx.agentApprovalRequest.findUnique({ where: { id: request.id } })
      return { request: updated, decision: row }
    })
  } catch (error) {
    const request = await db.agentApprovalRequest.findUnique({
      where: { id: requestId }, select: { id: true, tenantId: true, businessId: true, actionName: true },
    })
    if (request) {
      await recordAudit(db, {
        entityType: 'AGENT_APPROVAL_DECISION', entityId: requestId, action: 'DENIED',
        actorType: 'LOCAL_USER', actorId: personId, tenantId: request.tenantId, businessId: request.businessId,
        payload: { requestId, actionName: request.actionName, reason: safeFailureCode(error) },
      })
    }
    throw error
  }
}

export async function consumeAgentApprovalRequest(tx, {
  requestId, tenantId, requesterPersonId, action, target, payload, principal, now = new Date(),
}) {
  const request = await tx.agentApprovalRequest.findUnique({ where: { id: requestId } })
  if (!request || request.tenantId !== tenantId || request.requesterPersonId !== requesterPersonId || request.actionName !== action.name) {
    throw new Error('AGENT_APPROVAL_REQUEST_BINDING_MISMATCH')
  }
  if (request.expiresAt.getTime() <= now.getTime()) {
    await markTerminal(tx, request, 'EXPIRED', requesterPersonId, 'fixed 24-hour expiry elapsed')
    return { blocked: 'AGENT_APPROVAL_EXPIRED' }
  }
  if (request.status === 'PENDING') {
    const pendingEligible = await eligibleApprovalPeople(tx, request, now)
    const pendingTier = `L${request.tier}`
    if (request.quorum === QUORUM_BY_TIER[pendingTier] && pendingEligible.length >= request.quorum) {
      await tx.agentApprovalRequest.update({ where: { id: request.id }, data: { status: 'APPROVED', version: { increment: 1 } } })
      await recordAudit(tx, {
        entityType: 'AGENT_APPROVAL_REQUEST', entityId: request.id, action: 'APPROVED',
        actorType: 'AGENT', actorId: requesterPersonId, tenantId, businessId: request.businessId,
        payload: { requestId: request.id, actionName: request.actionName, quorum: request.quorum },
      })
      request.status = 'APPROVED'
    }
  }
  if (request.status !== 'APPROVED') throw new Error(`AGENT_APPROVAL_NOT_APPROVED: ${request.status}`)
  const bound = await resolveActionTarget(tx, { tenantId, action, target })
  const digest = digestAgentActionInput({ tenantId, businessId: bound.businessId, requesterPersonId, actionName: action.name, target, payload })
  const storedTargetId = action.targetKind === 'CONVERSATION' ? request.conversationId : request.customerId
  if (request.businessId !== bound.businessId || storedTargetId !== bound.targetId ||
      request.targetKind !== action.targetKind || request.targetVersion !== bound.targetVersion || request.inputDigest !== digest) {
    await markTerminal(tx, request, 'STALE', requesterPersonId, 'request binding or target changed')
    return { blocked: 'AGENT_APPROVAL_BINDING_MISMATCH' }
  }
  const freshContext = await resolveAuthorizationContext({
    personId: requesterPersonId, tenantId, businessId: request.businessId, action: 'WRITE', db: tx,
  })
  const authorization = authorizeScope(freshContext, {
    action: 'WRITE', businessId: request.businessId, requiredRoles: action.allowRoles,
  })
  if (!authorization.allowed) {
    await markTerminal(tx, request, 'STALE', requesterPersonId, 'requester authorization is no longer active')
    return { blocked: 'AGENT_ACTION_DENIED' }
  }
  const eligible = await eligibleApprovalPeople(tx, request, now)
  const tier = `L${request.tier}`
  if (action.approvalTier !== tier || request.quorum !== QUORUM_BY_TIER[tier] || eligible.length < request.quorum) {
    await markTerminal(tx, request, 'STALE', requesterPersonId, 'current active same-Business OWNER quorum no longer holds')
    return { blocked: 'AGENT_APPROVAL_QUORUM_INVALID' }
  }
  const external = await tx.externalIdentity.findFirst({
    where: { tenantId, personId: requesterPersonId, provider: 'LINE', revokedAt: null },
    select: { id: true },
  })
  if (!external) {
    await markTerminal(tx, request, 'STALE', requesterPersonId, 'requester LINE Identity is no longer active')
    return { blocked: 'AGENT_ACTION_DENIED' }
  }
  await tx.agentApprovalRequest.update({ where: { id: request.id }, data: { status: 'EXECUTED', version: { increment: 1 } } })
  await recordAudit(tx, {
    entityType: 'AGENT_APPROVAL_REQUEST', entityId: request.id, action: 'EXECUTED',
    actorType: 'AGENT', actorId: requesterPersonId, tenantId, businessId: request.businessId,
    payload: { requestId: request.id, actionName: request.actionName },
  })
  return { blocked: null, request, businessId: request.businessId, targetVersion: request.targetVersion, stepUpNotBefore: request.updatedAt }
}

export const AGENT_APPROVAL_QUORUM = QUORUM_BY_TIER
