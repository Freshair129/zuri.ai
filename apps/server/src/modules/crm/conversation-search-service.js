import { z } from 'zod'
import prisma, { resolvePostgresUrl } from '@/lib/db'
import { resolveScope, CONVERSATION_INBOX_VERSION } from './conversation-read-model'
import { truncateConversationPreview } from './conversation-preview-service'

// @req FR-233 — the CRM inbox's third, read-only reader (design §6.9): full-text
//   search over Message.body, and per-account follow/unfollow counts from
//   ConversationEvent. This module exports readers only, for the same reason
//   conversation-read-model.js does — search must never become a second write
//   path into models the ingest seam owns (crm charter).
// @spec BR-001, SEC-001, SDD-050
//
// AUTHORIZATION: both readers below take their scope through
// `resolveScope` (conversation-read-model.js), which calls
// `assertDomainVisible(viewer, businessId, 'customer')` before either query
// runs — the same FR-061 domain-grant check `getConversationInbox` already
// enforces (tests/unit/domain-visibility-server-enforcement.test.js follows
// exactly one import hop, which is why that predicate's name is written out
// here rather than left implicit).
// @tested tests/integration/crm-conversation-search.test.js
//
// TRIGRAM ON POSTGRES, LIKE ON SQLITE — ONE QUERY, NOT TWO CODE PATHS
// --------------------------------------------------------------------
// Prisma's `contains` compiles to `LIKE '%…%'` (SQLite) or `LIKE`/`ILIKE '%…%'`
// (Postgres, `mode: 'insensitive'`) either way — the same call shape on both
// engines. What differs is invisible to this module: the Postgres migration
// creates a `pg_trgm` GIN index on Message.body, which the planner can use for
// this exact operator; SQLite has no such index and does a full scan, which is
// what "LIKE on SQLite" already meant before this reader existed. `mode:
// 'insensitive'` is a Postgres-only Prisma option — passed only when the
// runtime is actually on Postgres (resolvePostgresUrl()), because SQLite
// rejects it as an unknown argument rather than ignoring it.

export const SEARCH_ROW_LIMIT = 100

const trimmedId = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() || undefined : value),
  z.string().min(1),
)
const optionalTrimmed = z.preprocess(
  (value) => (typeof value === 'string' ? value.trim() || undefined : value),
  z.string().min(1).optional(),
)
const optionalLimit = z.preprocess(
  (value) => (value === '' || value === undefined ? undefined : value),
  z.coerce.number().int().positive()
    .transform((value) => Math.min(value, SEARCH_ROW_LIMIT))
    .optional(),
)

export const zConversationSearchQuery = z.object({
  businessId: trimmedId,
  query: z.string().trim().min(1).max(200),
  channelAccountId: optionalTrimmed,
  limit: optionalLimit,
}).strict()

export function parseConversationSearchQuery(query = {}) {
  const parsed = zConversationSearchQuery.parse(query)
  return {
    businessId: parsed.businessId,
    query: parsed.query,
    channelAccountId: parsed.channelAccountId,
    limit: parsed.limit ?? SEARCH_ROW_LIMIT,
  }
}

/**
 * Search Message.body for `query`, scoped to the viewer's visible Businesses
 * within the Tenant `businessId` anchors (the same BR-001 scope
 * `getConversationInbox` reads through — never a message from a Business the
 * viewer cannot see, even inside a shared Tenant), and optionally to one LINE OA
 * account.
 */
export async function searchConversationMessages({ viewer, businessId, query, channelAccountId, limit = SEARCH_ROW_LIMIT }) {
  const scope = await resolveScope({ viewer, businessId })

  const usingPostgres = Boolean(resolvePostgresUrl())
  const bodyFilter = usingPostgres ? { contains: query, mode: 'insensitive' } : { contains: query }

  const rows = await prisma.message.findMany({
    where: {
      conversation: { ...scope.where, ...(channelAccountId ? { channelAccountId } : {}) },
      body: bodyFilter,
    },
    orderBy: { createdAt: 'desc' },
    take: limit,
    select: {
      id: true,
      conversationId: true,
      direction: true,
      body: true,
      createdAt: true,
      conversation: {
        select: {
          id: true,
          businessId: true,
          channelAccountId: true,
          customer: { select: { id: true, code: true, displayName: true } },
        },
      },
    },
  })

  return {
    version: CONVERSATION_INBOX_VERSION,
    scope: { businessId: scope.business.id, businessName: scope.business.name, tenantId: scope.tenantId },
    query,
    channelAccountId: channelAccountId ?? null,
    limit,
    truncated: rows.length === limit,
    results: rows.map((message) => ({
      messageId: message.id,
      conversationId: message.conversationId,
      direction: message.direction,
      preview: truncateConversationPreview(message.body),
      createdAt: message.createdAt.toISOString(),
      businessId: message.conversation.businessId,
      businessName: message.conversation.businessId
        ? scope.businessNameById.get(message.conversation.businessId) ?? null
        : null,
      channelAccountId: message.conversation.channelAccountId,
      customer: message.conversation.customer
        ? {
          id: message.conversation.customer.id,
          code: message.conversation.customer.code,
          displayName: message.conversation.customer.displayName,
        }
        : null,
    })),
  }
}

export const zConversationEventCountsQuery = z.object({
  businessId: trimmedId,
  channelAccountId: optionalTrimmed,
}).strict()

export function parseConversationEventCountsQuery(query = {}) {
  const parsed = zConversationEventCountsQuery.parse(query)
  return { businessId: parsed.businessId, channelAccountId: parsed.channelAccountId }
}

/**
 * Per-account follow/unfollow counts from ConversationEvent (design §6.9 — what
 * the Studio dashboard needs before an Insight pull exists, ADR-060 Phase 4).
 * Same scope predicate as the inbox and search, so these counts can never leak
 * a Business the viewer cannot see either.
 */
export async function getConversationEventCounts({ viewer, businessId, channelAccountId }) {
  const scope = await resolveScope({ viewer, businessId })

  const grouped = await prisma.conversationEvent.groupBy({
    by: ['kind'],
    where: {
      conversation: { ...scope.where, ...(channelAccountId ? { channelAccountId } : {}) },
      kind: { in: ['FOLLOW', 'UNFOLLOW'] },
    },
    _count: { _all: true },
  })

  const counts = { FOLLOW: 0, UNFOLLOW: 0 }
  for (const row of grouped) if (row.kind in counts) counts[row.kind] = row._count._all

  return {
    version: CONVERSATION_INBOX_VERSION,
    scope: { businessId: scope.business.id, businessName: scope.business.name, tenantId: scope.tenantId },
    channelAccountId: channelAccountId ?? null,
    counts: { follow: counts.FOLLOW, unfollow: counts.UNFOLLOW },
  }
}
