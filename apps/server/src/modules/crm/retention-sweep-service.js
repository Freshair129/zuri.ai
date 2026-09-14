// @req FR-230 — the nightly retention sweep for the one data class this crm-scoped
//   change owns: MESSAGE_BODY_AND_ATTACHMENTS (Message.body / MessageAttachment,
//   24-month installation default). Tombstones content past its effective
//   per-Tenant window, keeps envelope columns (id, direction, timestamps —
//   the same shape conversation-redaction-service.js already keeps), skips a
//   row a non-terminal LineConversationJob still references, and writes exactly
//   one audit event per run naming the counts it actually produced.
//
//   RAW_LINE_PAYLOAD (integration's RawExternalRecord) and AGENT_TRACE_EVENT
//   (agent's AgentTraceEvent) are each other domain's charter to sweep — this
//   module does not write either model. MSP_SESSION_CONTENT lives in MSP, a
//   separate repository this codebase never reaches. See the task report for
//   the ownership boundary; RETENTION_DATA_CLASSES / RETENTION_DEFAULT_WINDOW_DAYS
//   (src/lib/validation/enums.js) already declare all four so nothing here needs
//   to change shape once those sweepers exist.
// @spec ADR-070 D3 — retention is reported truthfully: the audit payload's counts
//   are exactly what this run tombstoned, never a placeholder for a class it did
//   not touch.
// @spec BR-002, SEC-031
// @tested tests/integration/crm-retention-sweep.test.js
//
// IDEMPOTENCY
// -----------
// A message already carrying any of the three known tombstone strings (PDPA
// erasure, LINE unsend, or this sweep's own) is excluded from the candidate set,
// so a second run over the same window recounts zero rather than re-tombstoning
// or double-counting. The same is true of MessageAttachment.fetchState — already
// ERASED rows are excluded from the updateMany, so its count is exact too.
//
// WHY A ROW REFERENCED BY A NON-TERMINAL JOB IS SKIPPED
// ------------------------------------------------------
// `LineConversationJob.inboundMessageId` is a one-to-one pointer at the Message
// that started the turn. While that job is still QUEUED/CLAIMED/READY/SENDING/
// ACCEPTED/UNKNOWN, the worker may still read `job.inbound` (the admission
// reconciler, the answer composer, the trace replay) — tombstoning the message
// out from under it would turn a live in-flight turn into a bug report, not an
// honoured retention window. `lineJob: { isNot: { status: { in: NON_TERMINAL } } }`
// is Prisma's filter for exactly "no such job, or that job is not one of these
// statuses" over the optional one-to-one relation, which covers both "never had
// a job" and "job is done" in one clause.

import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { CUSTOMER_ERASURE_TOMBSTONE } from './conversation-redaction-service'
import { LINE_UNSEND_TOMBSTONE } from './line-ingest-service'
import { refreshConversationPreview } from './conversation-preview-service'
import { getEffectiveRetentionWindowDays } from './retention-override-service'
import { CRM_OWNED_RETENTION_CLASSES } from '@/lib/validation/enums'

const CLASS = 'MESSAGE_BODY_AND_ATTACHMENTS'

// LineConversationJob's own status words (line-conversation-jobs.js), kept local
// rather than in enums.js on purpose — see that file's FR-152 comment: a
// registry entry there would read every narrower, purpose-built local subset
// (line-conversation-jobs.js's own `WAITING`, for one) as a hand-copy of it.
// RECORDED/FAILED/CANCELLED are the ledger's own terminal states (RECORDED: the
// reply settled via appendOutbound; FAILED/CANCELLED: no further transition
// writes them). UNKNOWN is deliberately NOT terminal here even though it needs
// an operator's acknowledgement to leave that status: LINE's own delivery
// outcome is still unresolved, and a sweep must not remove evidence a human has
// not yet closed out.
const LINE_CONVERSATION_JOB_NON_TERMINAL_STATUSES = ['QUEUED', 'CLAIMED', 'READY', 'SENDING', 'ACCEPTED', 'UNKNOWN']

/** The one string a retention-swept message body carries — distinct from the PDPA
 * erasure and LINE-unsend tombstones, because "past its retention window" is a
 * different fact than either, and the FR-091/FR-233 inbox reader should read them
 * differently if it ever needs to (it does not today; the distinction is free). */
export const RETENTION_SWEEP_TOMBSTONE = '[ข้อความถูกลบตามนโยบายเก็บรักษาข้อมูล]'

const KNOWN_TOMBSTONES = [CUSTOMER_ERASURE_TOMBSTONE, LINE_UNSEND_TOMBSTONE, RETENTION_SWEEP_TOMBSTONE]

async function sweepMessageBodyAndAttachmentsForTenant(db, tenantId, now) {
  const windowDays = await getEffectiveRetentionWindowDays({ tenantId, dataClass: CLASS, db })
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)

  const candidates = await db.message.findMany({
    where: {
      conversation: { tenantId },
      createdAt: { lt: cutoff },
      body: { notIn: KNOWN_TOMBSTONES },
      lineJob: { isNot: { status: { in: LINE_CONVERSATION_JOB_NON_TERMINAL_STATUSES } } },
    },
    select: { id: true, conversationId: true },
  })
  if (candidates.length === 0) return { redactedMessages: 0, redactedAttachments: 0, skippedNonTerminalJob: 0 }

  const messageIds = candidates.map((row) => row.id)
  const conversationIds = [...new Set(candidates.map((row) => row.conversationId))]

  const redacted = await db.message.updateMany({
    where: { id: { in: messageIds } },
    data: { body: RETENTION_SWEEP_TOMBSTONE },
  })
  const redactedAttachments = await db.messageAttachment.updateMany({
    where: { messageId: { in: messageIds }, fetchState: { not: 'ERASED' } },
    data: { fetchState: 'ERASED', providerContentId: null },
  })
  for (const conversationId of conversationIds) {
    await refreshConversationPreview(db, conversationId)
  }

  // Reported for visibility only — how many otherwise-eligible rows this run left
  // alone because a live job still needs them. Not an error: it is the sweep
  // doing exactly what ADR-091 proof 5 requires.
  const skippedNonTerminalJob = await db.message.count({
    where: {
      conversation: { tenantId },
      createdAt: { lt: cutoff },
      body: { notIn: KNOWN_TOMBSTONES },
      lineJob: { is: { status: { in: LINE_CONVERSATION_JOB_NON_TERMINAL_STATUSES } } },
    },
  })

  return { redactedMessages: redacted.count, redactedAttachments: redactedAttachments.count, skippedNonTerminalJob }
}

/**
 * Run the crm-owned slice of the ADR-091 D2 nightly retention sweep across every
 * Tenant, honouring each Tenant's own override (never lengthened past the
 * installation default), and write exactly one audit event naming the totals.
 *
 * @param {{db?: object, now?: Date}} [options]
 * @returns {Promise<{auditEventId: string, countsByClass: Record<string, object>}>}
 */
export async function runRetentionSweep({ db = prisma, now = new Date() } = {}) {
  const totals = { redactedMessages: 0, redactedAttachments: 0, skippedNonTerminalJob: 0 }

  // CRM_OWNED_RETENTION_CLASSES has exactly one member today (MESSAGE_BODY_AND_ATTACHMENTS);
  // looping over it rather than hard-coding the call keeps this function's shape
  // unchanged on the day a second crm-owned class exists.
  for (const dataClass of CRM_OWNED_RETENTION_CLASSES) {
    if (dataClass !== CLASS) continue // no second class exists yet to dispatch to
    const tenants = await db.tenant.findMany({ select: { id: true } })
    for (const tenant of tenants) {
      const result = await sweepMessageBodyAndAttachmentsForTenant(db, tenant.id, now)
      totals.redactedMessages += result.redactedMessages
      totals.redactedAttachments += result.redactedAttachments
      totals.skippedNonTerminalJob += result.skippedNonTerminalJob
    }
  }

  const countsByClass = { [CLASS]: totals }
  const event = await recordAudit(db, {
    entityType: 'RETENTION_SWEEP',
    entityId: `sweep:${now.toISOString()}`,
    action: 'RETENTION_SWEEP_COMPLETED',
    actorType: 'SYSTEM',
    payload: { ranAt: now.toISOString(), countsByClass },
  })

  return { auditEventId: event.id, countsByClass }
}
