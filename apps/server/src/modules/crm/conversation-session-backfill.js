import prisma from '@/lib/db'
import { LEGACY_CHANNEL_ACCOUNT_ID } from '@/modules/identity/channel-identity'
import { replyExternalId } from './reply-record-service'
import { closedAtFor, effectiveIdleTimeoutMinutes, sessionCode } from './conversation-session-service'

// @req FR-243 — existing messages are assigned to sessions by the same rule the
//   application uses (ADR-094 D2): a message joins the current sitting while the
//   previous message is within the account's idle timeout, a reply joins the
//   sitting of the message it answers, an event takes the sitting open when it
//   occurred. Idempotent, and safe after the migration has already let live
//   admission open sessions.
// @spec ADR-094 D1–D3, SDD-102
// @tested tests/unit/conversation-session-service.test.js, tests/integration/crm-conversation-sessions.test.js
//
// WHY A MESSAGE THAT ALREADY HAS A SESSION IS NEVER REGROUPED
// ----------------------------------------------------------
// Live admission decides a session by LINE's timestamp, while `Message.createdAt`
// is this server's clock. Regrouping live rows by `createdAt` would second-guess a
// decision made with better evidence. So only rows with no session are grouped, and
// an existing session takes part only through its own `openedAt` and
// `lastMessageAt` — the two moments it vouches for.

const MINUTE_MS = 60_000
const REPLY_PREFIX = replyExternalId('')

const time = (value) => new Date(value).getTime()
const answersOf = (message) => (typeof message.externalMessageId === 'string' && message.externalMessageId.startsWith(REPLY_PREFIX)
  ? message.externalMessageId.slice(REPLY_PREFIX.length) : null)

/**
 * Pure: plan the sittings for one conversation.
 *
 * @param {{messages: Array<{id: string, direction: string, createdAt: Date|string, sessionId?: string|null, externalMessageId?: string|null}>,
 *   sessions?: Array<{id: string, openedAt: Date|string, lastMessageAt: Date|string}>, idleTimeoutMinutes?: number}} input
 * @returns {Array<{sessionId: string|null, messageIds: string[], openedAt: Date, lastMessageAt: Date, inboundCount: number, outboundCount: number}>}
 *   one entry per sitting that gains at least one message, plus every existing session
 *   (with zero counts when it gains none), ordered by opening time.
 */
export function planSittings({ messages, sessions = [], idleTimeoutMinutes }) {
  const timeoutMs = effectiveIdleTimeoutMinutes(idleTimeoutMinutes) * MINUTE_MS
  const assigned = new Map(messages.filter((m) => m.sessionId).map((m) => [m.id, m.sessionId]))
  const bySession = new Map()
  const groups = []
  const entry = (sessionId, at) => {
    if (sessionId && bySession.has(sessionId)) return bySession.get(sessionId)
    const group = { sessionId: sessionId ?? null, messageIds: [], open: at, last: at, inboundCount: 0, outboundCount: 0 }
    groups.push(group)
    if (sessionId) bySession.set(sessionId, group)
    return group
  }
  for (const session of sessions) {
    const group = entry(session.id, time(session.openedAt))
    group.open = Math.min(group.open, time(session.openedAt))
    group.last = Math.max(group.last, time(session.lastMessageAt))
  }
  const add = (group, message, at, stretch) => {
    group.messageIds.push(message.id)
    if (message.direction === 'OUTBOUND') group.outboundCount += 1
    else group.inboundCount += 1
    group.open = Math.min(group.open, at)
    if (stretch) group.last = Math.max(group.last, at)
  }

  const pending = messages.filter((m) => !m.sessionId)
    .sort((a, b) => time(a.createdAt) - time(b.createdAt) || String(a.id).localeCompare(String(b.id)))
  const groupOf = new Map()
  let current = null
  for (const message of pending) {
    const at = time(message.createdAt)
    const answers = answersOf(message)
    // A reply joins the sitting of the message it answers and never opens or
    // stretches one.
    if (answers && assigned.has(answers)) {
      const group = entry(assigned.get(answers), at)
      add(group, message, at, false)
      continue
    }
    if (answers && groupOf.has(answers)) {
      const group = groupOf.get(answers)
      add(group, message, at, group === current)
      groupOf.set(message.id, group)
      continue
    }
    // Inside an existing session's own span: that session.
    let group = groups.find((g) => g.sessionId && at >= g.open && at <= g.last) ?? null
    // Within the timeout of the current sitting, or just before an existing session opens.
    if (!group && current && at <= current.last + timeoutMs) group = current
    if (!group) group = groups.find((g) => g.sessionId && at < g.open && at >= g.open - timeoutMs) ?? null
    if (!group) group = entry(null, at)
    add(group, message, at, true)
    groupOf.set(message.id, group)
    current = group
  }

  return groups
    .sort((a, b) => a.open - b.open)
    .map((g) => ({
      sessionId: g.sessionId, messageIds: g.messageIds,
      openedAt: new Date(g.open), lastMessageAt: new Date(g.last),
      inboundCount: g.inboundCount, outboundCount: g.outboundCount,
    }))
}

/** Pure: the index of the sitting open at `occurredAt`, or -1. */
export function sittingIndexAt(sittings, occurredAt, idleTimeoutMinutes) {
  const at = time(occurredAt)
  const timeoutMs = effectiveIdleTimeoutMinutes(idleTimeoutMinutes) * MINUTE_MS
  for (let i = sittings.length - 1; i >= 0; i -= 1) {
    const sitting = sittings[i]
    if (at >= time(sitting.openedAt) && at <= time(sitting.lastMessageAt) + timeoutMs) return i
  }
  return -1
}

async function accountTimeout(db, conversation) {
  if (!conversation.channelAccountId || conversation.channelAccountId === LEGACY_CHANNEL_ACCOUNT_ID) return effectiveIdleTimeoutMinutes()
  const account = await db.lineOaAccount.findFirst({
    where: { tenantId: conversation.tenantId, OR: [{ bindingCode: conversation.channelAccountId }, { id: conversation.channelAccountId }] },
    select: { sessionIdleTimeoutMinutes: true },
  })
  return effectiveIdleTimeoutMinutes(account?.sessionIdleTimeoutMinutes)
}

async function backfillConversation(db, conversation, { apply }) {
  const timeout = await accountTimeout(db, conversation)
  const [messages, sessions, events] = await Promise.all([
    db.message.findMany({
      where: { conversationId: conversation.id },
      select: { id: true, direction: true, createdAt: true, sessionId: true, externalMessageId: true },
    }),
    db.conversationSession.findMany({ where: { conversationId: conversation.id } }),
    db.conversationEvent.findMany({ where: { conversationId: conversation.id, sessionId: null }, select: { id: true, occurredAt: true } }),
  ])
  const sittings = planSittings({ messages, sessions, idleTimeoutMinutes: timeout })
  const report = {
    conversationId: conversation.id,
    sessionsToCreate: sittings.filter((s) => !s.sessionId).length,
    messagesToAssign: messages.filter((m) => !m.sessionId).length,
    eventsToCheck: events.length,
  }
  if (!apply || (report.messagesToAssign === 0 && report.eventsToCheck === 0)) return report

  const resolved = []
  for (const [index, sitting] of sittings.entries()) {
    const isLast = index === sittings.length - 1
    const closing = isLast ? {} : { closedAt: closedAtFor({ lastMessageAt: sitting.lastMessageAt }, timeout) }
    let sessionId = sitting.sessionId
    if (sessionId) {
      await db.conversationSession.update({
        where: { id: sessionId },
        data: {
          openedAt: sitting.openedAt, lastMessageAt: sitting.lastMessageAt, ...closing,
          ...(sitting.inboundCount ? { inboundCount: { increment: sitting.inboundCount } } : {}),
          ...(sitting.outboundCount ? { outboundCount: { increment: sitting.outboundCount } } : {}),
        },
      })
    } else {
      const created = await db.conversationSession.create({
        data: {
          code: sessionCode(sitting.openedAt),
          tenantId: conversation.tenantId, businessId: conversation.businessId ?? null,
          conversationId: conversation.id, customerId: conversation.customerId,
          channelAccountId: conversation.channelAccountId, idleTimeoutMinutes: timeout,
          openedAt: sitting.openedAt, lastMessageAt: sitting.lastMessageAt, ...closing,
          inboundCount: sitting.inboundCount, outboundCount: sitting.outboundCount,
        },
      })
      sessionId = created.id
    }
    resolved.push({ ...sitting, sessionId })
    if (sitting.messageIds.length) {
      await db.message.updateMany({ where: { id: { in: sitting.messageIds }, sessionId: null }, data: { sessionId } })
    }
  }
  for (const event of events) {
    const index = sittingIndexAt(resolved, event.occurredAt, timeout)
    if (index >= 0) await db.conversationEvent.update({ where: { id: event.id }, data: { sessionId: resolved[index].sessionId } })
  }
  return report
}

/**
 * Backfill every conversation that still has a message or event without a session.
 * A dry run (the default) writes nothing and reports what an apply would do.
 *
 * @param {{db?: object, apply?: boolean, tenantId?: string}} [options]
 */
export async function backfillConversationSessions({ db = prisma, apply = false, tenantId } = {}) {
  const conversations = await db.conversation.findMany({
    where: {
      ...(tenantId ? { tenantId } : {}),
      OR: [{ messages: { some: { sessionId: null } } }, { events: { some: { sessionId: null } } }],
    },
    select: { id: true, tenantId: true, businessId: true, customerId: true, channelAccountId: true },
    orderBy: { createdAt: 'asc' },
  })
  const reports = []
  for (const conversation of conversations) {
    const run = (tx) => backfillConversation(tx, conversation, { apply })
    reports.push(apply && typeof db.$transaction === 'function' ? await db.$transaction(run) : await run(db))
  }
  const total = (key) => reports.reduce((sum, report) => sum + report[key], 0)
  return {
    apply, conversations: reports.length,
    sessionsToCreate: total('sessionsToCreate'), messagesToAssign: total('messagesToAssign'), eventsToCheck: total('eventsToCheck'),
  }
}
