import { listActiveDirectBusinessOwnerIds } from '@/modules/identity/authorization-context'

function notificationError(code, status) {
  const error = new Error(code)
  error.status = status
  return error
}

function safeNotification(row, now = new Date()) {
  const currentRequestStatus = row.approvalRequest?.status ?? null
  const expiresAt = row.approvalRequest?.expiresAt
  return {
    id: row.id,
    businessId: row.businessId,
    approvalRequestId: row.approvalRequestId,
    currentRequestStatus,
    actionable: row.notificationType === 'OWNER_NEXT_ACTION' &&
      currentRequestStatus === 'PENDING' && expiresAt instanceof Date && expiresAt > now,
    decisionId: row.decisionId,
    notificationType: row.notificationType,
    decision: row.decision,
    approvalStatus: row.approvalStatus,
    createdAt: row.createdAt,
    readAt: row.readAt,
  }
}

/**
 * Persist requester and remaining direct-owner notices inside the approval
 * transaction. The unique decision/recipient key makes the fan-out idempotent.
 */
export async function recordAgentApprovalDecisionNotifications(tx, {
  request,
  decision,
  approvalStatus,
  now = new Date(),
}) {
  const [owners, votes] = await Promise.all([
    listActiveDirectBusinessOwnerIds({
      tenantId: request.tenantId,
      businessId: request.businessId,
      now,
      db: tx,
    }),
    tx.agentApprovalDecision.findMany({
      where: {
        requestId: request.id,
        tenantId: request.tenantId,
        businessId: request.businessId,
      },
      select: { personId: true },
    }),
  ])
  const voted = new Set(votes.map(({ personId }) => personId))
  const recipients = new Map([[request.requesterPersonId, 'REQUESTER_OUTCOME']])
  for (const ownerId of owners) {
    if (ownerId !== request.requesterPersonId && !voted.has(ownerId)) {
      recipients.set(ownerId, approvalStatus === 'PENDING' ? 'OWNER_NEXT_ACTION' : 'OWNER_OUTCOME')
    }
  }

  for (const [recipientPersonId, notificationType] of recipients) {
    await tx.agentApprovalNotification.create({
      data: {
        tenantId: request.tenantId,
        businessId: request.businessId,
        recipientPersonId,
        approvalRequestId: request.id,
        decisionId: decision.id,
        notificationType,
        decision: decision.decision,
        approvalStatus,
        createdAt: now,
      },
    })
  }
  return recipients.size
}

/** List only rows owned by the authenticated principal, newest first. */
export async function listAgentApprovalNotifications(db, { personId, limit = 100 }) {
  const safeLimit = Number.isInteger(limit) ? Math.min(Math.max(limit, 1), 100) : 100
  const rows = await db.agentApprovalNotification.findMany({
    where: { recipientPersonId: personId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: safeLimit,
    select: {
      id: true,
      businessId: true,
      approvalRequestId: true,
      decisionId: true,
      notificationType: true,
      decision: true,
      approvalStatus: true,
      createdAt: true,
      readAt: true,
      approvalRequest: { select: { status: true, expiresAt: true } },
    },
  })
  const now = new Date()
  return rows.map((row) => safeNotification(row, now))
}

export async function countAgentApprovalUnreadNotifications(db, { personId }) {
  return db.agentApprovalNotification.count({ where: { recipientPersonId: personId, readAt: null } })
}

/**
 * Mark one recipient's notice read. Repeating the same request is successful
 * and leaves the original acknowledgement timestamp unchanged.
 */
export async function markAgentApprovalNotificationRead(db, { notificationId, personId, now = new Date() }) {
  const changed = await db.agentApprovalNotification.updateMany({
    where: { id: notificationId, recipientPersonId: personId, readAt: null },
    data: { readAt: now },
  })
  const row = await db.agentApprovalNotification.findFirst({
    where: { id: notificationId, recipientPersonId: personId },
    select: {
      id: true,
      businessId: true,
      approvalRequestId: true,
      decisionId: true,
      notificationType: true,
      decision: true,
      approvalStatus: true,
      createdAt: true,
      readAt: true,
      approvalRequest: { select: { status: true, expiresAt: true } },
    },
  })
  if (!row) throw notificationError('AGENT_APPROVAL_NOTIFICATION_NOT_FOUND', 404)
  if (!changed.count && !row.readAt) throw notificationError('AGENT_APPROVAL_NOTIFICATION_UPDATE_FAILED', 409)
  return safeNotification(row, now)
}
