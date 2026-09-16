import { randomBytes } from 'node:crypto'

// @req FR-243 — conversation sessions: a long-lived LINE conversation reads as
//   separate sittings. A message joins the conversation's latest session while the
//   previous message is newer than the account's idle timeout; otherwise it opens a
//   new one. A reply joins the session of the message it answers; an event takes the
//   open session or none (ADR-094 D1–D3).
// @spec ADR-094, SDD-102, BR-002
// @tested tests/unit/conversation-session-service.test.js, tests/integration/crm-conversation-sessions.test.js
//
// WHERE THE LOCK COMES FROM
// -------------------------
// Every writer here runs inside the transaction that writes the message, and each
// assignment starts by writing the Conversation row (`updatedAt`). On Postgres that
// UPDATE takes the row lock, so a second delivery for the same conversation waits
// for the first to commit and then reads the session the first one opened; on SQLite
// every write already serializes on the database. No raw `SELECT ... FOR UPDATE` is
// needed, which keeps one code path for both engines.
//
// WHICH CLOCK
// -----------
// `occurredAt` is the provider's time for the message (LINE's `event.timestamp`,
// clamped by the caller so a skewed future value cannot move a session), never the
// time this server happened to process it — a webhook redelivered minutes later
// still lands in the sitting it belongs to.
//
// NO SWEEPER
// ----------
// A session is closed once its last message is older than the timeout; that is a
// fact derivable at any read. `closedAt` is written only when the next session opens,
// and it is the moment the session became closed (last message + timeout), not the
// moment somebody noticed.

export const DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES = 30
export const MIN_SESSION_IDLE_TIMEOUT_MINUTES = 10
export const MAX_SESSION_IDLE_TIMEOUT_MINUTES = 120

const MINUTE_MS = 60_000

/** A timeout the account stored, or the default when it is missing or out of range. */
export function effectiveIdleTimeoutMinutes(value) {
  const minutes = Number(value)
  if (!Number.isInteger(minutes)) return DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES
  if (minutes < MIN_SESSION_IDLE_TIMEOUT_MINUTES || minutes > MAX_SESSION_IDLE_TIMEOUT_MINUTES) {
    return DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES
  }
  return minutes
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now())
  return Number.isFinite(date.getTime()) ? date : new Date()
}

/**
 * Pure: does a message at `occurredAt` still belong to `session`?
 * Inclusive at the boundary — exactly `timeout` minutes of silence still joins.
 */
export function continuesSession(session, occurredAt, idleTimeoutMinutes) {
  if (!session) return false
  const last = toDate(session.lastMessageAt).getTime()
  return toDate(occurredAt).getTime() <= last + effectiveIdleTimeoutMinutes(idleTimeoutMinutes) * MINUTE_MS
}

/**
 * Pure: the moment a session became closed — its last message plus the timeout that
 * decided it closed (the account's current one), falling back to the session's own.
 */
export function closedAtFor(session, idleTimeoutMinutes = session.idleTimeoutMinutes) {
  return new Date(toDate(session.lastMessageAt).getTime() + effectiveIdleTimeoutMinutes(idleTimeoutMinutes) * MINUTE_MS)
}

/** `S-20260915-7K2Q9A`: the open date in Asia/Bangkok and six random base-36 characters. */
export function sessionCode(openedAt, random = randomBytes) {
  const bangkok = new Date(toDate(openedAt).getTime() + 7 * 60 * MINUTE_MS)
  const day = bangkok.toISOString().slice(0, 10).replace(/-/g, '')
  const suffix = [...random(6)].map((byte) => (byte % 36).toString(36)).join('').toUpperCase()
  return `S-${day}-${suffix}`
}

async function latestSession(db, conversationId) {
  return db.conversationSession.findFirst({
    where: { conversationId },
    orderBy: [{ openedAt: 'desc' }, { createdAt: 'desc' }],
  })
}

async function lockConversation(db, conversationId) {
  await db.conversation.update({ where: { id: conversationId }, data: { updatedAt: new Date() } })
}

/**
 * Assign the session of a message being written, inside the caller's transaction.
 *
 * @param {object} db a transaction client
 * @param {{conversation: {id: string, tenantId: string, businessId?: string|null, customerId: string, channelAccountId: string},
 *   occurredAt?: Date|string, direction?: 'INBOUND'|'OUTBOUND', idleTimeoutMinutes?: number}} input
 * @returns {Promise<{session: object, opened: boolean}>}
 */
export async function assignMessageSession(db, { conversation, occurredAt, direction = 'INBOUND', idleTimeoutMinutes }) {
  const at = toDate(occurredAt)
  const timeout = effectiveIdleTimeoutMinutes(idleTimeoutMinutes)
  const counter = direction === 'OUTBOUND' ? 'outboundCount' : 'inboundCount'
  await lockConversation(db, conversation.id)
  const latest = await latestSession(db, conversation.id)

  // The account's timeout as it is now decides, so a changed setting applies to the
  // next message; `idleTimeoutMinutes` on the row records what was in force at opening.
  if (continuesSession(latest, at, timeout)) {
    const session = await db.conversationSession.update({
      where: { id: latest.id },
      data: {
        [counter]: { increment: 1 },
        ...(at.getTime() > toDate(latest.lastMessageAt).getTime() ? { lastMessageAt: at } : {}),
      },
    })
    return { session, opened: false }
  }

  if (latest && !latest.closedAt) {
    await db.conversationSession.update({ where: { id: latest.id }, data: { closedAt: closedAtFor(latest, timeout) } })
  }
  const session = await db.conversationSession.create({
    data: {
      code: sessionCode(at),
      tenantId: conversation.tenantId,
      businessId: conversation.businessId ?? null,
      conversationId: conversation.id,
      customerId: conversation.customerId,
      channelAccountId: conversation.channelAccountId,
      openedAt: at,
      lastMessageAt: at,
      idleTimeoutMinutes: timeout,
      [counter]: 1,
    },
  })
  return { session, opened: true }
}

/**
 * A reply joins the session of the inbound message it answers and never opens one.
 * Returns null when that message has no session (a row written before sessions
 * existed and not yet backfilled) — the reply is then recorded without one.
 */
export async function joinReplySession(db, { conversationId, inboundSessionId, occurredAt }) {
  if (!inboundSessionId) return null
  const at = toDate(occurredAt)
  await lockConversation(db, conversationId)
  const session = await db.conversationSession.findUnique({ where: { id: inboundSessionId } })
  if (!session || session.conversationId !== conversationId) return null
  // A session already closed by a later one keeps its closing: the late reply is
  // counted in it but does not stretch its last-message time past its own close.
  const extends_ = !session.closedAt && at.getTime() > toDate(session.lastMessageAt).getTime()
  return db.conversationSession.update({
    where: { id: session.id },
    data: { outboundCount: { increment: 1 }, ...(extends_ ? { lastMessageAt: at } : {}) },
  })
}

/** An event takes the session open at `occurredAt`, or none. It never opens or extends one. */
export async function openSessionIdAt(db, { conversationId, occurredAt, idleTimeoutMinutes }) {
  const latest = await latestSession(db, conversationId)
  if (!latest || latest.closedAt) return null
  const at = toDate(occurredAt).getTime()
  if (at < toDate(latest.openedAt).getTime()) return null
  return continuesSession(latest, occurredAt, idleTimeoutMinutes ?? latest.idleTimeoutMinutes) ? latest.id : null
}
