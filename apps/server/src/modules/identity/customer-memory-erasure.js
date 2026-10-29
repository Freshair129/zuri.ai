import { redactConversationContent, redactSpeakerContentInSharedThreads, findSpeakerConversationEventKeys } from '@/modules/crm/conversation-redaction-service'
import { redactLineConversationJobs } from '@/modules/line-oa-studio/application/line-job-erasure'
import { tombstoneRawRecordsForExternalIds } from '@/platform/integrations/core/raw-record-redaction'
import { captureLinesBeforeErasure, resealErasedEvidenceUnderLegalHolds } from '@/modules/crm/chat-evidence-hold-reseal-service'
import { tombstoneKnowledgeCandidatesForErasure } from '@/modules/knowledge/application/knowledge-candidate-erasure-service'

// @req FR-022, FR-232 — Identity composes the Tier 1 memory erasure for both a
//   full principal erasure and a consent-only withdrawal. The latter deliberately
//   stops before identity, login, Customer profile, and retention-purpose changes.
// @spec ADR-091 D6, ADR-090 D8, ADR-093 D6; SEC-001
// @tested tests/integration/identity-erase-group-speakers.test.js,
//   tests/integration/fr236-knowledge-candidate.test.js

/**
 * Erase one principal's tenant-scoped memory projections in the caller's
 * transaction. CRM and Knowledge remain the only writers of their records;
 * LINE closes copied jobs and records a durable pending MSP request without
 * calling MSP. A caller decides whether the principal/profile itself is erased.
 *
 * The source principal and tenant are mandatory scope. Customer rows,
 * identities, conversations, and message lineage are all re-read under that
 * scope; caller-provided conversation or message identifiers are never used.
 */
export async function eraseCustomerMemoryInTransaction(tx, {
  tenantId,
  personId,
  reason,
  now = new Date(),
  viewer = null,
  env = process.env,
  archiveBaseDir = undefined,
  preserveCustomerHolds = false,
  includeArchivedCustomerLines = true,
}) {
  if (typeof tenantId !== 'string' || !tenantId.trim() || typeof personId !== 'string' || !personId.trim()) {
    throw new Error('eraseCustomerMemoryInTransaction requires tenantId and personId')
  }
  if (!['PRINCIPAL_ERASURE', 'CONSENT_DECLINED'].includes(reason)) {
    throw new Error('eraseCustomerMemoryInTransaction reason is invalid')
  }

  let resealFile = null
  try {
    const customers = await tx.customer.findMany({
      where: { tenantId, personId },
      select: { id: true },
    })
    const customerIds = customers.map((customer) => customer.id)
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
    // LINE group and room ids identify shared threads. Direct threads use the
    // principal's own provider subject and are erased whole.
    const isShared = (conversation) => conversation.channel === 'LINE' && !ownSubjects.has(conversation.externalThreadId)
    const personalIds = ownedConversations.filter((conversation) => !isShared(conversation)).map((conversation) => conversation.id)
    const ownedSharedIds = ownedConversations.filter(isShared).map((conversation) => conversation.id)

    const messageKeys = personalIds.length
      ? await tx.message.findMany({
        where: { conversationId: { in: personalIds }, externalMessageId: { not: null } },
        select: { externalMessageId: true, direction: true, createdAt: true },
      })
      : []
    const { redactedLineJobs, erasedMissionEvidence, inboundMessageIds, pendingMemoryPrincipalErasures } = await redactLineConversationJobs(tx, {
      tenantId,
      conversationIds: personalIds,
      speakers: subjectChannels.filter((row) => row.channel === 'LINE'),
      erasedPrincipalId: personId,
    })

    let capturedLines = []
    if (preserveCustomerHolds && personalIds.length) {
      const directMessages = await tx.message.findMany({
        where: { conversationId: { in: personalIds } },
        select: { id: true },
      })
      capturedLines = await captureLinesBeforeErasure(tx, { tenantId, messageIds: directMessages.map((row) => row.id) })
    }
    const personal = await redactConversationContent(tx, { tenantId, conversationIds: personalIds })
    let erasedSharedMessageIds = []
    const shared = await redactSpeakerContentInSharedThreads(tx, {
      tenantId,
      channelIdentities: subjectChannels,
      customerIds,
      inboundMessageIds,
      excludeConversationIds: personalIds,
      beforeRedact: async ({ messageIds }) => {
        erasedSharedMessageIds = messageIds
        capturedLines = [...capturedLines, ...await captureLinesBeforeErasure(tx, { tenantId, messageIds })]
      },
    })

    const knowledgeErasure = await tombstoneKnowledgeCandidatesForErasure({
      tenantId,
      wholeConversationIds: personalIds,
      partialConversationIds: shared.conversationIds,
      erasedMessageIds: erasedSharedMessageIds,
      reason,
    }, { db: tx, now, viewer })
    const redactedMessages = personal.redactedMessages + shared.redactedMessages

    const speakerEvents = await findSpeakerConversationEventKeys(tx, {
      tenantId,
      customerIds,
      channelIdentities: subjectChannels,
      personalConversationIds: personalIds,
    })
    const analysedIds = [...new Set([...personalIds, ...ownedSharedIds, ...shared.conversationIds])]
    // @req FR-127 — ConversationAnalysis is an audited CRM business record,
    // not a memory projection. Consent decline keeps it under CRM's existing
    // consent-gated readers; full PDPA/principal erasure deletes derived PII.
    const analyses = reason === 'PRINCIPAL_ERASURE' && analysedIds.length
      ? await tx.conversationAnalysis.deleteMany({ where: { conversationId: { in: analysedIds } } })
      : { count: 0 }

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
    const { tombstonedRawRecords } = await tombstoneRawRecordsForExternalIds(tx, { tenantId, externalIds, lineMessages, now })

    let resealed
    try {
      resealed = await resealErasedEvidenceUnderLegalHolds(tx, {
        tenantId,
        // The existing archive reader uses these keys as possible source copies.
        erasedCustomerIds: customerIds,
        speakerChannelIdentityIds: subjectChannels.map((row) => row.id),
        capturedLines,
        now,
        env,
        baseDir: archiveBaseDir,
        // A processing-consent decline does not revoke a separate retention
        // consent or the Customer's hold. Let that Customer remain a qualifying
        // recipient; principal erasure keeps the historical exclusion.
        excludedHoldCustomerIds: preserveCustomerHolds ? [] : customerIds,
        includeArchivedCustomerLines,
      })
    } catch (error) {
      if (error?.archiveFile) resealFile = error.archiveFile
      throw error
    }
    if (resealed.file) resealFile = resealed.file

    return {
      customerIds,
      personalConversationIds: personalIds,
      sharedConversationIds: shared.conversationIds,
      redactedMessages,
      redactedLineJobs,
      erasedMissionEvidence,
      pendingMemoryPrincipalErasures,
      analyses,
      knowledgeErasure,
      shared,
      tombstonedRawRecords,
      resealed,
      resealFile,
    }
  } catch (error) {
    // The caller owns rollback cleanup. Preserve the existing archive-file
    // contract even if a later Tier 1 step fails after a file was written.
    if (resealFile && !error?.archiveFile) error.archiveFile = resealFile
    throw error
  }
}
