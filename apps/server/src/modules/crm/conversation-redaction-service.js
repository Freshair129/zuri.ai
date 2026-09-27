import { refreshConversationPreview } from './conversation-preview-service'

// @req FR-022 — the crm half of PDPA erasure: the conversation text itself.
//   Erasure lives in identity (its charter: "the only flow allowed to do so"), but
//   `Message` is a crm-owned model, so identity asks for this through a contract
//   call instead of writing another domain's table by hand. That is the target
//   state both charters already name for the `Person` redaction debt; this new
//   surface starts on the right side of it rather than adding a second exception.
// @req FR-229 — also redacts each message's MessageAttachment (fetchState → ERASED,
//   providerContentId cleared) in the same call.
// @req FR-233 — also redacts Conversation.lastMessagePreview for every affected
//   conversation in the same call.
// @spec BR-001, SEC-005, SDD-048
// @spec ADR-091 D5
// @tested tests/integration/crm-customer-erasure.test.js, tests/integration/identity-erase.test.js
// @req FR-022 — a LINE group or room thread is shared: it belongs to its first
//   speaker's Customer, yet every member writes in it. Such a thread is never erased
//   wholesale; `redactSpeakerContentInSharedThreads` redacts one speaker's own lines
//   and the replies to them, in any thread, whoever owns it.
// @tested tests/integration/identity-erase-group-speakers.test.js
//
// WHY A TOMBSTONE AND NOT A DELETE
// --------------------------------
// Deleting the rows would delete the conversation: the inbox counts messages, and a
// thread that silently loses ten of them reads as data loss, not as an honoured
// erasure request. Replacing `body` while keeping ids, direction and timestamps
// keeps the *shape* of what happened — a Business can still see that it talked to
// someone on a date and that the content is gone by law — while the personal data
// itself is no longer readable anywhere in the product.
//
// FR-233 — Conversation.lastMessagePreview is redacted in the same call: every
// Message in an affected conversation is tombstoned above, so the true "latest
// message" of every one of these conversations is now the tombstone text itself.
// refreshConversationPreview (conversation-preview-service.js) reads that back
// rather than assuming it, which is the same rule the crm charter states for any
// future preview/snippet column and the one the PDPA erasure suite already checks.
//
// FR-229 — a media message's MessageAttachment is redacted alongside its Message:
// `fetchState` moves to ERASED and `providerContentId` (LINE's own content id, the
// only thing a later fetch phase would need) is cleared, so a byte fetch can never
// retrieve what this call just erased. Nothing else on the row changes — `kind` and
// `mimeType`/`sizeBytes` (when a later phase has set them) survive, exactly as
// `direction` and timestamps survive on the Message itself.

/**
 * The one string an erased message body carries. Thai, because a Business owner reads
 * it in the FR-091 inbox; fixed, because a per-request string would make one erased
 * thread distinguishable from another.
 */
export const CUSTOMER_ERASURE_TOMBSTONE = '[ข้อความถูกลบตามคำขอ PDPA]'

/**
 * Tombstone every message in the given conversations of this tenant — the whole
 * thread, both directions. For a thread that belongs to the erased person alone
 * (a direct chat); a shared thread goes through the speaker writer below. Ids,
 * direction and timestamps are untouched.
 *
 * Idempotent: a message already carrying the tombstone is not counted or rewritten,
 * so a second erasure of the same principal reports zero rather than re-erasing.
 *
 * @param {object} tx prisma client or transaction client — the caller owns the transaction
 * @param {{tenantId: string, conversationIds: string[]}} scope
 * @returns {Promise<{conversations: number, redactedMessages: number, redactedAttachments?: number}>}
 */
export async function redactConversationContent(tx, { tenantId, conversationIds } = {}) {
  if (!tenantId) throw new Error('redactConversationContent requires tenantId')
  const requested = Array.isArray(conversationIds) ? conversationIds.filter(Boolean) : []
  if (requested.length === 0) return { conversations: 0, redactedMessages: 0 }
  // Re-read under the tenant: an id alone never reaches another tenant's thread.
  const conversations = await tx.conversation.findMany({
    where: { tenantId, id: { in: requested } },
    select: { id: true },
  })
  if (conversations.length === 0) return { conversations: 0, redactedMessages: 0 }

  const ids = conversations.map((conversation) => conversation.id)
  const redacted = await tx.message.updateMany({
    where: { conversationId: { in: ids }, body: { not: CUSTOMER_ERASURE_TOMBSTONE } },
    data: { body: CUSTOMER_ERASURE_TOMBSTONE },
  })
  const redactedAttachments = await tx.messageAttachment.updateMany({
    where: { message: { conversationId: { in: ids } }, fetchState: { not: 'ERASED' } },
    data: { fetchState: 'ERASED', providerContentId: null },
  })

  // @req FR-233 — every message in these conversations is now tombstoned, so the
  //   read-back preview reduces to the tombstone text itself. Looping rather than
  //   an updateMany: the resolver already exists and stays the single place a
  //   preview is computed (conversation-preview-service.js), which is worth an
  //   extra read query per conversation on what is already a rare, low-volume flow.
  for (const conversationId of ids) {
    await refreshConversationPreview(tx, conversationId)
  }

  return { conversations: conversations.length, redactedMessages: redacted.count, redactedAttachments: redactedAttachments.count }
}

/**
 * @req FR-022 — one speaker's own content in shared threads.
 *
 * Selects, in this tenant only and outside `excludeConversationIds` (the threads the
 * caller erases whole), the INBOUND messages this speaker wrote — by the speaker's
 * ChannelIdentity recorded at ingest, or by the inbound id of an answer job admitted
 * for the speaker (the job's `sourceUserId`, for rows written before the author
 * column existed) — plus the stack reply to each of them (`reply:<inboundId>`),
 * which repeats the answer text the job erasure clears. A row with no author and no
 * job is first attributed through its MESSAGE_INGESTED audit row (see
 * `attributeFromIngestAudit`), and that attribution is written back, so rows the
 * migration backfill never reached (written between the column and the code going
 * live) close as they are found. Every other member's lines, the replies to them
 * and staff messages stay exactly as they are.
 *
 * Idempotent in the same way as the whole-thread writer.
 *
 * @param {object} tx prisma client or transaction client — the caller owns the transaction
 * @param {{tenantId: string, channelIdentities?: {id: string, channel: string, channelAccountId: string}[],
 *   customerIds?: string[], inboundMessageIds?: string[], excludeConversationIds?: string[]}} scope
 * @returns {Promise<{conversationIds: string[], externalMessageIds: string[], redactedMessages: number,
 *   redactedAttachments: number, attributedMessages: number}>}
 */
export async function redactSpeakerContentInSharedThreads(tx, {
  tenantId, channelIdentities, customerIds, inboundMessageIds, excludeConversationIds,
} = {}) {
  if (!tenantId) throw new Error('redactSpeakerContentInSharedThreads requires tenantId')
  const speakerIdentities = (channelIdentities ?? []).filter((row) => row?.id && row.channel && row.channelAccountId)
  const attributedMessages = await attributeFromIngestAudit(tx, {
    tenantId, customerIds: [...new Set((customerIds ?? []).filter(Boolean))], channelIdentities: speakerIdentities,
  })
  const identities = [...new Set(speakerIdentities.map((row) => row.id))]
  const inbound = [...new Set((inboundMessageIds ?? []).filter(Boolean))]
  const excluded = [...new Set((excludeConversationIds ?? []).filter(Boolean))]
  const empty = { conversationIds: [], externalMessageIds: [], redactedMessages: 0, redactedAttachments: 0, attributedMessages }
  const selectors = [
    ...(identities.length ? [{ authorChannelIdentityId: { in: identities } }] : []),
    ...(inbound.length ? [{ id: { in: inbound } }] : []),
  ]
  if (selectors.length === 0) return empty

  const authored = await tx.message.findMany({
    where: {
      direction: 'INBOUND',
      conversation: { tenantId, ...(excluded.length ? { id: { notIn: excluded } } : {}) },
      OR: selectors,
    },
    select: { id: true, conversationId: true, externalMessageId: true },
  })
  if (authored.length === 0) return empty

  const conversationIds = [...new Set(authored.map((message) => message.conversationId))]
  const replies = await tx.message.findMany({
    where: {
      direction: 'OUTBOUND',
      conversationId: { in: conversationIds },
      // `reply:<inboundId>` is recordLineReply's key (reply-record-service.js
      // replyExternalId); spelled here rather than imported, since that module
      // pulls the LINE runtime into this leaf writer's import graph.
      externalMessageId: { in: authored.map((message) => `reply:${message.id}`) },
    },
    select: { id: true, externalMessageId: true },
  })
  const touched = [...authored, ...replies]
  const messageIds = touched.map((message) => message.id)
  const redacted = await tx.message.updateMany({
    where: { id: { in: messageIds }, body: { not: CUSTOMER_ERASURE_TOMBSTONE } },
    data: { body: CUSTOMER_ERASURE_TOMBSTONE },
  })
  const redactedAttachments = await tx.messageAttachment.updateMany({
    where: { messageId: { in: messageIds }, fetchState: { not: 'ERASED' } },
    data: { fetchState: 'ERASED', providerContentId: null },
  })
  // @req FR-233 — the tombstoned line may be the thread's latest; read it back.
  for (const conversationId of conversationIds) {
    await refreshConversationPreview(tx, conversationId)
  }
  return {
    conversationIds,
    externalMessageIds: touched.map((message) => message.externalMessageId).filter(Boolean),
    redactedMessages: redacted.count,
    redactedAttachments: redactedAttachments.count,
    attributedMessages,
  }
}

/**
 * @req FR-022 — erase-time attribution for an INBOUND row with no author.
 *
 * `ingestLineMessage` records one MESSAGE_INGESTED audit row per message it writes,
 * and that payload names the speaker's Customer (not the thread owner's), the
 * message id and the channel account. For each of the erased person's Customers the
 * matching rows are read; a message is attributed only when the audit row's tenant,
 * conversation and channel account all agree with the message's own Conversation,
 * and the person has a ChannelIdentity on exactly that channel and account. The
 * author column is then written, so the same row never needs this lookup again.
 * Returns how many rows it attributed.
 *
 * The payload is matched by text first (`"customerId":"<id>"`, the exact shape
 * `recordAudit` stringifies) and then parsed and checked; the text match only
 * narrows the read, it never decides.
 */
async function attributeFromIngestAudit(tx, { tenantId, customerIds, channelIdentities }) {
  if (customerIds.length === 0 || channelIdentities.length === 0) return 0
  const owners = new Set(customerIds)
  const claims = new Map()
  for (const customerId of customerIds) {
    const rows = await tx.auditEvent.findMany({
      where: { entityType: 'CONVERSATION', action: 'MESSAGE_INGESTED',
        payloadJson: { contains: `"customerId":${JSON.stringify(customerId)}` } },
      select: { entityId: true, payloadJson: true },
    })
    for (const row of rows) {
      let payload = null
      try { payload = JSON.parse(row.payloadJson) } catch { payload = null }
      if (payload?.tenantId !== tenantId || !owners.has(payload.customerId)
        || typeof payload.messageId !== 'string' || (payload.direction ?? 'INBOUND') !== 'INBOUND') continue
      claims.set(payload.messageId, { conversationId: row.entityId, channelAccountId: payload.channelAccountId })
    }
  }
  if (claims.size === 0) return 0
  const messages = await tx.message.findMany({
    where: { id: { in: [...claims.keys()] }, direction: 'INBOUND', authorChannelIdentityId: null, conversation: { tenantId } },
    select: { id: true, conversationId: true, conversation: { select: { channel: true, channelAccountId: true } } },
  })
  let attributed = 0
  for (const message of messages) {
    const claim = claims.get(message.id)
    if (claim.conversationId !== message.conversationId || claim.channelAccountId !== message.conversation.channelAccountId) continue
    const identity = channelIdentities.find((row) => row.channel === message.conversation.channel
      && row.channelAccountId === message.conversation.channelAccountId)
    if (!identity) continue
    const updated = await tx.message.updateMany({
      where: { id: message.id, authorChannelIdentityId: null },
      data: { authorChannelIdentityId: identity.id },
    })
    attributed += updated.count
  }
  return attributed
}
