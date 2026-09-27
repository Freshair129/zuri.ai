import { recordAudit } from '@/modules/project-manager/application/audit'
import { redactTraceTurn } from '@/modules/agent/execution-trace'
import { appendMemoryDeliveryCheckpoint } from './line-memory-delivery'
import { recordMemoryThreadErasures } from './line-memory-erasure'

// @req FR-022, FR-149 — principal erasure also removes copied conversation-job content and delivery capabilities.
// @req FR-171 — trace snapshots are erased atomically with their conversation jobs.
// @spec ADR-061, SEC-001, SEC-005 — the Studio owns this writer; identity composes it in the erasure transaction.
// @tested tests/integration/server-line-jobs.test.js
// @req FR-022 — a job is also selected by its speaker: `sourceUserId` on the job's own
//   channel account. In a LINE group or room thread every member's turns share one
//   Conversation, so erasing one speaker there must reach that speaker's jobs and no
//   other member's — neither redacting nor cancelling another speaker's turn.
//   The same per-job trace redaction empties an unverified sender's
//   CHANNEL_IDENTITY_ADMITTED record (FR-149), so only the erased speaker's own
//   records lose their authority.
// @tested tests/integration/identity-erase-group-speakers.test.js

/**
 * Retain an internal tombstone, never a resumable send or an addressable provider identity.
 *
 * `conversationIds` erases every job in those threads (a thread that is the erased
 * person's alone). `speakers` — `{channelAccountId, providerSubject}` pairs — erases
 * that speaker's own jobs in any thread of the tenant. Either may be empty; a job
 * matched by both is erased once. Returns the inbound message ids of the jobs it
 * erased, so the caller can redact those messages in the same transaction.
 */
export async function redactLineConversationJobs(tx, { tenantId, conversationIds = [], speakers = [], erasedPrincipalId = null }) {
  const threads = Array.isArray(conversationIds) ? conversationIds.filter(Boolean) : []
  const subjects = (Array.isArray(speakers) ? speakers : [])
    .filter(speaker => typeof speaker?.channelAccountId === 'string' && speaker.channelAccountId
      && typeof speaker?.providerSubject === 'string' && speaker.providerSubject)
  const selectors = [
    ...(threads.length ? [{ inbound: { conversation: { tenantId, id: { in: threads } } } }] : []),
    // Scoped to the channel account: a provider subject names a person only
    // together with the OA it was issued for.
    ...subjects.map(({ channelAccountId, providerSubject }) => ({ channelAccountId, sourceUserId: providerSubject })),
  ]
  if (!tenantId || selectors.length === 0) return { redactedLineJobs: 0, inboundMessageIds: [] }
  const jobs = await tx.lineConversationJob.findMany({
    where: {
      tenantId,
      AND: [
        { OR: selectors },
        { OR: [{ errorCode: null }, { errorCode: { not: 'PDPA_ERASURE' } }] },
      ],
    },
    select: { id: true, accountId: true, status: true, businessId: true, tenantId: true,
      executionId: true, inboundMessageId: true, memorySyncOptIn: true, memoryDeliveryState: true,
      audienceKind: true, recipientId: true, sourceUserId: true, channelAccountId: true,
    },
    orderBy: [{ accountId: 'asc' }, { id: 'asc' }],
  })
  // @req FR-022 — before any job is overwritten: the shared MSP threads this person
  // spoke in with memory sync get a pending, Core-owned principal erasure (W12).
  const { pendingThreads } = await recordMemoryThreadErasures(tx, { tenantId, principalId: erasedPrincipalId, jobs, speakers: subjects })
  for (const job of jobs) {
    // SENDING may already have reached LINE. Erasure cannot retract that fact;
    // UNKNOWN remains a payload-free tombstone instead of a false safe failure.
    const status = job.status === 'SENDING' || job.status === 'UNKNOWN' ? 'UNKNOWN' : 'CANCELLED'
    const redactedAt = new Date()
    if (job.memorySyncOptIn && job.memoryDeliveryState === 'PENDING') {
      // The closure checkpoint must precede the PDPA error update: the trace
      // guard deliberately rejects new payloads after the erasure tombstone.
      await appendMemoryDeliveryCheckpoint(tx, {
        job,
        kind: 'MEMORY_DELIVERY_CLOSED',
        key: `memory-delivery:closed:${job.id}`,
        payload: { jobId: job.id, inboundMessageId: job.inboundMessageId,
          outboundMessageId: null, receiptId: null, channelAccountId: null,
          externalThreadRef: null, providerAcceptance: null, reason: 'PDPA_ERASURE' },
        occurredAt: redactedAt,
      })
    }
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
      ...(job.memorySyncOptIn && job.memoryDeliveryState === 'PENDING'
        ? { memoryDeliveryState: 'CLOSED' } : {}),
      memoryDeliveryNextAttemptAt: null,
      memoryDeliveryLeaseUntil: null,
      version: { increment: 1 },
    } })
    await redactTraceTurn(tx, { scope: { tenantId, businessId: job.businessId }, turnId: job.id, now: redactedAt })
    await recordAudit(tx, { entityType: 'LINE_CONVERSATION_JOB', entityId: job.id, action: 'CONTENT_ERASED',
      payload: { tenantId, accountId: job.accountId, status, possibleDelivery: status === 'UNKNOWN' } })
  }
  return { redactedLineJobs: jobs.length, inboundMessageIds: jobs.map(job => job.inboundMessageId), pendingMemoryThreadErasures: pendingThreads }
}
