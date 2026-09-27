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
// @req FR-022 — `findSpeakerConversationEventKeys` names one person's own
//   conversation events (a postback, follow or unfollow they sent, in any thread)
//   so identity can tombstone their raw webhook payloads.
// @tested tests/integration/identity-erase-speaker-events.test.js
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

/**
 * @req FR-022, SEC-034 — attribute INBOUND rows that carry no author, by the same
 * evidence erasure uses, and write the attribution back. The chat evidence archive
 * calls this before it seals a batch, so a row the author backfill never reached is
 * sealed under its speaker's key, not the thread owner's — otherwise erasing that
 * speaker would leave the line readable, and erasing the owner would shred it.
 *
 * For each unattributed INBOUND row of this tenant among `messageIds`:
 *   1. the answer job admitted for it (`inboundMessageId`): its `sourceUserId` on the
 *      job's own channel account, which must be the message's Conversation's, names
 *      the speaker's ChannelIdentity; else
 *   2. its MESSAGE_INGESTED audit row (read per Conversation, the audit's entity):
 *      the speaker's Customer, on the Conversation's channel account, and that
 *      Customer's Person's ChannelIdentity on exactly that channel and account.
 * A row neither can attribute stays unattributed. Written only where the column is
 * still null, so it never overwrites an existing author.
 *
 * @param {object} db prisma client or transaction client
 * @param {{tenantId: string, messageIds: string[]}} scope
 * @returns {Promise<Map<string, string>>} message id → ChannelIdentity id, for the rows written
 */
export async function attributeInboundMessageAuthors(db, { tenantId, messageIds } = {}) {
  if (!tenantId) throw new Error('attributeInboundMessageAuthors requires tenantId')
  const written = new Map()
  const ids = [...new Set((messageIds ?? []).filter(Boolean))]
  if (ids.length === 0) return written
  const rows = await db.message.findMany({
    where: { id: { in: ids }, direction: 'INBOUND', authorChannelIdentityId: null, conversation: { tenantId } },
    select: { id: true, conversationId: true, conversation: { select: { channel: true, channelAccountId: true } } },
  })
  if (rows.length === 0) return written
  const byId = new Map(rows.map((row) => [row.id, row]))
  const found = new Map()

  const jobs = await db.lineConversationJob.findMany({
    where: { tenantId, inboundMessageId: { in: rows.map((row) => row.id) } },
    select: { inboundMessageId: true, channelAccountId: true, sourceUserId: true },
  })
  for (const job of jobs) {
    const row = byId.get(job.inboundMessageId)
    if (!row || row.conversation.channel !== 'LINE' || job.channelAccountId !== row.conversation.channelAccountId
      || typeof job.sourceUserId !== 'string' || !job.sourceUserId) continue
    const identity = await db.channelIdentity.findFirst({
      where: { tenantId, channel: 'LINE', channelAccountId: job.channelAccountId, providerSubject: job.sourceUserId },
      select: { id: true },
    })
    if (identity) found.set(row.id, identity.id)
  }

  const pending = rows.filter((row) => !found.has(row.id))
  if (pending.length) {
    const audits = await db.auditEvent.findMany({
      where: { entityType: 'CONVERSATION', action: 'MESSAGE_INGESTED',
        entityId: { in: [...new Set(pending.map((row) => row.conversationId))] } },
      select: { entityId: true, payloadJson: true },
    })
    const speakerCustomer = new Map()
    const wanted = new Set(pending.map((row) => row.id))
    for (const audit of audits) {
      let payload = null
      try { payload = JSON.parse(audit.payloadJson) } catch { payload = null }
      if (payload?.tenantId !== tenantId || !wanted.has(payload.messageId) || typeof payload.customerId !== 'string'
        || (payload.direction ?? 'INBOUND') !== 'INBOUND') continue
      const row = byId.get(payload.messageId)
      if (audit.entityId !== row.conversationId || payload.channelAccountId !== row.conversation.channelAccountId) continue
      speakerCustomer.set(row.id, payload.customerId)
    }
    const customers = speakerCustomer.size
      ? await db.customer.findMany({ where: { tenantId, id: { in: [...new Set(speakerCustomer.values())] } }, select: { id: true, personId: true } })
      : []
    const personOf = new Map(customers.map((customer) => [customer.id, customer.personId]))
    for (const [messageId, customerId] of speakerCustomer) {
      const row = byId.get(messageId)
      const personId = personOf.get(customerId)
      if (!personId) continue
      const identity = await db.channelIdentity.findFirst({
        where: { tenantId, personId, channel: row.conversation.channel, channelAccountId: row.conversation.channelAccountId },
        select: { id: true },
      })
      if (identity) found.set(messageId, identity.id)
    }
  }

  for (const [messageId, identityId] of found) {
    const updated = await db.message.updateMany({
      where: { id: messageId, authorChannelIdentityId: null },
      data: { authorChannelIdentityId: identityId },
    })
    if (updated.count === 1) written.set(messageId, identityId)
  }
  return written
}

// Which events name a speaker: only `ingestLineConversationEvent` (line-ingest-service.js)
// writes a CONVERSATION_EVENT_RECORDED audit row carrying a `customerId` — the one
// writer for the event kinds whose LINE payload names one individual in
// `event.source.userId` (postback, follow, unfollow). Join/leave/member events and
// unsend resolve no identity and record no Customer, so they are never attributed.

/**
 * @req FR-022 — the provider event ids of one person's own conversation events,
 * so identity can tombstone their raw webhook payloads (the postback `data`, the
 * speaker's LINE user id) through the integration writer in the same transaction.
 *
 * A `ConversationEvent` row keeps ids only (FR-229: a postback's `data` string is
 * never stored on it), and its `externalEventId` is LINE's `webhookEventId` — the
 * same key the LINE normalizer gives the raw record. So the row stays as the
 * envelope, exactly as a tombstoned message keeps its envelope, and only its key
 * is returned. Two families:
 *   - every event in `personalConversationIds` (a thread that is this person's
 *     alone, erased whole — the direct-chat rule), and
 *   - in any other thread of the tenant, a POSTBACK / FOLLOW / UNFOLLOW this person
 *     sent, attributed through its CONVERSATION_EVENT_RECORDED audit row. Ingest
 *     writes that row in the event's own transaction and names the SPEAKER's
 *     Customer, not the thread owner's; an event is taken only when the audit
 *     row's tenant, conversation, channel account and kind all agree with the
 *     event and its Conversation, and the person has a ChannelIdentity on exactly
 *     that channel and account (the same checks `attributeFromIngestAudit` makes).
 * Every other member's events are never selected.
 *
 * Read-only: it writes nothing, so it is idempotent by construction.
 *
 * @param {object} tx prisma client or transaction client
 * @param {{tenantId: string, customerIds?: string[], channelIdentities?: {channel: string, channelAccountId: string}[],
 *   personalConversationIds?: string[]}} scope
 * @returns {Promise<{externalEventIds: string[], sharedEvents: number}>}
 */
export async function findSpeakerConversationEventKeys(tx, {
  tenantId, customerIds, channelIdentities, personalConversationIds,
} = {}) {
  if (!tenantId) throw new Error('findSpeakerConversationEventKeys requires tenantId')
  const personal = [...new Set((personalConversationIds ?? []).filter(Boolean))]
  const owners = new Set((customerIds ?? []).filter(Boolean))
  const identities = (channelIdentities ?? []).filter((row) => row?.channel && row.channelAccountId)
  const keys = new Set()

  if (personal.length) {
    const rows = await tx.conversationEvent.findMany({
      where: { conversationId: { in: personal }, conversation: { tenantId } },
      select: { externalEventId: true },
    })
    for (const row of rows) keys.add(row.externalEventId)
  }

  let sharedEvents = 0
  if (owners.size && identities.length) {
    const claims = new Map()
    for (const customerId of owners) {
      // Matched by text first (`"customerId":"<id>"`, the exact shape `recordAudit`
      // stringifies), then parsed and checked; the text match only narrows the read.
      const rows = await tx.auditEvent.findMany({
        where: { entityType: 'CONVERSATION', action: 'CONVERSATION_EVENT_RECORDED',
          payloadJson: { contains: `"customerId":${JSON.stringify(customerId)}` } },
        select: { entityId: true, payloadJson: true },
      })
      for (const row of rows) {
        let payload = null
        try { payload = JSON.parse(row.payloadJson) } catch { payload = null }
        if (payload?.tenantId !== tenantId || !owners.has(payload.customerId)
          || typeof payload.eventId !== 'string' || typeof payload.kind !== 'string') continue
        claims.set(payload.eventId, { conversationId: row.entityId, channelAccountId: payload.channelAccountId, kind: payload.kind })
      }
    }
    if (claims.size) {
      const events = await tx.conversationEvent.findMany({
        where: { id: { in: [...claims.keys()] }, conversation: { tenantId } },
        select: { id: true, kind: true, externalEventId: true, conversationId: true,
          conversation: { select: { channel: true, channelAccountId: true } } },
      })
      for (const event of events) {
        const claim = claims.get(event.id)
        if (claim.conversationId !== event.conversationId || claim.kind !== event.kind
          || claim.channelAccountId !== event.conversation.channelAccountId) continue
        const speaks = identities.some((row) => row.channel === event.conversation.channel
          && row.channelAccountId === event.conversation.channelAccountId)
        if (!speaks) continue
        if (!keys.has(event.externalEventId)) sharedEvents += 1
        keys.add(event.externalEventId)
      }
    }
  }
  return { externalEventIds: [...keys], sharedEvents }
}
