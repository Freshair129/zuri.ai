import { recordAudit } from '@/modules/project-manager/application/audit'
import { redactTraceTurn } from '@/modules/agent/execution-trace'
import { appendMemoryDeliveryCheckpoint } from './line-memory-delivery'
import { recordMemoryPrincipalErasure } from './line-memory-erasure'

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
  if (!tenantId || selectors.length === 0) return { redactedLineJobs: 0, erasedMissionDrafts: 0, erasedMissionEvidence: 0, inboundMessageIds: [] }
  const jobs = await tx.lineConversationJob.findMany({
    where: {
      tenantId,
      AND: [
        { OR: selectors },
        { OR: [{ errorCode: null }, { errorCode: { not: 'PDPA_ERASURE' } }] },
      ],
    },
    select: { id: true, accountId: true, status: true, businessId: true, tenantId: true,
      executionId: true, inboundMessageId: true, memorySyncOptIn: true, episodicMemoryOptIn: true, memoryDeliveryState: true,
      audienceKind: true, recipientId: true, sourceUserId: true, channelAccountId: true,
    },
    orderBy: [{ accountId: 'asc' }, { id: 'asc' }],
  })
  // @req TASK-ZAI-012 — the mission evidence feed is private derived provenance.
  // Tombstone it in the same Identity erasure transaction before source job and
  // ChannelIdentity data are redacted; never leave an active source link behind.
  const missionSourceTurnIds = jobs.map(job => job.id)
  const missionEvidenceWhere = {
    tenantId,
    status: { not: 'ERASED' },
    OR: [
      ...(missionSourceTurnIds.length ? [{ sourceTurnId: { in: missionSourceTurnIds } }] : []),
      ...(erasedPrincipalId
        ? [{ actorId: erasedPrincipalId }, { confirmationActorId: erasedPrincipalId }, { submittedByPersonId: erasedPrincipalId }]
        : []),
    ],
  }
  const missionDraftWhere = {
    tenantId,
    status: { not: 'ERASED' },
    OR: [
      ...(missionSourceTurnIds.length ? [{ sourceTurnId: { in: missionSourceTurnIds } }] : []),
      ...(erasedPrincipalId ? [{ actorPersonId: erasedPrincipalId }] : []),
    ],
  }
  const missionDraftsToErase = missionDraftWhere.OR.length
    ? await tx.agentMissionDraft.findMany({
      where: missionDraftWhere,
      select: { id: true, missionId: true, sourceEventId: true, sourceTurnId: true,
        tenantId: true, businessId: true, workspaceId: true, projectId: true,
        workstreamId: true, actorPersonId: true },
    })
    : []
  for (const draft of missionDraftsToErase) {
    if (!draft.missionId || !draft.sourceEventId || !draft.sourceTurnId || !draft.actorPersonId) continue
    const scope = { tenantId: draft.tenantId, businessId: draft.businessId,
      workspaceId: draft.workspaceId, projectId: draft.projectId, workstreamId: draft.workstreamId }
    // Keep only the locator and authorized lookup scope needed to answer a later
    // read with an erased result. The original actor, turn, execution, trace and
    // digest are erased from this event in the same transaction as the draft.
    const redactedMissionEvent = await tx.auditEvent.updateMany({
      where: { id: draft.sourceEventId, entityType: 'AGENT_MISSION_DRAFT', entityId: draft.missionId,
        action: 'MISSION_DRAFT_CREATED', actorType: 'LINE_USER', actorId: draft.actorPersonId,
        tenantId, businessId: draft.businessId, requestId: draft.sourceTurnId },
      data: {
        actorType: 'SYSTEM', actorId: null, requestId: null, sessionId: null,
        reason: 'PERSON_ERASED', beforeJson: null, afterJson: null,
        payloadJson: JSON.stringify({ eventType: 'MISSION_DRAFT_CREATED', missionId: draft.missionId, scope }),
      },
    })
    if (redactedMissionEvent.count !== 1) {
      throw new Error('Agent mission draft source event could not be safely redacted')
    }
  }
  const erasedMissionDrafts = missionDraftWhere.OR.length
    ? await tx.agentMissionDraft.updateMany({
      where: missionDraftWhere,
      data: {
        status: 'ERASED', erasedAt: new Date(), revokedAt: null, version: { increment: 1 },
        sourceAgentRef: null, missionId: null, sourceTurnId: null, executionId: null,
        sourceEventId: null, sourceTraceEventId: null, digest: null, snapshotJson: '{}',
        actorPersonId: null,
      },
    })
    : { count: 0 }
  const erasedMissionEvidence = missionEvidenceWhere.OR.length
    ? await tx.agentMissionEvidence.updateMany({
      where: missionEvidenceWhere,
      data: {
        status: 'ERASED', erasedAt: new Date(), revokedAt: null, version: { increment: 1 },
        sourceTurnId: null, executionId: null, sourceEventId: null, sourceTraceEventId: null,
        sourceAgentRef: null, missionId: null,
        confirmationJobId: null, confirmationInboundMessageId: null, confirmationExecutionId: null,
        sourceDigest: null, missionSnapshotDigest: null, missionSnapshotJson: '{}', idempotencyKey: null,
        actorId: null, confirmationActorId: null,
        submittedByPersonId: null, submittedAt: null,
        channelIdentityId: null, confirmationIdentityVersion: null, channelIdentityLinkedAt: null,
        revokedByPersonId: null,
      },
    })
    : { count: 0 }
  // @req FR-022 — before any job is overwritten: a person with any memory-sync turn
  // (DIRECT, GROUP or ROOM) gets one pending, Core-owned tenant-wide MSP principal
  // erasure (owner decision 2026-09-28, option A).
  const { pendingPrincipalErasures } = await recordMemoryPrincipalErasure(tx, { tenantId, principalId: erasedPrincipalId, jobs, speakers: subjects })
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
      episodicMemoryOptIn: false,
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
  return { redactedLineJobs: jobs.length, erasedMissionDrafts: erasedMissionDrafts.count, erasedMissionEvidence: erasedMissionEvidence.count,
    inboundMessageIds: jobs.map(job => job.inboundMessageId), pendingMemoryPrincipalErasures: pendingPrincipalErasures }
}
