import prisma from '@/lib/db'
import { uniqueHumanCode } from '@/lib/ids'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { resolveLineIdentity } from '@/modules/identity/resolve-line-identity'
import { LEGACY_CHANNEL_ACCOUNT_ID } from '@/modules/identity/channel-identity'
import { zIngestLineMessageInput } from '@/lib/validation/entities'

// @req FR-023 — inbound LINE identity, customer, conversation and message are atomic.
// @req FR-097 — trusted channel account is carried into identity discovery.
// @req FR-148 — account-scoped threads, business isolation and transaction composition.
// @spec ADR-061, ADR-044, ADR-045, BR-001, BR-002, SEC-001, SEC-018
// @tested tests/integration/line-ingest.test.js, tests/integration/line-account-isolation.test.js

const CHANNEL = 'LINE'
const conversationKey = (tenantId, channelAccountId, threadId) => ({
  tenantId_channel_channelAccountId_externalThreadId: {
    tenantId, channel: CHANNEL, channelAccountId, externalThreadId: threadId,
  },
})

function failure(status, message) {
  return Object.assign(new Error(message), { status })
}

/**
 * Ingest once inside the caller's transaction. A duplicate returns created.message
 * false: callers must reuse their queued result, never invoke a second model turn.
 * Known accounts require Business scope; legacy direct callers may omit it.
 *
 * With a transaction client, unique/serialization failures propagate: its owner
 * must retry the ENTIRE transaction (including its enqueue), never an aborted tx.
 */
export async function ingestLineMessage(input, { db = prisma } = {}) {
  const data = zIngestLineMessageInput.parse(input)
  if (typeof db.$transaction === 'function') {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await db.$transaction((tx) => ingestLineMessage(data, { db: tx }))
      } catch (error) {
        if (attempt >= 2 || !['P2002', 'P2034'].includes(error?.code)) throw error
      }
    }
  }

  const { tenantId, businessId, lineUserId, displayName, threadId, text, externalMessageId, direction, correlationId } = data
  const channelAccountId = data.channelAccountId?.trim() || LEGACY_CHANNEL_ACCOUNT_ID
  if (channelAccountId !== LEGACY_CHANNEL_ACCOUNT_ID && !businessId) throw failure(400, 'BUSINESS_REQUIRED_FOR_CHANNEL_ACCOUNT')
  if (businessId) {
    const business = await db.business.findFirst({ where: { id: businessId, tenantId }, select: { id: true } })
    if (!business) throw failure(404, 'BUSINESS_NOT_FOUND')
  }

  let conversation = await db.conversation.findUnique({ where: conversationKey(tenantId, channelAccountId, threadId) })
  // A binding change is not permission to move an existing conversation. Check this
  // even for a duplicate, before returning any row identifiers to the caller.
  if (conversation && businessId !== undefined && conversation.businessId !== businessId) {
    throw failure(409, 'CONVERSATION_BUSINESS_SCOPE_CONFLICT')
  }

  const identity = await resolveLineIdentity({ tenantId, lineUserId, channelAccountId, displayName }, { db })
  if (externalMessageId && conversation) {
    const duplicate = await db.message.findUnique({
      where: { conversationId_externalMessageId: { conversationId: conversation.id, externalMessageId } },
    })
    if (duplicate) {
      return {
        personId: identity.personId, customerId: conversation.customerId,
        conversationId: conversation.id, messageId: duplicate.id,
        created: { customer: false, conversation: false, message: false },
      }
    }
  }

  let customer = await db.customer.findUnique({ where: { tenantId_personId: { tenantId, personId: identity.personId } } })
  const createdCustomer = !customer
  if (!customer) {
    const code = await uniqueHumanCode('CUS', displayName || lineUserId,
      async (candidate) => Boolean(await db.customer.findUnique({ where: { code: candidate } })))
    customer = await db.customer.create({
      data: { code, tenantId, businessId: businessId ?? null, personId: identity.personId, displayName: displayName || 'LINE customer' },
    })
  }

  const createdConversation = !conversation
  if (!conversation) {
    conversation = await db.conversation.create({
      data: { tenantId, businessId: businessId ?? null, customerId: customer.id, channel: CHANNEL, channelAccountId, externalThreadId: threadId },
    })
  }
  const message = await db.message.create({
    data: { conversationId: conversation.id, direction, body: text, externalMessageId: externalMessageId ?? null },
  })
  await db.conversation.update({ where: { id: conversation.id }, data: { updatedAt: new Date() } })
  await recordAudit(db, {
    entityType: 'CONVERSATION', entityId: conversation.id, action: 'MESSAGE_INGESTED', actorType: 'LINE',
    // @spec NFR-017 — durable correlation without duplicating message content.
    payload: {
      tenantId, businessId: conversation.businessId, channelAccountId,
      customerId: customer.id, direction, messageId: message.id,
      ...(correlationId ? { correlationId } : {}),
    },
  })
  return {
    personId: identity.personId, customerId: customer.id,
    conversationId: conversation.id, messageId: message.id,
    created: { customer: createdCustomer, conversation: createdConversation, message: true },
  }
}
