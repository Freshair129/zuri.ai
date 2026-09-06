import { recordAudit } from '@/modules/project-manager/application/audit'

// @req FR-022, FR-149 — principal erasure also removes copied conversation-job content and delivery capabilities.
// @spec ADR-061, SEC-001, SEC-005 — the Studio owns this writer; identity composes it in the erasure transaction.
// @tested tests/integration/server-line-jobs.test.js

/** Retain an internal tombstone, never a resumable send or an addressable provider identity. */
export async function redactLineConversationJobs(tx, { tenantId, conversationIds }) {
  if (!tenantId || !Array.isArray(conversationIds) || conversationIds.length === 0) return { redactedLineJobs: 0 }
  const jobs = await tx.lineConversationJob.findMany({
    where: {
      tenantId,
      inbound: { conversation: { tenantId, id: { in: conversationIds } } },
      OR: [{ errorCode: null }, { errorCode: { not: 'PDPA_ERASURE' } }],
    },
    select: { id: true, accountId: true, status: true },
    orderBy: [{ accountId: 'asc' }, { id: 'asc' }],
  })
  for (const job of jobs) {
    // SENDING may already have reached LINE. Erasure cannot retract that fact;
    // UNKNOWN remains a payload-free tombstone instead of a false safe failure.
    const status = job.status === 'SENDING' || job.status === 'UNKNOWN' ? 'UNKNOWN' : 'CANCELLED'
    await tx.lineConversationJob.update({ where: { id: job.id }, data: {
      status,
      answerText: null,
      recipientId: '[erased]',
      sourceUserId: '[erased]',
      eventId: `erased:${job.id}`,
      sealedReplyToken: null,
      replyExpiresAt: null,
      claimantId: null,
      leaseExpiresAt: null,
      providerRequestId: null,
      providerMessageId: null,
      errorCode: 'PDPA_ERASURE',
      version: { increment: 1 },
    } })
    await recordAudit(tx, { entityType: 'LINE_CONVERSATION_JOB', entityId: job.id, action: 'CONTENT_ERASED',
      payload: { tenantId, accountId: job.accountId, status, possibleDelivery: status === 'UNKNOWN' } })
  }
  return { redactedLineJobs: jobs.length }
}
