import prisma from '@/lib/db'
import { LIVE_ACCESS_STATUSES as LIVE_GRANT_STATUSES } from '@/lib/validation/enums'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { zErasePrincipalInput } from '@/lib/validation/entities'
import {
  findSpeakerConversationEventKeys, redactConversationContent, redactSpeakerContentInSharedThreads,
} from '@/modules/crm/conversation-redaction-service'
import { redactLineConversationJobs } from '@/modules/line-oa-studio/application/line-job-erasure'
import { tombstoneRawRecordsForExternalIds } from '@/platform/integrations/core/raw-record-redaction'
import { destroyCustomerArchiveKey, removeUnreferencedArchiveFile } from '@/modules/crm/chat-evidence-archive-service'
import { captureLinesBeforeErasure, recordErasureBlocked, resealErasedEvidenceUnderLegalHolds } from '@/modules/crm/chat-evidence-hold-reseal-service'
import { revokeRetentionConsentInTransaction, scrubRetentionConsentAuditText } from '@/modules/crm/customer-retention-consent-service'
import { applyReviewedProjectFeatureErasure } from '@/modules/project-manager/application/project-feature-erasure'

// @req FR-252 — reviewed PM text shares the Identity erasure transaction.
// @spec docs/architecture/project-manager-system/26-PHASE-B-RECOVERY-AND-ERASURE-DECISION.md
// @tested tests/integration/phase-b-identity-erasure.test.js

// @req FR-022, FR-095 — PDPA erasure for a principal (the erase-revoke leg of the P3 gate).
// @spec docs/replacement/IMPACT-SCAN-IDENTITY.md §hazard-5 — ExternalIdentity is a
//   third handle copy of the person; erasing a customer that only nulls the legacy
//   columns leaves them re-contactable through the mapping table. So erase MUST
//   revoke the ExternalIdentity, and a revoked binding refuses to resolve (FR-021),
//   which is what makes an erased person un-reachable rather than merely hidden.
// @spec ADR-045 D2, SEC-003 — append-only audit; erase is recorded, never a silent purge.
// Boundaries: docs/domains/crm/CHARTER.md, docs/domains/integration/CHARTER.md — the
//   message bodies and the raw provider payloads are the two places the erased person's
//   words live. Both are other domains' models, so both are reached through those
//   domains' own contract exports inside this one transaction, never by a direct
//   prisma write from here: `redactConversationContent` and
//   `redactSpeakerContentInSharedThreads` (crm) and
//   `tombstoneRawRecordsForExternalIds` (integration).
// RCA: .brain/rca/2026-08-31-conversation-analysis-tenant-binding.md
// @tested tests/integration/identity-erase.test.js, tests/integration/crm-conversation-analysis.test.js
// @tested tests/integration/crm-customer-erasure.test.js, tests/integration/server-line-jobs.test.js
// @tested tests/integration/crm-archive-legal-hold.test.js
// @req FR-022 — erasure follows the SPEAKER, not only the thread owner. A LINE group or
//   room Conversation belongs to the Customer of its first speaker, so selecting by
//   owner alone left every other speaker's lines, jobs and trace inputs readable after
//   their erasure, and erasing the first speaker cancelled everyone else's turns.
//   A thread whose external id is one of this person's own subjects is theirs alone
//   and is erased whole, exactly as before. Every other thread is shared: only this
//   person's own lines (Message.authorChannelIdentityId, or the inbound of a job they
//   spoke), the replies to them and their own jobs (sourceUserId on the job's channel
//   account) are erased there; other members' content and in-flight turns are left alone.
// @tested tests/integration/identity-erase-group-speakers.test.js
// @req FR-022 — the raw webhook payload of a person's own postback (and follow /
//   unfollow) is theirs too: it carries the postback `data` and their LINE user id,
//   keyed by LINE's webhookEventId, which no message id or provider subject matches.
//   `findSpeakerConversationEventKeys` (crm) names those events — every event of a
//   thread that is theirs alone, and their own events in any shared thread — and
//   their keys join the raw-record tombstone below. Another member's events stay.
// @tested tests/integration/identity-erase-speaker-events.test.js
// @req FR-022 — a LINE message event's raw record is keyed by its webhookEventId, so
//   the erased person's own message payloads are also found by the message id inside
//   the payload (see the raw-record family list below).

const REDACTED = '[erased]'

/**
 * Erase a principal within a tenant: revoke every channel identity, invalidate any
 * outstanding link tokens (so a dangling token can't re-attach the person), and
 * soft-delete + redact the tenant's CRM record. Tenant-scoped by design — the
 * global Person is redacted only when it has no ties left anywhere.
 *
 * Content redaction is part of the same transaction rather than a follow-up job:
 * an erasure that revoked the identity and then failed to redact would leave the
 * person un-reachable but fully readable, which is the worse half to get wrong.
 *
 * @returns {{ revokedIdentities, revokedChannelIdentities, erasedCustomers, erasedAnalyses, invalidatedTokens, revokedSessions, personRedacted, redactedMessages, tombstonedRawRecords, archiveKeys }}
 */
export async function erasePrincipal(input, {
  db = prisma, reviewedPmContext = null, archiveBaseDir = undefined, env = process.env, alert = undefined,
} = {}) {
  const { tenantId, personId, reason } = zErasePrincipalInput.parse(input)
  const now = new Date()
  // @req FR-022 — a legal-hold re-seal file this erasure wrote (ADR-093 1.2.0),
  //   removed again if the transaction that names it does not commit.
  let resealFile = null

  const execute = async (tx) => {
    // @req FR-191 — erasure is downstream of offboarding, never a substitute
    // for it (SEC-026, ADR-077 D6). Before this refusal, erasure *counted*
    // grants to decide whether to redact the Person and ended none: a staff
    // member could be erased under PDPA and keep owning four Businesses, still
    // able to authenticate because `authenticateUser` also matches `code`.
    //
    // Having erasure revoke the grants itself was rejected. It turns a
    // data-subject request into an administrative act with no named author and
    // buries the moment authority ended inside an operation whose trail is
    // deliberately redacted. Two acts, two authors, two records.
    const [liveMemberships, liveBindings, liveGrants] = await Promise.all([
      tx.membership.count({ where: { personId, tenantId, status: { in: LIVE_GRANT_STATUSES } } }),
      tx.roleBinding.count({ where: { personId, tenantId, status: { in: LIVE_GRANT_STATUSES } } }),
      tx.platformGrant.count({ where: { personId, status: 'ACTIVE' } }),
    ])
    if (liveMemberships + liveBindings + liveGrants > 0) {
      const error = new Error('PRINCIPAL_HAS_LIVE_GRANTS')
      error.status = 409
      // Counts, not ids: the caller needs to know what to offboard, and an id
      // list here would answer a question the caller may not be scoped to ask.
      error.details = { memberships: liveMemberships, roleBindings: liveBindings, platformGrants: liveGrants }
      throw error
    }

    // Internal server context only; the public erasure request never accepts it.
    // Subject identity comes from this orchestrator, not from the manifest.
    const pmResult = await applyReviewedProjectFeatureErasure(tx, reviewedPmContext?.manifest ?? null, {
      authority: {
        ...reviewedPmContext?.authority,
        tenantId,
        subjectPersonId: personId,
      },
      now,
    })
    const pmErasure = {
      status: pmResult.status,
      manifestSha256: pmResult.manifestSha256 ?? null,
      changedRowCount: pmResult.changedRowCount,
      changedFieldCount: pmResult.changedFieldCount,
    }

    const revoked = await tx.externalIdentity.updateMany({
      where: { tenantId, personId, revokedAt: null },
      data: { revokedAt: now },
    })
    const tokens = await tx.identityLinkToken.updateMany({
      where: { tenantId, personId, consumedAt: null },
      data: { consumedAt: now },
    })
    const sessions = await tx.session.updateMany({
      where: { personId, status: 'ACTIVE' },
      data: {
        status: 'REVOKED',
        revokedAt: now,
        revokeReason: 'PERSON_ERASED',
        version: { increment: 1 },
      },
    })
    const channelIdentities = await tx.channelIdentity.updateMany({
      where: { tenantId, personId, status: { not: 'REVOKED' } },
      data: {
        status: 'REVOKED',
        revokedAt: now,
        version: { increment: 1 },
      },
    })
    const customers = await tx.customer.findMany({ where: { tenantId, personId }, select: { id: true, deletedAt: true } })
    const customerIds = customers.map((customer) => customer.id)
    const activeCustomers = customers.filter((customer) => customer.deletedAt === null)
    // Who this person is on each channel. Read before any redaction: the job writer
    // below overwrites `sourceUserId`, and a revoked identity keeps its subject.
    const [subjectIdentities, subjectChannels] = await Promise.all([
      tx.externalIdentity.findMany({ where: { tenantId, personId }, select: { providerSubject: true } }),
      tx.channelIdentity.findMany({
        where: { tenantId, personId },
        select: { id: true, channel: true, channelAccountId: true, providerSubject: true },
      }),
    ])
    const ownSubjects = new Set([
      ...subjectIdentities.map((row) => row.providerSubject),
      ...subjectChannels.map((row) => row.providerSubject),
    ])
    const ownedConversations = customerIds.length
      ? await tx.conversation.findMany({
        where: { tenantId, customerId: { in: customerIds } },
        select: { id: true, channel: true, externalThreadId: true },
      })
      : []
    // A LINE thread keyed by anything but this person's own subject is a group or
    // room (admission keys a thread by groupId, else roomId, else the speaker).
    const isShared = (conversation) => conversation.channel === 'LINE' && !ownSubjects.has(conversation.externalThreadId)
    const conversations = ownedConversations.filter((conversation) => !isShared(conversation))
    const ownedSharedIds = ownedConversations.filter(isShared).map((conversation) => conversation.id)
    const personalIds = conversations.map((conversation) => conversation.id)
    for (const c of activeCustomers) {
      await tx.customer.update({
        where: { id: c.id },
        data: { deletedAt: now, displayName: REDACTED, lifecycleStage: 'LOST' },
      })
    }
    // @req FR-103, FR-022 — the FR-103 consent attestation's free-text note and
    //   the staff member who recorded it describe this person's relationship with
    //   the Business; neither survives the erasure. `consentStatus` stays — it is
    //   the fact a PDPA request asks about, not personal content.
    if (customerIds.length) {
      await tx.customer.updateMany({
        where: { tenantId, id: { in: customerIds } },
        data: { consentNote: null, consentRecordedByPersonId: null },
      })
    }

    // The words themselves. Gathered BEFORE the crm redaction call only for the raw
    // record keys — `externalMessageId` is untouched by redaction, but reading it
    // first keeps the two steps independent of each other's ordering.
    const messageKeys = conversations.length
      ? await tx.message.findMany({
        where: {
          conversationId: { in: conversations.map((conversation) => conversation.id) },
          externalMessageId: { not: null },
        },
        select: { externalMessageId: true, direction: true, createdAt: true },
      })
      : []
    const { redactedLineJobs, inboundMessageIds } = await redactLineConversationJobs(tx, {
      tenantId,
      conversationIds: personalIds,
      speakers: subjectChannels.filter((row) => row.channel === 'LINE'),
      // @req FR-022 — what MSP thread memory holds of this principal (DIRECT, group
      // and room) is erased tenant-wide by Core after this transaction commits.
      erasedPrincipalId: personId,
    })
    const personal = await redactConversationContent(tx, { tenantId, conversationIds: personalIds })
    let capturedLines = []
    const shared = await redactSpeakerContentInSharedThreads(tx, {
      tenantId,
      channelIdentities: subjectChannels,
      customerIds,
      inboundMessageIds,
      excludeConversationIds: personalIds,
      // @req FR-022 — ADR-093 1.2.0: read the lines about to be tombstoned, in case a
      //   held, consenting member of their thread needs them re-sealed below.
      beforeRedact: async ({ messageIds }) => {
        capturedLines = await captureLinesBeforeErasure(tx, { tenantId, messageIds })
      },
    })
    const redactedMessages = personal.redactedMessages + shared.redactedMessages
    const speakerEvents = await findSpeakerConversationEventKeys(tx, {
      tenantId,
      customerIds,
      channelIdentities: subjectChannels,
      personalConversationIds: personalIds,
    })
    // Analyses are derived from a whole thread, so any thread that held this
    // person's words loses its analysis: their own, and every shared one they
    // spoke in. Recomputable; nothing another member wrote is changed.
    const analysedIds = [...new Set([...personalIds, ...ownedSharedIds, ...shared.conversationIds])]
    const analyses = analysedIds.length
      ? await tx.conversationAnalysis.deleteMany({ where: { conversationId: { in: analysedIds } } })
      : { count: 0 }

    // Which raw records belong to this person, and nothing else:
    //   - the provider subjects this person is known by (profile/customer-lane records
    //     keyed by the subject itself);
    //   - the provider message ids of their own messages — both as a record key (the
    //     LINE normalizer keys an event with no `webhookEventId` by its message id)
    //     and, because it keys every event that HAS one by that `webhookEventId`
    //     (line-oa-webhook.js `externalEventId`), which no business row stores, as
    //     the message id inside a LINE payload (`event.message.id`,
    //     `tombstoneRawRecordsForExternalIds`'s `lineMessages`); and
    //   - the webhook event ids of their own conversation events (postback, follow,
    //     unfollow; every event of a thread that is theirs alone), which a
    //     ConversationEvent stores as its `externalEventId`.
    // The message ids are exactly the rows redacted above — their own thread's and
    // their own lines elsewhere, by the same attribution — so another member's
    // payload is never matched.
    // `ChannelIdentity.channelAccountId` is deliberately NOT included: it names the
    // OA account, shared by every customer of that channel, so matching on it would
    // tombstone other people's evidence.
    // Inbound only (an outbound row has no webhook event), each with the time it was
    // written: the raw record of its webhook event was received within the hour
    // around it, which is what bounds the payload lookup (see raw-record-redaction.js).
    const lineMessages = [
      ...messageKeys.filter((row) => row.direction === 'INBOUND'),
      ...shared.inboundMessages,
    ].filter((row) => typeof row.externalMessageId === 'string' && row.externalMessageId)
      .map((row) => ({ id: row.externalMessageId, createdAt: row.createdAt }))
    const externalIds = [
      ...ownSubjects,
      ...messageKeys.map((row) => row.externalMessageId),
      ...shared.externalMessageIds,
      ...speakerEvents.externalEventIds,
    ]
    const { tombstonedRawRecords } = await tombstoneRawRecordsForExternalIds(tx, {
      tenantId,
      externalIds,
      lineMessages,
      now,
    })

    // CRM keeps an archive key while an active dispute hold requires it. Retry
    // this independently of PM replay so an expired hold can finish its erasure.
    // @req SEC-034 — the chat evidence archive is the one copy a PDPA erasure
    // does not destroy outright (ADR-093 D6, TASK-ZAI-113): a Customer's
    // archive data key is destroyed here, UNLESS an OWNER has recorded an
    // active legal hold on them, in which case the key survives and the hold
    // is reported so the caller can show it ("the erasure status shows the
    // hold" — ADR-093 D6). `destroyCustomerArchiveKey` is the one function
    // that may delete the key row; the hold check lives inside it, not here,
    // so this call site cannot re-derive that answer differently from
    // `chat-evidence-archive-expiry-service.js`'s own call to it. Looped
    // rather than assumed singular: nothing here relies on the
    // @@unique([tenantId, personId]) constraint that makes customerIds hold
    // at most one id today, matching how activeCustomers above is derived
    // from the data rather than from that invariant.
    // @req FR-022, SEC-034 — "consent to retain = keep" (ADR-093 1.2.0, amending
    //   D6). Before this person's archive key is destroyed, the lines it would
    //   shred in a shared thread whose other member is under an active legal hold
    //   AND has an active retention consent are re-sealed under that hold's own key
    //   into a new, chained archive file. Without such a member nothing happens
    //   and the erasure behaves exactly as before.
    let resealed
    try {
      resealed = await resealErasedEvidenceUnderLegalHolds(tx, {
        tenantId,
        erasedCustomerIds: customerIds,
        speakerChannelIdentityIds: subjectChannels.map((row) => row.id),
        capturedLines,
        now,
        env,
        baseDir: archiveBaseDir,
      })
    } catch (error) {
      if (error?.archiveFile) resealFile = error.archiveFile
      throw error
    }
    if (resealed.file) resealFile = resealed.file

    // @req FR-022 — an erasure ends this person's own retention consent, and with
    //   it every legal-hold re-seal key kept on the strength of it.
    // @req FR-022 — L1 of the #610 review: the free text a sales user or owner
    //   typed when recording or revoking this person's retention consent may
    //   describe them; it leaves the audit trail with them (the events stay).
    await scrubRetentionConsentAuditText(tx, { tenantId, customerIds })
    const retentionConsent = []
    for (const id of customerIds) {
      const result = await revokeRetentionConsentInTransaction(tx, {
        tenantId, customerId: id, now, actorType: 'SYSTEM', reason: 'CUSTOMER_ERASED', clearNote: true,
      })
      if (result.revoked || result.destroyedHoldKeys.length) {
        retentionConsent.push({ customerId: id, revoked: result.revoked, destroyedHoldKeys: result.destroyedHoldKeys.length })
      }
    }

    const archiveKeys = []
    for (const id of customerIds) {
      const result = await destroyCustomerArchiveKey(tx, { tenantId, customerId: id, now })
      archiveKeys.push({
        customerId: id,
        keyDestroyed: result.destroyed,
        legalHold: result.hold ? { reason: result.hold.reason, endDate: result.hold.endDate.toISOString() } : null,
      })
    }

    // Redact the global Person only when erasing it here leaves nothing behind:
    // no LIVE membership anywhere and no other live customer in another tenant.
    //
    // `status` matters here since ADR-077 D2 made withdrawal a state change
    // rather than a delete. Counting every row would mean anyone who had ever
    // held a grant could never be redacted — the revoked row that exists to
    // prove the grant ended would block the erasure that ending it enabled.
    // The tenant being erased is already known to hold no live grant: the
    // refusal at the top of this transaction saw to that.
    const [otherMemberships, otherCustomers] = await Promise.all([
      tx.membership.count({ where: { personId, status: { in: LIVE_GRANT_STATUSES } } }),
      tx.customer.count({ where: { personId, deletedAt: null, tenantId: { not: tenantId } } }),
    ])
    let personRedacted = false
    if (otherMemberships === 0 && otherCustomers === 0) {
      await tx.person.update({
        where: { id: personId },
        data: {
          displayName: REDACTED,
          email: null,
          // @req FR-191 — a redacted person whose password still works is not
          // erased (SEC-026). `authenticateUser` matches on `code` as well as
          // email, so nulling the email alone left a working login behind.
          accessDisabledAt: now,
          accessDisabledReason: 'ERASED',
        },
      })
      await tx.personCredential.deleteMany({ where: { personId } })
      personRedacted = true
    }

    await recordAudit(tx, {
      entityType: 'PRINCIPAL',
      entityId: personId,
      action: 'ERASED',
      actorType: 'LOCAL_USER',
      payload: {
        tenantId,
        reason: reason || null,
        revokedIdentities: revoked.count,
        revokedChannelIdentities: channelIdentities.count,
        invalidatedTokens: tokens.count,
        revokedSessions: sessions.count,
        erasedCustomers: activeCustomers.length,
        erasedAnalyses: analyses.count,
        redactedMessages,
        redactedLineJobs,
        // Counts only: which threads they were would name the groups this person was in.
        sharedThreads: shared.conversationIds.length,
        attributedMessages: shared.attributedMessages,
        tombstonedRawRecords,
        archiveKeys,
        // @req FR-022 — hold ids and counts only (ADR-093 1.2.0); naming the held
        //   Customer here would tie them to this person's threads.
        retainedForLegalHolds: resealed.holds,
        retentionConsent,
        personRedacted,
        pmErasure: pmResult.audit ?? pmErasure,
      },
    })

    return {
      revokedIdentities: revoked.count,
      revokedChannelIdentities: channelIdentities.count,
      invalidatedTokens: tokens.count,
      revokedSessions: sessions.count,
      erasedCustomers: activeCustomers.length,
      erasedAnalyses: analyses.count,
      redactedMessages,
      redactedLineJobs,
      tombstonedRawRecords,
      personRedacted,
      pmErasure,
      // @req SEC-034 — one entry per Customer this erasure touched (ADR-093
      //   D6): `keyDestroyed: true` when no hold protected them, or
      //   `legalHold` naming the hold that deferred it. Always present as an
      //   array (empty when this Person has no Customer at all) rather than a
      //   new required field, so an existing caller that ignores it keeps
      //   reading exactly the counts it always did.
      archiveKeys,
      // @req FR-022 — which legal holds kept evidence this erasure would have shredded.
      retainedForLegalHolds: resealed.holds,
    }
  }
  try {
    return typeof db.$transaction === 'function'
      ? await db.$transaction(execute, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 })
      : await execute(db)
  } catch (error) {
    if (resealFile) {
      await removeUnreferencedArchiveFile(db, { tenantId, runId: resealFile.runId, relativePath: resealFile.relativePath, baseDir: resealFile.baseDir })
    }
    // @req FR-022 — ADR-093 1.2.0 runbook: a blocked erasure is an operator alert
    //   that must outlive the transaction it rolled back, so it is written here,
    //   after the rollback, on the root client.
    if (error?.code === 'ERASURE_BLOCKED_ARCHIVE_CHAIN_INVALID') {
      await recordErasureBlocked(db, error, alert ? { alert } : {})
    }
    throw error
  }
}
