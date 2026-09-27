import prisma from '@/lib/db'
import { LIVE_ACCESS_STATUSES as LIVE_GRANT_STATUSES } from '@/lib/validation/enums'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { zErasePrincipalInput } from '@/lib/validation/entities'
import { redactConversationContent, redactSpeakerContentInSharedThreads } from '@/modules/crm/conversation-redaction-service'
import { redactLineConversationJobs } from '@/modules/line-oa-studio/application/line-job-erasure'
import { tombstoneRawRecordsForExternalIds } from '@/platform/integrations/core/raw-record-redaction'
import { destroyCustomerArchiveKey } from '@/modules/crm/chat-evidence-archive-service'
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
export async function erasePrincipal(input, { db = prisma, reviewedPmContext = null } = {}) {
  const { tenantId, personId, reason } = zErasePrincipalInput.parse(input)
  const now = new Date()

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

    // The words themselves. Gathered BEFORE the crm redaction call only for the raw
    // record keys — `externalMessageId` is untouched by redaction, but reading it
    // first keeps the two steps independent of each other's ordering.
    const messageKeys = conversations.length
      ? await tx.message.findMany({
        where: {
          conversationId: { in: conversations.map((conversation) => conversation.id) },
          externalMessageId: { not: null },
        },
        select: { externalMessageId: true },
      })
      : []
    const { redactedLineJobs, inboundMessageIds } = await redactLineConversationJobs(tx, {
      tenantId,
      conversationIds: personalIds,
      speakers: subjectChannels.filter((row) => row.channel === 'LINE'),
    })
    const personal = await redactConversationContent(tx, { tenantId, conversationIds: personalIds })
    const shared = await redactSpeakerContentInSharedThreads(tx, {
      tenantId,
      channelIdentities: subjectChannels,
      customerIds,
      inboundMessageIds,
      excludeConversationIds: personalIds,
    })
    const redactedMessages = personal.redactedMessages + shared.redactedMessages
    // Analyses are derived from a whole thread, so any thread that held this
    // person's words loses its analysis: their own, and every shared one they
    // spoke in. Recomputable; nothing another member wrote is changed.
    const analysedIds = [...new Set([...personalIds, ...ownedSharedIds, ...shared.conversationIds])]
    const analyses = analysedIds.length
      ? await tx.conversationAnalysis.deleteMany({ where: { conversationId: { in: analysedIds } } })
      : { count: 0 }

    // Which raw records belong to this person. Two families, and nothing else:
    //   - the provider subjects this person is known by (profile/customer-lane records
    //     keyed by the subject itself), and
    //   - the provider message ids of their own messages, which is what the LINE
    //     normalizer uses as `externalId` for a message event.
    // `ChannelIdentity.channelAccountId` is deliberately NOT included: it names the
    // OA account, shared by every customer of that channel, so matching on it would
    // tombstone other people's evidence.
    const externalIds = [
      ...ownSubjects,
      ...messageKeys.map((row) => row.externalMessageId),
      ...shared.externalMessageIds,
    ]
    const { tombstonedRawRecords } = await tombstoneRawRecordsForExternalIds(tx, {
      tenantId,
      externalIds,
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
    }
  }
  return typeof db.$transaction === 'function'
    ? db.$transaction(execute, { isolationLevel: 'Serializable', maxWait: 10_000, timeout: 30_000 })
    : execute(db)
}
