import prisma from '@/lib/db'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { zErasePrincipalInput } from '@/lib/validation/entities'
import { redactConversationContentForCustomers } from '@/modules/crm/conversation-redaction-service'
import { tombstoneRawRecordsForExternalIds } from '@/platform/integrations/core/raw-record-redaction'

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
//   prisma write from here: `redactConversationContentForCustomers` (crm) and
//   `tombstoneRawRecordsForExternalIds` (integration).
// RCA: .brain/rca/2026-08-31-conversation-analysis-tenant-binding.md
// @tested tests/integration/identity-erase.test.js, tests/integration/crm-conversation-analysis.test.js
// @tested tests/integration/crm-customer-erasure.test.js

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
 * @returns {{ revokedIdentities, revokedChannelIdentities, erasedCustomers, erasedAnalyses, invalidatedTokens, revokedSessions, personRedacted, redactedMessages, tombstonedRawRecords }}
 */
export async function erasePrincipal(input) {
  const { tenantId, personId, reason } = zErasePrincipalInput.parse(input)
  const now = new Date()

  return prisma.$transaction(async (tx) => {
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
    const conversations = customerIds.length
      ? await tx.conversation.findMany({ where: { tenantId, customerId: { in: customerIds } }, select: { id: true } })
      : []
    const analyses = conversations.length
      ? await tx.conversationAnalysis.deleteMany({
        where: { conversationId: { in: conversations.map((conversation) => conversation.id) } },
      })
      : { count: 0 }
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
    const { redactedMessages } = await redactConversationContentForCustomers(tx, { tenantId, customerIds })

    // Which raw records belong to this person. Two families, and nothing else:
    //   - the provider subjects this person is known by (profile/customer-lane records
    //     keyed by the subject itself), and
    //   - the provider message ids of their own messages, which is what the LINE
    //     normalizer uses as `externalId` for a message event.
    // `ChannelIdentity.channelAccountId` is deliberately NOT included: it names the
    // OA account, shared by every customer of that channel, so matching on it would
    // tombstone other people's evidence.
    const [subjectIdentities, subjectChannels] = await Promise.all([
      tx.externalIdentity.findMany({ where: { tenantId, personId }, select: { providerSubject: true } }),
      tx.channelIdentity.findMany({ where: { tenantId, personId }, select: { providerSubject: true } }),
    ])
    const externalIds = [
      ...subjectIdentities.map((row) => row.providerSubject),
      ...subjectChannels.map((row) => row.providerSubject),
      ...messageKeys.map((row) => row.externalMessageId),
    ]
    const { tombstonedRawRecords } = await tombstoneRawRecordsForExternalIds(tx, {
      tenantId,
      externalIds,
      now,
    })

    // Redact the global Person only when erasing it here leaves nothing behind:
    // no membership anywhere and no other live customer in another tenant.
    const [otherMemberships, otherCustomers] = await Promise.all([
      tx.membership.count({ where: { personId } }),
      tx.customer.count({ where: { personId, deletedAt: null, tenantId: { not: tenantId } } }),
    ])
    let personRedacted = false
    if (otherMemberships === 0 && otherCustomers === 0) {
      await tx.person.update({ where: { id: personId }, data: { displayName: REDACTED, email: null } })
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
        tombstonedRawRecords,
        personRedacted,
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
      tombstonedRawRecords,
      personRedacted,
    }
  })
}
