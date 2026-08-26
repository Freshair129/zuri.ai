import { z } from 'zod'
import prisma from '@/lib/db'
import { CHANNELS, MESSAGE_DIRECTIONS } from '@/lib/validation/enums'
import { seesBusiness } from '@/modules/identity/viewer-authority'

// @req FR-091 — the CRM Conversation Inbox read model: one authorized, read-only
//   composition over Customer/Conversation/Message, which the FR-023 ingest seam has
//   been writing since the first LINE turn with no surface able to read them.
// @spec SDD-050, BR-001, BR-011, SEC-001, SEC-009
// @tested tests/unit/conversation-read-model.test.js, tests/integration/crm-conversation-inbox.test.js
//
// **This module exports readers only, and that is the enforcement.** BR-011 gives the
// reply to exactly one owner — the edge runtime holding the channel credential and the
// ~30s reply token. A console that could also reply would be a second reply owner. So
// there is no writer here to reach for: the boundary is the absence, not a comment.
//
// **Query count is constant in the number of conversations** (SDD-050). The per-row
// message count and last message come from two grouped queries over the page's ids,
// never one query per row — the N+1 SDD-047 already paid for once on the Projects
// Dashboard.

export const CONVERSATION_INBOX_VERSION = '1.0'
export const INBOX_ROW_LIMIT = 200
export const PREVIEW_LENGTH = 140

// --- Query contract ---------------------------------------------------------

const trimmedId = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() || undefined : value),
  z.string().min(1),
)

const optionalLimit = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.coerce.number().int().positive()
    .transform((value) => Math.min(value, INBOX_ROW_LIMIT))
    .optional(),
)

export const zConversationInboxQuery = z.object({
  businessId: trimmedId,
  limit: optionalLimit,
}).strict()

export function parseConversationInboxQuery(query = {}) {
  const parsed = zConversationInboxQuery.parse(query)
  return { businessId: parsed.businessId, limit: parsed.limit ?? INBOX_ROW_LIMIT }
}

export const zConversationThreadQuery = z.object({ businessId: trimmedId }).strict()

export function parseConversationThreadQuery(query = {}) {
  return { businessId: zConversationThreadQuery.parse(query).businessId }
}

// --- Scope ------------------------------------------------------------------

function denied(status, message) {
  const error = new Error(message)
  error.status = status
  return error
}

/**
 * The scope every read in this module runs inside.
 *
 * @spec BR-001 — the CRM is shared across the businesses of ONE tenant, so the scope is
 *   the Tenant of the Business the console has open, not that Business alone. Scoping to
 *   the Business would both contradict the rule and render an empty page in the normal
 *   case: an unbound LINE binding writes `businessId: null`.
 * @spec SEC-001 — tenant-sharing is a CRM rule, not a licence. A conversation owned by a
 *   Business outside `visibleBusinessIds` is excluded **by the query**, so an out-of-scope
 *   row is never fetched and then filtered — there is nothing to forget to filter.
 */
async function resolveScope({ viewer, businessId }) {
  if (!seesBusiness(viewer, businessId)) throw denied(403, 'Business access denied')

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, tenantId: true, name: true },
  })
  if (!business) throw denied(404, 'Business not found')

  // Businesses of this tenant that this viewer may see. `null` stays alongside them
  // because a tenant-shared conversation belongs to no Business and is therefore
  // refused by no Business grant.
  const tenantBusinesses = await prisma.business.findMany({
    where: { tenantId: business.tenantId },
    select: { id: true, name: true },
  })
  const visible = tenantBusinesses.filter((candidate) => seesBusiness(viewer, candidate.id))

  return {
    tenantId: business.tenantId,
    business,
    businessNameById: new Map(visible.map((row) => [row.id, row.name])),
    where: {
      tenantId: business.tenantId,
      OR: [{ businessId: null }, { businessId: { in: visible.map((row) => row.id) } }],
    },
  }
}

// --- Composition ------------------------------------------------------------

const preview = (body) => {
  const text = String(body ?? '').replace(/\s+/g, ' ').trim()
  return text.length > PREVIEW_LENGTH ? `${text.slice(0, PREVIEW_LENGTH)}…` : text
}

const customerDto = (customer) => ({
  id: customer.id,
  code: customer.code,
  displayName: customer.displayName,
  lifecycleStage: customer.lifecycleStage,
  // @req FR-103 — SEC-005 consent, read alongside the Customer this reader
  //   already composes. This module stays read-only (no writer added): the
  //   attestation write lives in customer-consent-service.js, a sibling module.
  consentStatus: customer.consentStatus,
  consentRecordedAt: customer.consentRecordedAt ? customer.consentRecordedAt.toISOString() : null,
  consentNote: customer.consentNote,
})

/**
 * The inbox: the tenant's conversations, most recently updated first, each with the
 * one line a reader needs to decide whether to open it.
 */
export async function getConversationInbox({ viewer, businessId, limit = INBOX_ROW_LIMIT }) {
  const scope = await resolveScope({ viewer, businessId })

  const conversations = await prisma.conversation.findMany({
    where: scope.where,
    orderBy: { updatedAt: 'desc' },
    take: limit,
    select: {
      id: true,
      businessId: true,
      channel: true,
      status: true,
      externalThreadId: true,
      createdAt: true,
      updatedAt: true,
      customer: {
        select: {
          id: true,
          code: true,
          displayName: true,
          lifecycleStage: true,
          consentStatus: true,
          consentRecordedAt: true,
          consentNote: true,
        },
      },
    },
  })

  const ids = conversations.map((row) => row.id)

  // Two grouped queries for the whole page, not two per row (SDD-050).
  const [counts, recentMessages] = ids.length === 0
    ? [[], []]
    : await Promise.all([
      prisma.message.groupBy({
        by: ['conversationId', 'direction'],
        where: { conversationId: { in: ids } },
        _count: { _all: true },
      }),
      // `_max: { createdAt }` would name the moment but not the message, and a second
      // lookup per row to turn it into text is the N+1 again. Reading the page's
      // messages once and keeping the newest per conversation is one query either way.
      prisma.message.findMany({
        where: { conversationId: { in: ids } },
        orderBy: { createdAt: 'desc' },
        select: { id: true, conversationId: true, direction: true, body: true, createdAt: true },
      }),
    ])

  const countByConversation = new Map()
  const byDirection = Object.fromEntries(MESSAGE_DIRECTIONS.map((direction) => [direction, 0]))
  for (const row of counts) {
    countByConversation.set(row.conversationId, (countByConversation.get(row.conversationId) || 0) + row._count._all)
    if (row.direction in byDirection) byDirection[row.direction] += row._count._all
  }

  const latestByConversation = new Map()
  for (const message of recentMessages) {
    if (!latestByConversation.has(message.conversationId)) latestByConversation.set(message.conversationId, message)
  }

  const rows = conversations.map((conversation) => {
    const latest = latestByConversation.get(conversation.id) || null
    return {
      id: conversation.id,
      channel: conversation.channel,
      status: conversation.status,
      externalThreadId: conversation.externalThreadId,
      businessId: conversation.businessId,
      // Null is not missing data — it is a conversation the tenant shares rather than
      // one a Business owns, and the surface says so instead of printing a blank.
      businessName: conversation.businessId ? scope.businessNameById.get(conversation.businessId) ?? null : null,
      customer: customerDto(conversation.customer),
      messageCount: countByConversation.get(conversation.id) || 0,
      lastMessage: latest
        ? {
          id: latest.id,
          direction: latest.direction,
          preview: preview(latest.body),
          createdAt: latest.createdAt.toISOString(),
        }
        : null,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    }
  })

  const byChannel = Object.fromEntries(CHANNELS.map((channel) => [channel, 0]))
  for (const row of rows) if (row.channel in byChannel) byChannel[row.channel] += 1

  return {
    version: CONVERSATION_INBOX_VERSION,
    scope: { businessId: scope.business.id, businessName: scope.business.name, tenantId: scope.tenantId },
    counts: {
      conversations: rows.length,
      customers: new Set(rows.map((row) => row.customer.id)).size,
      messages: rows.reduce((total, row) => total + row.messageCount, 0),
      byDirection,
      byChannel,
    },
    limit,
    truncated: rows.length === limit,
    conversations: rows,
  }
}

/**
 * One thread, oldest message first — the order a conversation is read in.
 *
 * The conversation is fetched through the same scope predicate as the list, so an id
 * belonging to another tenant answers as absent rather than as forbidden: a "denied"
 * would confirm the row exists, which is disclosure by status code (SEC-001).
 */
export async function getConversationThread({ viewer, businessId, conversationId }) {
  const scope = await resolveScope({ viewer, businessId })

  const conversation = await prisma.conversation.findFirst({
    where: { ...scope.where, id: conversationId },
    select: {
      id: true,
      businessId: true,
      channel: true,
      status: true,
      externalThreadId: true,
      createdAt: true,
      updatedAt: true,
      customer: {
        select: {
          id: true,
          code: true,
          displayName: true,
          lifecycleStage: true,
          consentStatus: true,
          consentRecordedAt: true,
          consentNote: true,
        },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        select: { id: true, direction: true, body: true, externalMessageId: true, createdAt: true },
      },
    },
  })

  if (!conversation) throw denied(404, 'Conversation not found')

  return {
    version: CONVERSATION_INBOX_VERSION,
    scope: { businessId: scope.business.id, businessName: scope.business.name, tenantId: scope.tenantId },
    conversation: {
      id: conversation.id,
      channel: conversation.channel,
      status: conversation.status,
      externalThreadId: conversation.externalThreadId,
      businessId: conversation.businessId,
      businessName: conversation.businessId ? scope.businessNameById.get(conversation.businessId) ?? null : null,
      customer: customerDto(conversation.customer),
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
    },
    messages: conversation.messages.map((message) => ({
      id: message.id,
      direction: message.direction,
      body: message.body,
      externalMessageId: message.externalMessageId,
      createdAt: message.createdAt.toISOString(),
    })),
  }
}
