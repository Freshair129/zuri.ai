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
// @req FR-245 — before a candidate is tombstoned it is archived and verified
//   (ADR-093 D2): `chat-evidence-archive-service.js` writes and verifies the
//   Tenant's batch, and only that module's own transaction — never this one —
//   performs the tombstone. When archiving fails for a Tenant, this run leaves
//   that Tenant's candidates untouched and reports the failure in the audit
//   payload; every other Tenant's sweep this run is unaffected.
// @spec ADR-070 D3 — retention is reported truthfully: the audit payload's counts
//   are exactly what this run tombstoned, never a placeholder for a class it did
//   not touch.
// @spec BR-002, SEC-031, ADR-093 D2, D4; SEC-034
// @tested tests/integration/crm-retention-sweep.test.js, tests/integration/crm-chat-evidence-archive.test.js
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
import { archiveAndTombstoneTenantMessages } from './chat-evidence-archive-service'
import { RETENTION_SWEEP_TOMBSTONE } from './retention-sweep-tombstone'

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

// Re-exported unchanged so every existing import of this constant from this
// module keeps working — see retention-sweep-tombstone.js for why it now lives
// there (chat-evidence-archive-service.js needs it too, and importing it from
// here would be a cycle: this module imports that one).
export { RETENTION_SWEEP_TOMBSTONE }

const KNOWN_TOMBSTONES = [CUSTOMER_ERASURE_TOMBSTONE, LINE_UNSEND_TOMBSTONE, RETENTION_SWEEP_TOMBSTONE]

function candidateWhere(tenantId, cutoff, jobFilter) {
  return {
    conversation: { tenantId },
    createdAt: { lt: cutoff },
    body: { notIn: KNOWN_TOMBSTONES },
    lineJob: jobFilter,
  }
}

async function countSkippedNonTerminalJob(db, tenantId, cutoff) {
  return db.message.count({
    where: candidateWhere(tenantId, cutoff, { is: { status: { in: LINE_CONVERSATION_JOB_NON_TERMINAL_STATUSES } } }),
  })
}

async function sweepMessageBodyAndAttachmentsForTenant(db, tenantId, now, { env, baseDir } = {}) {
  const windowDays = await getEffectiveRetentionWindowDays({ tenantId, dataClass: CLASS, db })
  const cutoff = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000)

  const candidates = await db.message.findMany({
    where: candidateWhere(tenantId, cutoff, { isNot: { status: { in: LINE_CONVERSATION_JOB_NON_TERMINAL_STATUSES } } }),
    select: {
      id: true,
      conversationId: true,
      direction: true,
      body: true,
      contentKind: true,
      sessionId: true,
      createdAt: true,
      externalMessageId: true,
      conversation: { select: { id: true, customerId: true, businessId: true } },
      attachments: {
        select: { id: true, kind: true, providerContentId: true, fileAssetId: true, fetchState: true, mimeType: true, sizeBytes: true },
      },
    },
  })
  if (candidates.length === 0) return { redactedMessages: 0, redactedAttachments: 0, skippedNonTerminalJob: 0, archiveFailed: false, manifest: null }

  // @req FR-245 — archive before tombstone, fail closed (ADR-093 D2). A failure
  // anywhere in the archive write leaves every one of this Tenant's candidates
  // untouched this run: `archiveAndTombstoneTenantMessages` throws before its
  // own transaction ever runs, so nothing here has tombstoned or counted
  // anything by the time this catch fires.
  let archiveResult
  try {
    archiveResult = await archiveAndTombstoneTenantMessages(db, { tenantId, candidates, now, env, baseDir })
  } catch (error) {
    const skippedNonTerminalJob = await countSkippedNonTerminalJob(db, tenantId, cutoff)
    return {
      redactedMessages: 0,
      redactedAttachments: 0,
      skippedNonTerminalJob,
      archiveFailed: true,
      archiveFailureReason: error?.code || error?.message || 'ARCHIVE_FAILED',
      manifest: null,
    }
  }

  const conversationIds = [...new Set(candidates.map((row) => row.conversationId))]
  for (const conversationId of conversationIds) {
    await refreshConversationPreview(db, conversationId)
  }

  // Reported for visibility only — how many otherwise-eligible rows this run left
  // alone because a live job still needs them. Not an error: it is the sweep
  // doing exactly what ADR-091 proof 5 requires.
  const skippedNonTerminalJob = await countSkippedNonTerminalJob(db, tenantId, cutoff)

  return {
    redactedMessages: archiveResult.redactedMessages,
    redactedAttachments: archiveResult.redactedAttachments,
    skippedNonTerminalJob,
    archiveFailed: false,
    manifest: archiveResult.manifest
      ? { manifestId: archiveResult.manifest.id, runId: archiveResult.manifest.runId, manifestHash: archiveResult.manifest.manifestHash }
      : null,
  }
}

/**
 * Run the crm-owned slice of the ADR-091 D2 nightly retention sweep across every
 * Tenant, honouring each Tenant's own override (never lengthened past the
 * installation default), and write exactly one audit event naming the totals.
 * Each Tenant's candidates are archived (FR-245, ADR-093 D2) before they are
 * tombstoned; a Tenant whose archive step fails is skipped for this run (its
 * candidates stay in the database, untouched) rather than aborting the whole
 * multi-Tenant sweep, and the failure is named in the audit payload.
 *
 * @param {{db?: object, now?: Date, env?: object, baseDir?: string}} [options]
 * @returns {Promise<{auditEventId: string, countsByClass: Record<string, object>}>}
 */
export async function runRetentionSweep({ db = prisma, now = new Date(), env = process.env, baseDir } = {}) {
  const totals = { redactedMessages: 0, redactedAttachments: 0, skippedNonTerminalJob: 0 }
  const manifests = []
  const archiveFailures = []

  // CRM_OWNED_RETENTION_CLASSES has exactly one member today (MESSAGE_BODY_AND_ATTACHMENTS);
  // looping over it rather than hard-coding the call keeps this function's shape
  // unchanged on the day a second crm-owned class exists.
  for (const dataClass of CRM_OWNED_RETENTION_CLASSES) {
    if (dataClass !== CLASS) continue // no second class exists yet to dispatch to
    const tenants = await db.tenant.findMany({ select: { id: true } })
    for (const tenant of tenants) {
      const result = await sweepMessageBodyAndAttachmentsForTenant(db, tenant.id, now, { env, baseDir })
      totals.redactedMessages += result.redactedMessages
      totals.redactedAttachments += result.redactedAttachments
      totals.skippedNonTerminalJob += result.skippedNonTerminalJob
      if (result.archiveFailed) {
        archiveFailures.push({ tenantId: tenant.id, reason: result.archiveFailureReason })
      } else if (result.manifest) {
        manifests.push({ tenantId: tenant.id, ...result.manifest })
      }
    }
  }

  const countsByClass = {
    [CLASS]: {
      ...totals,
      // @req FR-245 — carried only when non-empty, matching ADR-070 D3's
      //   "truthful reporting": a run with nothing to archive or no failure
      //   names neither, rather than an empty array claiming it checked.
      ...(archiveFailures.length > 0 ? { archiveFailures } : {}),
      ...(manifests.length > 0 ? { manifests } : {}),
    },
  }
  const event = await recordAudit(db, {
    entityType: 'RETENTION_SWEEP',
    entityId: `sweep:${now.toISOString()}`,
    action: 'RETENTION_SWEEP_COMPLETED',
    actorType: 'SYSTEM',
    payload: { ranAt: now.toISOString(), countsByClass },
  })

  return { auditEventId: event.id, countsByClass }
}
