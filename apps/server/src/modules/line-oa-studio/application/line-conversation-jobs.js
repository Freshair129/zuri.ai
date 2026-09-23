import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { ingestLineMessage, ingestLineConversationEvent, recordExistingConversationEvent, ingestLineUnsendEvent } from '@/modules/crm/line-ingest-service'
import { appendOutbound } from '@/modules/crm/reply-record-service'
import { assertMayView, assertMayPublish, notFound } from './line-oa-account-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { appendTraceEvent, readExecutionTrace, playbackTrace, sha256 } from '@/modules/agent/execution-trace'
import { createLineExecutionTrace } from '@/modules/agent/line-execution-trace'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { prepareMemoryDeliveryPending, reconcileLineMemoryDeliveries } from './line-memory-delivery'
import { isAccountWithinBusinessHours } from '../domain/line-oa-account'
import { lineExecutionBudget } from '../domain/line-execution-budget'
import { isLineProjectWorkCommand, handleLineProjectWorkCommand } from '@/modules/agent/line-project-work-tools'
import { zEdgeContextReceipt } from '@/modules/agent/edge-context-receipt'

// @req FR-149, FR-150 — durable admission, optional compute, fenced send and receipt recovery.
// @req FR-171 — context and execution journal, attempt identity and truthful send observations.
// @req FR-229 — non-text message kinds and non-message events are admitted into the
//   CRM record instead of being discarded; none of them creates an answer job.
// @req FR-244 — outside the account's declared business hours, admission creates the
//   job straight at READY with the out-of-hours text as its answer, so it is sent and
//   recorded by the existing send phase and never reaches execution (ADR-094 D6 option A).
// @req FR-265 — execution is server-only (ADR-100 D1, D2). The edge claim,
//   context, tools, complete and fail entry points are withdrawn, and with them
//   the memory/corpus context packets that existed only to hand a device enough
//   to answer with. `LineConversationJob.executionMode` and `modelAccess` are
//   still written, always with their one surviving value, because they are the
//   ledger's record of how a turn ran and a column that stops being written
//   reads as "unknown" rather than "server".
// @spec ADR-061, SEC-001, FR-148 — queue and CRM share a transaction; devices cannot send.
// @spec ADR-091 D5; ADR-094 D6
// @tested tests/integration/server-line-jobs.test.js, tests/integration/line-non-text-admission.test.js,
//   tests/integration/fr244-line-oa-business-hours.test.js

export const LINE_JOB_LEASE_MS = 300_000

// @req FR-265 — `LineConversationJob.modelAccess` recorded whether a turn was
// allowed to reach an external provider. ADR-100 D3 retires the policy: every
// server answer calls the configured provider under the Business's own key, so
// there is one value left and this is it. The column keeps being written so that
// a job row never reads as "no policy recorded"; nothing reads it back.
const RETIRED_MODEL_ACCESS = 'EXTERNAL_MODEL_ALLOWED'
const JOB_TTL_MS = 30 * 60_000
const RETRY_WINDOW_MS = 23 * 60 * 60_000
const WAITING = ['QUEUED', 'CLAIMED', 'READY']
const runtimeInstanceId = randomUUID()
// @req FR-265 — `zCompletion` outlives the withdrawn edge completion route: the
// server worker still parses its own answer text through `zCompletion.shape.text`,
// which is what bounds a model's reply. The matching `zFailure` had exactly one
// caller, `failEdgeConversation`, and goes with it.
const zCompletion = z.object({ version: z.number().int().positive(), text: z.string().trim().min(1).max(5000),
  executionId: z.string().uuid().optional(), contextReceipts: z.array(zEdgeContextReceipt).max(3).optional() }).strict()
const failure = (status, message) => Object.assign(new Error(message), { status })
const sourceTimeMs = timestamp => Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime())
  ? new Date(timestamp).getTime() : null
const sourceTime = timestamp => { const ms = sourceTimeMs(timestamp); return ms === null ? null : new Date(ms).toISOString() }
// @req FR-243 — the time a message belongs to for its session: LINE's own timestamp,
//   clamped to our clock so a skewed future value cannot move a session (SDD-102).
const providerTime = (timestamp, now = new Date()) => { const ms = sourceTimeMs(timestamp); return new Date(ms === null ? now.getTime() : Math.min(ms, now.getTime())) }

function traceEvent(db, job, kind, key, payload, occurredAt = new Date(), options) {
  return appendTraceEvent(db, { scope: { tenantId: job.tenantId, businessId: job.businessId },
    turnId: job.id, executionId: job.executionId ?? null, kind,
    idempotencyKey: `${job.id}:${key}`, payload, occurredAt }, options)
}

function sealKey(env) {
  const key = env.ZURI_LINE_REPLY_SEAL_KEY
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/i.test(key)) throw failure(503, 'LINE_REPLY_SEAL_KEY_REQUIRED')
  return Buffer.from(key, 'hex')
}

export function sealLineReplyToken(token, accountId, env = process.env) {
  if (!token) return null
  const nonce = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', sealKey(env), nonce)
  cipher.setAAD(Buffer.from(accountId))
  const bytes = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()])
  return [nonce, cipher.getAuthTag(), bytes].map(b => b.toString('base64url')).join('.')
}

export function unsealLineReplyToken(value, accountId, env = process.env) {
  try {
    const [nonce, tag, bytes] = value.split('.').map(s => Buffer.from(s, 'base64url'))
    const decipher = createDecipheriv('aes-256-gcm', sealKey(env), nonce)
    decipher.setAAD(Buffer.from(accountId))
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(bytes), decipher.final()]).toString('utf8')
  } catch { throw failure(503, 'LINE_REPLY_TOKEN_UNAVAILABLE') }
}

function activeAccount(account, job) {
  return account?.serverEnabled === true && account.transportMode === 'CLOUD'
    && account.status === 'CONNECTED' && (!job || account.transportEpoch === job.transportEpoch)
}

// FR-229 — LINE message.type values that are media (recorded with a
// MessageAttachment); STICKER and LOCATION are message types too but carry no
// attachment (design §6.3).
const MEDIA_ATTACHMENT_KINDS = { image: 'IMAGE', video: 'VIDEO', audio: 'AUDIO', file: 'FILE' }
const NON_TEXT_MESSAGE_TYPES = new Set(['sticker', 'location', ...Object.keys(MEDIA_ATTACHMENT_KINDS)])
// Event types whose payload carries a resolvable individual (event.source.userId
// is always present on these, per LINE's own webhook contract).
const DIRECT_IDENTITY_EVENT_KINDS = { follow: 'FOLLOW', unfollow: 'UNFOLLOW', postback: 'POSTBACK' }
// Event types with no individual identity in the payload at all (a group/room
// join/leave has no source.userId); memberJoined/memberLeft carry member ids
// under event.joined/event.left rather than event.source, but still name no
// single "sender" the way follow/unfollow/postback do — see admitLineThreadEvent.
const THREAD_ONLY_EVENT_KINDS = { join: 'JOIN', leave: 'LEAVE', memberJoined: 'MEMBER_JOINED', memberLeft: 'MEMBER_LEFT' }
const MEDIA_PLACEHOLDERS = { IMAGE: '[รูปภาพ]', VIDEO: '[วิดีโอ]', AUDIO: '[ไฟล์เสียง]', FILE: '[ไฟล์แนบ]' }

// FR-229 says "a fixed placeholder body" — fixed, not "fixed shape with the
// provider's own values interpolated in". A sticker's packageId/stickerId are
// harmless as ids, but location's latitude/longitude are personal data (often a
// home or delivery address), and Message.body is exactly what the FR-091 inbox
// preview, FR-233 search and any future prompt read — so both stay genuinely
// fixed strings with nothing provider-supplied inside them. The raw LINE payload
// (packageId/stickerId/lat/lng included) is still available in RawExternalRecord
// under its own retention window; this placeholder is never where that detail
// needs to live.
const STICKER_PLACEHOLDER = '[สติกเกอร์]'
const LOCATION_PLACEHOLDER = '[ตำแหน่ง]'

/**
 * FR-229 — classify a non-text `message` event into what admission must write.
 * Returns `{}` (no contentKind) for a message type this admission does not yet
 * understand, which the caller treats as skipped, exactly like an unrecognised
 * event type.
 */
function classifyNonTextMessage(message) {
  const type = message?.type
  if (type === 'sticker') return { contentKind: 'STICKER', body: STICKER_PLACEHOLDER }
  if (type === 'location') return { contentKind: 'LOCATION', body: LOCATION_PLACEHOLDER }
  const attachmentKind = MEDIA_ATTACHMENT_KINDS[type]
  if (attachmentKind) {
    return {
      contentKind: 'MEDIA_REF', body: MEDIA_PLACEHOLDERS[attachmentKind],
      attachment: { kind: attachmentKind, providerContentId: message.id },
    }
  }
  return {}
}

async function atomic(db, work) {
  for (let attempt = 0; ; attempt++) {
    try {
      // FR-149/150's admission transaction now also appends an execution trace
      // (#290) inside the same transaction; on 2026-09-08 that pushed real
      // admissions past Prisma's 5s default and every one failed with P2028
      // ("Transaction already closed") once the observed round-trip cost
      // (~200ms/query over the session-mode pool, ADR-058 D9) accumulated
      // across the extra trace writes. 15s gives headroom without hiding a
      // regression silently — see .brain/rca/2026-09-08-line-webhook-*.md.
      return await db.$transaction(work, { timeout: 15000, maxWait: 5000 })
    } catch (error) {
      if (attempt >= 2 || !['P2002', 'P2034'].includes(error.code)) throw error
    }
  }
}

/**
 * Called only after signature and destination validation. No authority from event
 * text. FR-229 dispatches to the right narrow writer by event/message type; every
 * non-text branch returns `{ skipped: true, ... }` because none of them creates an
 * answer job (bounded text replies only, ADR-061 D8).
 */
export async function admitLineConversation(args) {
  const { event } = args
  if (event.type === 'message') {
    if (event.message?.type === 'text') return admitLineTextMessage(args)
    if (NON_TEXT_MESSAGE_TYPES.has(event.message?.type)) return admitLineNonTextMessage(args)
    return { skipped: true }
  }
  if (event.type === 'unsend') return admitLineUnsend(args)
  if (DIRECT_IDENTITY_EVENT_KINDS[event.type]) return admitLineDirectEvent(args, DIRECT_IDENTITY_EVENT_KINDS[event.type])
  if (THREAD_ONLY_EVENT_KINDS[event.type]) return admitLineThreadEvent(args, THREAD_ONLY_EVENT_KINDS[event.type])
  return { skipped: true }
}

/** Resolve the current account inside the admission transaction and check it is
 * still the CLOUD owner for this epoch — the guard every admitted event shares,
 * text or not. */
async function withAdmittedAccount(db, account, work) {
  return atomic(db, async (tx) => {
    const current = await tx.lineOaAccount.findUnique({ where: { id: account.id } })
    if (!activeAccount(current) || current.transportEpoch !== account.transportEpoch) throw failure(409, 'LINE_ACCOUNT_NOT_SERVER_OWNED')
    const channelAccountId = current.bindingCode || current.id
    return work(tx, current, channelAccountId)
  })
}

async function admitLineTextMessage({ account, event, correlationId, now = new Date(), ingressReceivedAt = now, env = process.env, db = prisma }) {
  const userId = event.source?.userId
  const threadId = event.source?.groupId || event.source?.roomId || userId
  const audienceKind = event.source?.type === 'group' ? 'GROUP' : event.source?.type === 'room' ? 'ROOM' : 'DIRECT'
  const eventId = event.webhookEventId || event.message?.id
  const text = event.message?.text
  if (!userId || !threadId || !eventId || !event.message?.id || typeof text !== 'string' || !text.trim()) return { skipped: true }
  if (text.length > 10000) throw failure(400, 'LINE_TEXT_TOO_LONG')
  const shouldReply = event.source?.type === 'user' || /ซูริ|zuri/i.test(text)
  const sealed = shouldReply ? sealLineReplyToken(event.replyToken, account.id, env) : null
  // The reply-token deadline is anchored to when LINE issued the event, not to `now`: this
  // function runs again on each post-ack retry (+4s, +12s) with a later `now`, and a retry
  // must not extend a deadline it does not control. Clamp so a skewed/future event.timestamp
  // cannot push the anchor past our own ingress clock either.
  const eventTimeMs = sourceTimeMs(event.timestamp)
  const replyDeadlineAnchorMs = eventTimeMs === null ? ingressReceivedAt.getTime() : Math.min(eventTimeMs, ingressReceivedAt.getTime())
  return atomic(db, async tx => {
    const current = await tx.lineOaAccount.findUnique({ where: { id: account.id } })
    if (!activeAccount(current) || current.transportEpoch !== account.transportEpoch) throw failure(409, 'LINE_ACCOUNT_NOT_SERVER_OWNED')
    const existing = await tx.lineConversationJob.findUnique({ where: { accountId_eventId: { accountId: account.id, eventId } } })
    if (existing) return { jobId: existing.id, created: false, inboundMessageId: existing.inboundMessageId }
    const channelAccountId = current.bindingCode || current.id
    const inbound = await ingestLineMessage({ tenantId: current.tenantId, businessId: current.businessId,
      channelAccountId, lineUserId: userId, threadId, text, externalMessageId: event.message.id, correlationId,
      occurredAt: providerTime(event.timestamp, ingressReceivedAt), sessionIdleTimeoutMinutes: current.sessionIdleTimeoutMinutes }, { db: tx })
    if (!shouldReply) return { skipped: true, inboundMessageId: inbound.messageId }
    const prior = await tx.lineConversationJob.findUnique({ where: { inboundMessageId: inbound.messageId } })
    if (prior) return { jobId: prior.id, created: false, inboundMessageId: inbound.messageId }
    // @req FR-244 — outside the account's declared business hours, the reply is the
    // fixed out-of-hours text and no model runs (ADR-094 D6 option A). The job is
    // created straight at READY with its answer already set, so it never reaches
    // QUEUED/CLAIMED and no execution ever claims it — the tick worker's existing
    // send phase (status: 'READY') delivers and records it exactly like any other
    // completed job, through the same reply-token/push, retry and OUTBOUND_RECORDED
    // path. `isAccountWithinBusinessHours` returns true for an account with no
    // declared hours, so this branch is a no-op for every account that never opted in.
    const outOfHours = !isAccountWithinBusinessHours(current, now) && Boolean(current.outOfHoursReplyText)
    const job = await tx.lineConversationJob.create({ data: {
      accountId: current.id, inboundMessageId: inbound.messageId, eventId,
      // @req FR-243 — the session the inbound message was just assigned (ADR-094 D4).
      sessionId: inbound.sessionId ?? null,
      tenantId: current.tenantId, businessId: current.businessId, channelAccountId,
      transportEpoch: current.transportEpoch,
      // @req FR-265 — one execution placement remains (ADR-100 D1). This read the
      // account's `executionMode` and forced SERVER for work commands; there is
      // nothing left to force. `modelAccess` is written as the retired constant
      // rather than copied from the account, because the account no longer
      // carries a policy and nothing reads the job's copy.
      executionMode: 'SERVER',
      modelAccess: RETIRED_MODEL_ACCESS, allowDelayedPush: current.allowDelayedPush,
      // This is immutable trusted LINE admission provenance. The opt-in flag is
      // a per-job decision captured at the same boundary; later env changes do
      // not enroll or silently drop an already admitted job.
      audienceKind, memorySyncOptIn: env.ZURI_MSP_THREAD_MEMORY_ENABLED === 'true',
      recipientId: threadId, sourceUserId: userId, sealedReplyToken: sealed,
      replyExpiresAt: sealed ? new Date(replyDeadlineAnchorMs + 45_000) : null,
      availableAt: now, expiresAt: new Date(now.getTime() + JOB_TTL_MS), correlationId,
      ...(outOfHours ? { status: 'READY', answerText: current.outOfHoursReplyText } : {}),
    } })
    await recordAudit(tx, { entityType: 'LINE_CONVERSATION_JOB', entityId: job.id, action: 'QUEUED',
      payload: { tenantId: job.tenantId, businessId: job.businessId, accountId: job.accountId, correlationId, ...(outOfHours ? { outOfHours: true } : {}) } })
    await traceEvent(tx, job, 'TURN_RECEIVED', 'received', {
      inboundMessageId: inbound.messageId, conversationId: inbound.conversationId,
      inputSnapshot: { role: 'user', content: text }, inputHash: sha256({ role: 'user', content: text }),
      externalEventId: eventId, externalNamespace: 'LINE',
      sourceOccurredAt: sourceTime(event.timestamp),
      ingressReceivedAt: ingressReceivedAt.toISOString(), queuedAt: now.toISOString(),
      // The transaction's visibility is the durable admission boundary.
      persistenceRecordedAt: new Date().toISOString(),
    // PERF (2026-09-09): `job.id` was created a few lines above in this same still-open
    // transaction, so no writer anywhere can have touched it yet — the turn-open lock,
    // and the tombstone check that bypassTurnGuard skips are both guaranteed no-ops here.
    // Every later trace event for this job (EXECUTION_STARTED, SEND_STARTED, ...) runs in
    // its own later transaction and keeps the real guard.
    }, now, { bypassTurnGuard: true })
    // @req FR-244 — mirrors settleExecution's own ANSWER_READY shape (the normal
    // execution path emits the same kind with the same payload keys) so a trace
    // reader sees one vocabulary for "the answer is ready to send" regardless of
    // where the text came from; `executionEvidence` is the field that says which.
    if (outOfHours) {
      await traceEvent(tx, job, 'ANSWER_READY', 'answer-ready', {
        text: current.outOfHoursReplyText, answerReadyAt: now.toISOString(), executionEvidence: 'OUT_OF_HOURS_RULE',
      }, now)
    }
    return { jobId: job.id, created: true, inboundMessageId: inbound.messageId }
  })
}

/**
 * FR-229 — a non-text message (sticker, location, image, video, audio, file):
 * admission no longer skips it. A Message is created with its `contentKind` and,
 * for media, a `MessageAttachment` recorded without bytes. No answer job — the
 * return shape mirrors the text path's "no reply needed" branch on purpose.
 */
async function admitLineNonTextMessage({ account, event, correlationId, db = prisma }) {
  const userId = event.source?.userId
  const threadId = event.source?.groupId || event.source?.roomId || userId
  const eventId = event.webhookEventId || event.message?.id
  if (!userId || !threadId || !eventId || !event.message?.id) return { skipped: true }
  const { contentKind, body, attachment } = classifyNonTextMessage(event.message)
  if (!contentKind) return { skipped: true }
  return withAdmittedAccount(db, account, async (tx, current, channelAccountId) => {
    const inbound = await ingestLineMessage({
      tenantId: current.tenantId, businessId: current.businessId, channelAccountId,
      lineUserId: userId, threadId, text: body, externalMessageId: event.message.id,
      contentKind, attachment, correlationId,
      occurredAt: providerTime(event.timestamp), sessionIdleTimeoutMinutes: current.sessionIdleTimeoutMinutes,
    }, { db: tx })
    return { skipped: true, inboundMessageId: inbound.messageId, conversationId: inbound.conversationId }
  })
}

/**
 * FR-229 — follow, unfollow, postback: these always carry `event.source.userId`, so
 * they resolve identity and create-or-attach a Conversation exactly as an inbound
 * message would, then record a `ConversationEvent`. No answer job.
 */
async function admitLineDirectEvent({ account, event, correlationId, db = prisma }, kind) {
  const userId = event.source?.userId
  const threadId = event.source?.groupId || event.source?.roomId || userId
  const eventId = event.webhookEventId
  if (!userId || !threadId || !eventId) return { skipped: true }
  return withAdmittedAccount(db, account, async (tx, current, channelAccountId) => {
    // POSTBACK's own `data` string is deliberately not stored — it is free text, not
    // an id, and FR-229 requires the payload to carry ids only. The raw evidence row
    // (RawExternalRecord) already keeps it for the retained evidence window.
    const result = await ingestLineConversationEvent({
      tenantId: current.tenantId, businessId: current.businessId, channelAccountId,
      lineUserId: userId, threadId, kind, externalEventId: eventId, payload: {}, correlationId,
      occurredAt: providerTime(event.timestamp), sessionIdleTimeoutMinutes: current.sessionIdleTimeoutMinutes,
    }, { db: tx })
    return { skipped: true, conversationId: result.conversationId, eventId: result.eventId }
  })
}

/**
 * FR-229 — join, leave, memberJoined, memberLeft: none of these names an
 * individual the way follow/unfollow/postback do (a group/room join has no
 * `source.userId`), so the event attaches only to a conversation that already
 * exists for the thread; when none does, it is skipped (documented scope decision
 * — see the task report).
 *
 * Raw LINE user ids for the joining/leaving members are deliberately never
 * persisted here: `ConversationEvent` is Tier 1 (inside the erasure boundary),
 * and this admission path resolves no identity for a member and mints no
 * Customer for them (the join/leave decision above), so there is no erasure hook
 * that could ever reach a raw id sitting in this payload — it would outlive the
 * very principal it named. `memberCount` carries the fact LINE reported without
 * carrying anyone's provider identifier.
 */
async function admitLineThreadEvent({ account, event, db = prisma, correlationId }, kind) {
  const threadId = event.source?.groupId || event.source?.roomId
  const eventId = event.webhookEventId
  if (!threadId || !eventId) return { skipped: true }
  const memberCount = kind === 'MEMBER_JOINED' ? (event.joined?.members ?? []).length
    : kind === 'MEMBER_LEFT' ? (event.left?.members ?? []).length
      : 0
  return withAdmittedAccount(db, account, async (tx, current, channelAccountId) => {
    const result = await recordExistingConversationEvent({
      tenantId: current.tenantId, businessId: current.businessId, channelAccountId,
      threadId, kind, externalEventId: eventId, payload: memberCount ? { memberCount } : {}, correlationId,
      occurredAt: providerTime(event.timestamp), sessionIdleTimeoutMinutes: current.sessionIdleTimeoutMinutes,
    }, { db: tx })
    return { skipped: true, conversationId: result.conversationId ?? null, eventId: result.eventId ?? null }
  })
}

/**
 * FR-229 — `unsend`: unlike follow/unfollow/postback, this resolves no identity
 * and mints no Customer — it attaches only to a conversation that already exists
 * for the thread (same rule as join/leave/memberJoined/memberLeft) and is skipped
 * otherwise, since a thread with no record has nothing to tombstone. When the
 * conversation exists, it additionally tombstones the referenced Message body and
 * MessageAttachment; recording never fails when the referenced message is unknown
 * to this Business (ADR-091 proof 4).
 */
async function admitLineUnsend({ account, event, correlationId, db = prisma }) {
  const threadId = event.source?.groupId || event.source?.roomId || event.source?.userId
  const eventId = event.webhookEventId
  const unsentExternalMessageId = event.unsend?.messageId
  if (!threadId || !eventId) return { skipped: true }
  return withAdmittedAccount(db, account, async (tx, current, channelAccountId) => {
    const result = await ingestLineUnsendEvent({
      tenantId: current.tenantId, businessId: current.businessId, channelAccountId,
      threadId, externalEventId: eventId, unsentExternalMessageId, correlationId,
      occurredAt: providerTime(event.timestamp), sessionIdleTimeoutMinutes: current.sessionIdleTimeoutMinutes,
    }, { db: tx })
    return {
      skipped: true, conversationId: result.conversationId ?? null, eventId: result.eventId ?? null,
      tombstonedMessage: result.tombstonedMessage ?? false,
    }
  })
}

async function maintenance(db, now, scope = {}) {
  await db.lineConversationJob.updateMany({ where: { ...scope, status: { in: WAITING }, firstSendAt: null, expiresAt: { lte: now } },
    data: { status: 'FAILED', errorCode: 'EXECUTION_EXPIRED', sealedReplyToken: null, version: { increment: 1 } } })
  await db.lineConversationJob.updateMany({ where: { ...scope, status: 'CLAIMED', leaseExpiresAt: { lte: now }, expiresAt: { gt: now } },
    data: { status: 'QUEUED', claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
  // A reply may already have been accepted. Only Push has an idempotency key.
  await db.lineConversationJob.updateMany({ where: { ...scope, status: 'SENDING', leaseExpiresAt: { lte: now }, sendMethod: 'REPLY' },
    data: { status: 'UNKNOWN', errorCode: 'REPLY_OUTCOME_UNKNOWN', sealedReplyToken: null, version: { increment: 1 } } })
  await db.lineConversationJob.updateMany({ where: { ...scope, status: 'SENDING', leaseExpiresAt: { lte: now }, sendMethod: 'PUSH' },
    data: { status: 'READY', availableAt: now, claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
}

// @req FR-265 — the server is the only claimant (ADR-100 D2), so the device scope
// and the execution-mode selector are gone. The `executionMode: 'SERVER'` filter
// stays in the query: a job admitted before this change may still be QUEUED with
// EDGE, and the server must not pick up work it was never meant to run — that job
// expires through `maintenance` and is visible as a terminal failure, which is a
// truthful outcome, where a silent takeover would not be.
async function claimExecution({ db, claimantId, now }) {
  const rows = await db.lineConversationJob.findMany({ where: { executionMode: 'SERVER', status: 'QUEUED', availableAt: { lte: now }, expiresAt: { gt: now } },
    include: { account: true, inbound: { include: { conversation: true } } }, orderBy: { createdAt: 'asc' }, take: 20 })
  for (const row of rows) {
    if (!activeAccount(row.account, row)) {
      await db.lineConversationJob.updateMany({ where: { id: row.id, version: row.version }, data: { status: 'CANCELLED', sealedReplyToken: null, version: { increment: 1 } } })
      continue
    }
    const leaseExpiresAt = new Date(now.getTime() + LINE_JOB_LEASE_MS)
    const executionId = randomUUID()
    const claimed = await atomic(db, async tx => {
      const result = await tx.lineConversationJob.updateMany({ where: { id: row.id, version: row.version, status: 'QUEUED' },
        data: { status: 'CLAIMED', claimantId, executionId, leaseExpiresAt, version: { increment: 1 } } })
      if (result.count) await traceEvent(tx, { ...row, executionId }, 'EXECUTION_STARTED', `execution:${executionId}`, {
        instanceId: runtimeInstanceId,
        claimantRef: claimantId, executionMode: 'SERVER', claimedAt: now.toISOString(),
        conversationId: row.inbound.conversationId, inboundMessageId: row.inboundMessageId,
        sessionId: null, sessionDisposition: 'NOT_RESOLVED',
      }, now)
      return result
    })
    if (claimed.count) return { ...row, executionId, status: 'CLAIMED', claimantId, leaseExpiresAt, version: row.version + 1 }
  }
  return null
}

// Statuses that mean "this event will fail the same way on every attempt".
const DETERMINISTIC_ADMISSION = [400, 403, 404, 409, 413]
// Retry schedule for admission that happens after LINE has already been answered.
//
// Bounded by the reply token, not by optimism: LINE's token is valid for about a minute, so an
// admission that only succeeds after that can no longer reply — it would have to push, which is a
// different contract and a different quota. Three attempts inside ~20s stay well within the token's
// life; past that, failing loudly is more honest than admitting a job that cannot answer.
const ADMISSION_RETRY_DELAYS_MS = [4_000, 12_000]

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Tell the worker endpoint that something just landed, so the answer does not wait for the next poll.
 *
 * This is an optimisation and nothing more. The ticker's own loop remains the correctness floor: a
 * nudge that never arrives costs latency, never a lost job — which is why every failure here is
 * swallowed and why the caller does not await it.
 *
 * It is the same authenticated, bounded endpoint the ticker calls, on the same bearer, so it adds no
 * execution path and no new authority. `ZURI_LINE_WORKER_URL` is unset on the web container, hence
 * the loopback default; the URL is validated exactly as the ticker validates its own, so a
 * mis-set variable cannot turn admission into a request to somewhere else.
 */
function nudgeWorker(env) {
  const token = env.ZURI_LINE_WORKER_TOKEN
  if (!token || token.length < 32) return
  let url
  try { url = new URL(env.ZURI_LINE_WORKER_URL || `http://127.0.0.1:${env.PORT || 3000}/api/line-oa/worker`) } catch { return }
  if (url.username || url.password || url.pathname !== '/api/line-oa/worker'
    || (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['web', 'localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) return
  fetch(url, { method: 'POST', redirect: 'error', headers: { authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(240_000) })
    .then(response => response.body?.cancel())
    .catch(() => {})
}

async function markRawRecord(db, rawRecordId, processingStatus, processingError = null) {
  if (!rawRecordId) return
  // Never fatal: the evidence row is already durable, and losing its label must not lose the
  // admission that succeeded. The label exists so an operator can find events that never landed.
  try {
    await db.rawExternalRecord.update({
      where: { id: rawRecordId },
      data: { processingStatus, processingError: processingError ? String(processingError).slice(0, 500) : null },
    })
  } catch { /* label only */ }
}

/** Persist the restart-recoverable admission intent before a signed webhook returns 2xx. */
export async function markLineAdmissionIntent({ entries, db = prisma } = {}) {
  for (const { rawRecordId } of entries || []) {
    if (typeof rawRecordId !== 'string' || !rawRecordId.trim()) {
      throw Object.assign(new Error('LINE_ADMISSION_OUTBOX_ID_REQUIRED'), { status: 503 })
    }
    await db.rawExternalRecord.update({
      where: { id: rawRecordId },
      data: { processingStatus: 'ADMITTING', processingError: null },
    })
  }
}

/**
 * Admit events whose durable outbox marker was written before acknowledgement.
 *
 * @req FR-149 — the durable ADMITTING outbox marker is written before 2xx; this bounded continuation
 *   is a wake-up hint and the reconciler recovers it after a process stop.
 * @spec ADR-061 — a device never sends; admission still owns the queue and the CRM write.
 */
export async function admitCapturedLineEvents({
  account, entries, correlationId, ingressReceivedAt, db = prisma,
  admit = admitLineConversation, env = process.env, delays = ADMISSION_RETRY_DELAYS_MS, nudge = nudgeWorker,
} = {}) {
  const outcome = { admitted: 0, skipped: 0, failed: 0 }
  for (const { event, rawRecordId } of entries || []) {
    // Keep the marker here for direct/reconciler callers as well. The webhook has already
    // persisted it before 2xx; this idempotent write also ensures every admission path starts
    // from the same recoverable state.
    await markRawRecord(db, rawRecordId, 'ADMITTING')
    for (let attempt = 0; ; attempt += 1) {
      try {
        const result = await admit({ db, account, event, correlationId, ingressReceivedAt, env })
        const skipped = Boolean(result?.skipped) && !result?.jobId
        outcome[skipped ? 'skipped' : 'admitted'] += 1
        await markRawRecord(db, rawRecordId, skipped ? 'SKIPPED' : 'ADMITTED')
        break
      } catch (error) {
        const deterministic = DETERMINISTIC_ADMISSION.includes(error?.status)
        const last = deterministic || attempt >= delays.length
        // DIAGNOSTIC ONLY: status/code/name/message and a short stack, never event material.
        console.error(JSON.stringify({
          scope: 'line-admission-after-ack', correlationId, attempt: attempt + 1,
          willRetry: !last, status: error?.status ?? null, code: error?.code ?? null,
          name: error?.name ?? null, message: error?.message ?? null,
          stack: (error?.stack ?? '').split('\n').slice(0, 3).join(' | '),
        }))
        if (!last) { await wait(delays[attempt]); continue }
        outcome[deterministic ? 'skipped' : 'failed'] += 1
        await markRawRecord(db, rawRecordId, deterministic ? 'SKIPPED' : 'FAILED', error?.code || error?.message)
        break
      }
    }
  }
  // After the loop, not inside it: a batch of five events should wake the worker once, and by then
  // every job it will find is already queued. Guarded because this is an optimisation sitting at the
  // end of a durable operation — nothing it can do may turn an admitted job into a failed call.
  if (outcome.admitted) { try { nudge(env) } catch { /* the ticker is the floor */ } }
  return outcome
}

// @req FR-265 — the only settler is the server worker (ADR-100 D2). `deviceContext`
// scoping, the `EDGE_REPORTED` context-receipt source and the published-corpus
// re-check a device's claim needed are gone with the claim that produced them.
async function settleExecution(id, { version, text, code, executionId, contextReceipts, traceFailureCode, outcome }, { db, claimantId, now }) {
  const startedAt = performance.now()
  return db.$transaction(async tx => {
    const job = await tx.lineConversationJob.findFirst({ where: { id, executionMode: 'SERVER' }, include: { account: true } })
    if (!job) throw failure(404, 'CONVERSATION_JOB_NOT_FOUND')
    if (!activeAccount(job.account, job) || job.status !== 'CLAIMED' || job.version !== version
      || job.claimantId !== claimantId || !job.leaseExpiresAt || job.leaseExpiresAt <= now || job.expiresAt <= now) throw failure(409, 'CONVERSATION_JOB_LEASE_CONFLICT')
    if (executionId && executionId !== job.executionId) throw failure(409, 'CONVERSATION_JOB_LEASE_CONFLICT')
    const admittedContract = await tx.agentTraceEvent.findFirst({ where: { turnId: job.id, executionId: job.executionId,
      idempotencyKey: `${job.id}:execution:${job.executionId}:contract`, kind: 'CONTEXT_COMMITTED' } })
    const contract = admittedContract ? JSON.parse(admittedContract.payloadJson) : null
    if (contract?.contractVersion === '2' && executionId !== job.executionId) throw failure(409, 'CONVERSATION_JOB_LEASE_CONFLICT')
    if (contextReceipts?.length && !executionId) throw failure(400, 'CONTEXT_RECEIPT_EXECUTION_REQUIRED')
    const deadline = contract?.executionBudget ?? (executionId ? lineExecutionBudget(job, new Date(job.leaseExpiresAt.getTime() - LINE_JOB_LEASE_MS)) : null)
    // Charge authorization/corpus validation time too; an expensive manifest read
    // must not turn an answer that crossed the cutoff into READY.
    const checkedAt = now.getTime() + Math.max(0, performance.now() - startedAt)
    if (job.leaseExpiresAt.getTime() <= checkedAt || job.expiresAt.getTime() <= checkedAt)
      throw failure(409, 'CONVERSATION_JOB_LEASE_CONFLICT')
    if (!code && deadline && checkedAt >= Date.parse(deadline.answerDeadlineAt)) {
      code = 'REPLY_DEADLINE_MISSED'
      text = undefined
    }
    const finalStatus = outcome === 'UNKNOWN' ? 'UNKNOWN' : code ? 'FAILED' : 'READY'
    const update = await tx.lineConversationJob.updateMany({ where: { id, version, status: 'CLAIMED', claimantId },
      data: { status: finalStatus, answerText: finalStatus === 'UNKNOWN' ? null : text ?? null, errorCode: code ?? null,
        ...(code ? { sealedReplyToken: null } : {}),
        ...(!code && deadline?.deliveryMode === 'DELAYED_PUSH' ? { sendMethod: 'PUSH' } : {}),
        availableAt: now, claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
    if (!update.count) throw failure(409, 'CONVERSATION_JOB_LEASE_CONFLICT')
    for (const [index, receipt] of (contextReceipts ?? []).entries()) {
      await traceEvent(tx, job, 'CONTEXT_RECEIPT', `context:${executionId}:${index}`,
        { ...receipt, evidenceSource: 'SERVER' }, now)
    }
    await traceEvent(tx, job, code ? 'EXECUTION_FAILED' : 'ANSWER_READY', `settled:${version}`, {
      ...(code ? { errorCode: code, traceFailureCode: traceFailureCode ?? null,
        ...(outcome === 'UNKNOWN' ? { outcome: 'UNKNOWN' } : {}) }
        : { text, answerReadyAt: now.toISOString() }),
      executionEvidence: 'SERVER',
      ...(deadline ? { executionBudget: deadline, completedAt: now.toISOString() } : {}),
    }, now)
    return { id, status: finalStatus, version: version + 1 }
  })
}

async function reconcileAccepted(db, job) {
  return atomic(db, async tx => {
    const current = await tx.lineConversationJob.findUnique({ where: { id: job.id },
      include: { account: true, inbound: { include: { conversation: true } } } })
    if (!current || current.status !== 'ACCEPTED') return { id: job.id, status: current?.status ?? 'MISSING' }
    // Serialize the payload read with erasure before copying it into CRM. A
    // changed version cannot reuse this pre-lock answer snapshot.
    const fence = await tx.lineConversationJob.updateMany({
      where: { id: current.id, status: 'ACCEPTED', version: current.version,
        OR: [{ errorCode: null }, { errorCode: { not: 'PDPA_ERASURE' } }] },
      data: { id: current.id },
    })
    if (!fence.count) {
      const latest = await tx.lineConversationJob.findUnique({ where: { id: job.id }, select: { status: true } })
      return { id: job.id, status: latest?.status ?? 'MISSING' }
    }
    const outbound = await appendOutbound({ db: tx, tenantId: current.tenantId, businessId: current.businessId,
      channelAccountId: current.channelAccountId, correlationId: current.correlationId,
      acceptedAt: current.acceptedAt.toISOString(), providerRequestId: current.providerRequestId ?? undefined,
      receipt: { inboundMessageId: current.inboundMessageId, text: current.answerText, source: 'STACK',
        ...(current.providerMessageId ? { providerMessageId: current.providerMessageId } : {}) } })
    await traceEvent(tx, current, 'OUTBOUND_RECORDED', 'outbound-recorded', {
      outboundMessageId: outbound.messageId, conversationId: outbound.conversationId,
      deliveryId: current.retryKey, providerAcceptance: 'ACCEPTED_BY_LINE',
      recipientDeliveryStatus: 'UNKNOWN',
    })
    const memory = await prepareMemoryDeliveryPending(tx, {
      job: current,
      outboundMessageId: outbound.messageId,
      conversation: current.inbound?.conversation,
      acceptedAt: current.acceptedAt ?? new Date(),
    })
    await tx.lineConversationJob.updateMany({ where: { id: current.id, status: 'ACCEPTED' },
      data: { status: 'RECORDED', sealedReplyToken: null,
        ...(memory ? { memoryDeliveryState: memory.memoryDeliveryState,
          memoryDeliveryNextAttemptAt: memory.memoryDeliveryNextAttemptAt,
          memoryDeliveryLeaseUntil: memory.memoryDeliveryLeaseUntil } : {}),
        version: { increment: 1 } } })
    return { id: current.id, status: 'RECORDED' }
  })
}

// How many SERVER answers one tick may have in flight at once.
//
// It was one until 2026-09-10, and one job per tick is what made a quiet queue feel slow: the model
// call happens inside the tick, so two customers who wrote at the same moment were answered strictly
// one after the other — the second waiting for the first's entire answer, up to the ticker's 240 s
// request timeout. The queue was never the constraint. ADR-061 D6 has required compare-and-set
// versions and bounded leases from the day it was written, precisely so more than one claimant is
// safe, and `claimExecution` already reads 20 candidate rows and claims atomically. Only the shape
// of this loop held the concurrency at one.
//
// Four, not twenty: every answer is a metered model call, so a tick that suddenly finds a backlog
// should cost a bounded amount rather than whatever the backlog happens to be.
const EXECUTION_CONCURRENCY = 4
// How many READY jobs one tick may send. Sends stay strictly sequential: each is a single HTTPS call
// that returns in well under a second, and LINE rate-limits per account — parallelism here would buy
// latency nobody is waiting on and earn 429s we would then have to retry.
const SEND_BATCH = 5

/** Deployment overrides are operator input: accept a sane integer, ignore anything else. */
const boundedCount = (value, fallback) => {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 50 ? parsed : fallback
}

/**
 * Answer one claimed job and settle it.
 *
 * Returns a result only when the job ended FAILED; `null` means it settled READY and the send phase
 * of this same tick will pick it up. Errors from `settleExecution` itself still propagate, exactly
 * as they did when this was inline: a job that cannot be settled is not a job that quietly failed.
 */
async function executeClaimed({ db, answer, execution, claimantId, now }) {
  try {
    if (isLineProjectWorkCommand(execution.inbound?.body) && lineExecutionBudget(execution, now()).remainingBudgetMs <= 0)
      throw Object.assign(new Error('REPLY_DEADLINE_MISSED'), { code: 'REPLY_DEADLINE_MISSED' })
    const response = await handleLineProjectWorkCommand(execution, { db, now })
      ?? await answer(execution, {
      trace: createLineExecutionTrace({ db, job: execution }),
      ...(execution.memorySyncOptIn ? { memoryStateReader: id => db.lineConversationJob.findUnique({
        where: { id },
        select: { memorySyncOptIn: true, status: true, version: true, errorCode: true, transportEpoch: true,
          account: { select: { serverEnabled: true, transportMode: true, status: true, transportEpoch: true } } },
      }) } : {}),
    })
    const text = zCompletion.shape.text.parse(response?.text ?? response)
    await settleExecution(execution.id, { version: execution.version, text }, { db, claimantId, now: now() })
    return null
  } catch (error) {
    if (error.status === 409) return { id: execution.id, status: 'CONTENDED' }
    try {
      const settled = await settleExecution(execution.id, {
        version: execution.version,
        code: ['MSP_INJECTION_RECEIPT_UNKNOWN', 'REPLY_DEADLINE_MISSED'].includes(error.code) ? error.code : 'EXECUTION_FAILED',
        outcome: error.code === 'MSP_INJECTION_RECEIPT_UNKNOWN' ? 'UNKNOWN' : undefined,
        traceFailureCode: ['EXECUTION_TRACE_PAYLOAD_TOO_LARGE', 'EXECUTION_TRACE_SECRET_FIELD', 'EXECUTION_TRACE_UNAVAILABLE', 'MSP_INJECTION_RECEIPT_UNKNOWN'].includes(error.code) ? error.code : null },
      { db, claimantId, now: now() })
      return { id: execution.id, status: settled.status }
    } catch (settleError) {
      if (settleError.status === 409) return { id: execution.id, status: 'CONTENDED' }
      throw settleError
    }
  }
}

/**
 * One bounded tick: reconcile an accepted send, answer up to `executionConcurrency` jobs in
 * parallel, then send up to `sendBatch` ready answers in order.
 *
 * Returns the last unit's result — unchanged in shape from when a tick did exactly one thing — with
 * `executed`/`sent` counts added. A tick that found nothing still returns exactly `{ status: 'IDLE' }`,
 * because that is the signal the ticker backs off on.
 */
export async function runLineConversationWorker({ db = prisma, answer, resolveAccount, replyTransport, pushTransport,
  env = process.env, now = () => new Date(), workerId = `server:${randomUUID()}`,
  threadMemory = null,
  memoryDeliveryBatch,
  memoryDeliveryLeaseMs,
  executionConcurrency = boundedCount(env.ZURI_LINE_WORKER_EXECUTION_CONCURRENCY, EXECUTION_CONCURRENCY),
  sendBatch = boundedCount(env.ZURI_LINE_WORKER_SEND_BATCH, SEND_BATCH) }) {
  await maintenance(db, now())
  const scanMemory = () => threadMemory?.recordDelivery
    ? reconcileLineMemoryDeliveries({ db, threadMemory, now, workerId: `${workerId}:memory`,
      batchSize: memoryDeliveryBatch, leaseMs: memoryDeliveryLeaseMs })
    : null
  await scanMemory()
  const accepted = await db.lineConversationJob.findFirst({ where: { status: 'ACCEPTED' }, orderBy: { createdAt: 'asc' } })
  if (accepted) {
    const result = await reconcileAccepted(db, accepted)
    await scanMemory()
    return result
  }
  // Claiming is sequential and cheap; answering is what takes seconds, so only that runs in parallel.
  const claims = []
  for (let index = 0; index < executionConcurrency; index += 1) {
    // The first claimant keeps the plain worker id, so a tick that finds one job behaves — and
    // records — exactly as it did before this became a batch.
    const claimantId = index === 0 ? workerId : `${workerId}#${index}`
    const claimed = await claimExecution({ db, claimantId, now: now() })
    if (!claimed) break
    claims.push({ execution: claimed, claimantId })
  }
  let last = null
  if (claims.length) {
    // allSettled, not all: one job whose settle write fails must not abandon its siblings midway.
    // The rejection is still raised after they finish, so a broken settle path stays loud.
    const settled = await Promise.allSettled(claims.map(claim => executeClaimed({ db, answer, now, ...claim })))
    const rejected = settled.find(outcome => outcome.status === 'rejected')
    if (rejected) throw rejected.reason
    last = settled.map(outcome => outcome.value).filter(Boolean).pop() ?? null
  }
  const ready = await db.lineConversationJob.findMany({ where: { status: 'READY', availableAt: { lte: now() } },
    include: { account: true }, orderBy: { createdAt: 'asc' }, take: sendBatch })
  if (!ready.length) {
    await scanMemory()
    return last ? { ...last, executed: claims.length, sent: 0 } : { status: 'IDLE' }
  }
  let sent = 0
  for (const job of ready) {
    last = await sendReadyJob({ db, job, resolveAccount, replyTransport, pushTransport, env, workerId, now })
    sent += 1
  }
  await scanMemory()
  return { ...last, executed: claims.length, sent }
}

/** Send one READY job and record the outcome. Split out of the tick when it became a batch. */
async function sendReadyJob({ db, job, resolveAccount, replyTransport, pushTransport, env, workerId, now }) {
  if (!activeAccount(job.account, job)) {
    await db.lineConversationJob.updateMany({ where: { id: job.id, version: job.version }, data: { status: 'CANCELLED', sealedReplyToken: null, version: { increment: 1 } } })
    return { id: job.id, status: 'CANCELLED' }
  }
  let at = now()
  let method = job.sendMethod
  if (!method) method = job.sealedReplyToken && job.replyExpiresAt > at ? 'REPLY' : job.allowDelayedPush ? 'PUSH' : null
  if (!method || (job.firstSendAt && at.getTime() - job.firstSendAt.getTime() >= RETRY_WINDOW_MS)) {
    await db.lineConversationJob.updateMany({ where: { id: job.id, version: job.version },
      data: { status: job.firstSendAt ? 'UNKNOWN' : 'FAILED', errorCode: job.firstSendAt ? 'PUSH_RETRY_WINDOW_EXPIRED' : 'REPLY_EXPIRED_PUSH_DISABLED', sealedReplyToken: null, version: { increment: 1 } } })
    return { id: job.id, status: 'STOPPED' }
  }
  // Resolve/decrypt before claiming send: config failures cannot turn into an ambiguous external attempt.
  let account
  try { account = await resolveAccount(job.accountId) } catch {
    // One revoked/misconfigured OA cannot starve the shared worker queue.
    await db.lineConversationJob.updateMany({ where: { id: job.id, version: job.version, status: 'READY' },
      data: { status: job.firstSendAt ? 'UNKNOWN' : 'FAILED', errorCode: 'LINE_ACCOUNT_UNAVAILABLE', sealedReplyToken: null, version: { increment: 1 } } })
    return { id: job.id, status: job.firstSendAt ? 'UNKNOWN' : 'FAILED' }
  }
  if (account.transportEpoch !== job.transportEpoch) return { id: job.id, status: 'FENCED' }
  at = now()
  if (method === 'REPLY' && job.replyExpiresAt <= at) {
    if (job.allowDelayedPush) method = 'PUSH'
    else {
      await db.lineConversationJob.updateMany({ where: { id: job.id, version: job.version, status: 'READY' },
        data: { status: 'FAILED', errorCode: 'REPLY_DEADLINE_MISSED', sealedReplyToken: null, version: { increment: 1 } } })
      return { id: job.id, status: 'FAILED' }
    }
  }
  // Decrypt before claiming the external send. A missing/invalid token is a
  // local failure; letting it escape here used to leave the READY row untouched
  // forever, starving every account behind it.
  let replyToken = null
  try {
    if (method === 'REPLY') replyToken = unsealLineReplyToken(job.sealedReplyToken, job.accountId, env)
  } catch {
    const status = job.firstSendAt ? 'UNKNOWN' : 'FAILED'
    const errorCode = job.firstSendAt ? 'REPLY_OUTCOME_UNKNOWN' : 'LINE_REPLY_TOKEN_UNAVAILABLE'
    await db.lineConversationJob.updateMany({ where: { id: job.id, version: job.version, status: 'READY' },
      data: { status, errorCode, sealedReplyToken: null, version: { increment: 1 } } })
    return { id: job.id, status }
  }
  const sendAttemptId = randomUUID()
  const claimed = await atomic(db, async tx => {
    // Serialize with account actions before either side checks active sends.
    const fence = await tx.lineOaAccount.updateMany({ where: { id: job.accountId,
      version: account.version, serverEnabled: true, transportMode: 'CLOUD', status: 'CONNECTED', transportEpoch: job.transportEpoch },
      data: { version: { increment: 1 } } })
    if (!fence.count) return { count: 0 }
    const result = await tx.lineConversationJob.updateMany({ where: { id: job.id, version: job.version, status: 'READY' },
      data: { status: 'SENDING', sendMethod: method, firstSendAt: job.firstSendAt ?? at,
        attempts: { increment: 1 }, claimantId: workerId, leaseExpiresAt: new Date(at.getTime() + 30_000), version: { increment: 1 } } })
    if (result.count) await traceEvent(tx, job, 'SEND_STARTED', `send:${sendAttemptId}`, {
      deliveryId: job.retryKey, sendAttemptId, method, attemptNumber: job.attempts + 1,
      sendStartedAt: at.toISOString(), recipientDeliveryStatus: 'UNKNOWN',
    }, at)
    return result
  })
  if (!claimed.count) return { status: 'CONTENDED' }
  let result
  let receivedProviderResponse = true
  try {
    const messages = [{ type: 'text', text: job.answerText }]
    if (method === 'REPLY' && job.replyExpiresAt <= now()) {
      // No provider request has started; a delayed vault/transaction cannot spend
      // a token whose deadline passed while the job was being fenced.
      throw Object.assign(failure(400, 'REPLY_DEADLINE_MISSED'), { code: 'REPLY_DEADLINE_MISSED' })
    }
    result = method === 'REPLY'
      ? await replyTransport.send({ account, replyToken, messages })
      : await pushTransport.send({ account, to: job.recipientId, messages, retryKey: job.retryKey })
  } catch (error) {
    receivedProviderResponse = false
    result = error?.status === 400
      ? { status: 'PERMANENT_FAILURE', code: error.code ?? 'LINE_SEND_INPUT_INVALID' }
      : { status: method === 'REPLY' ? 'UNKNOWN' : 'RETRYABLE_FAILURE', code: 'LINE_REQUEST_UNCONFIRMED' }
  }
  // A Reply's dead token is the one PERMANENT_FAILURE worth switching method over: LINE_HTTP_400
  // means the token itself is confirmed dead, not "some 4xx happened" — 401/403/404/429 are
  // credential/config errors that would just fail again as Push under a different name. ADR-061
  // Decision 6 forbids switching method after an ambiguous (UNKNOWN/RETRYABLE_FAILURE-on-Reply)
  // outcome, since that can double-send; this gate never fires on those.
  const methodFallbackTo = method === 'REPLY' && result.status === 'PERMANENT_FAILURE'
    && result.code === 'LINE_HTTP_400' && job.allowDelayedPush === true ? 'PUSH' : null
  const status = result.status === 'ACCEPTED_BY_LINE' ? 'ACCEPTED'
    : result.status === 'UNKNOWN' ? 'UNKNOWN'
      : methodFallbackTo || (result.status === 'RETRYABLE_FAILURE' && method === 'PUSH') ? 'READY' : 'FAILED'
  const responseObservedAt = now()
  const changed = await atomic(db, async tx => {
    const updated = await tx.lineConversationJob.updateMany({ where: { id: job.id, status: 'SENDING', claimantId: workerId, version: job.version + 1 },
    data: { status, acceptedAt: status === 'ACCEPTED' ? now() : null,
      providerRequestId: result.requestId ?? null, providerMessageId: result.messageId ?? null,
      errorCode: result.code ?? null, sealedReplyToken: null, claimantId: null, leaseExpiresAt: null,
      ...(methodFallbackTo ? { sendMethod: methodFallbackTo } : {}),
      availableAt: new Date(now().getTime() + Math.min(60_000, 1000 * 2 ** Math.min(job.attempts, 6))), version: { increment: 1 } } })
    await traceEvent(tx, job, 'SEND_RESULT', `send:${sendAttemptId}:result`, {
      deliveryId: job.retryKey, sendAttemptId, method, providerOutcome: result.status,
      providerRequestId: result.requestId ?? null, providerMessageId: result.messageId ?? null,
      errorCode: result.code ?? null, methodFallbackTo,
      providerResponseReceivedAt: receivedProviderResponse && result.requestId ? responseObservedAt.toISOString() : null,
      outcomeObservedAt: responseObservedAt.toISOString(),
      stateApplied: updated.count > 0, recipientDeliveredAt: null, recipientReadAt: null,
      recipientDeliveryStatus: 'UNKNOWN', receiptCapability: 'NOT_SUPPORTED',
    }, responseObservedAt)
    return updated
  })
  if (changed.count && status === 'ACCEPTED') {
    const reconciled = await reconcileAccepted(db, { id: job.id })
    return { ...reconciled, acceptance: 'ACCEPTED_BY_LINE' }
  }
  return { id: job.id, status: changed.count ? status : 'FENCED' }
}

/** `S-YYYYMMDD-XXXXXX`, the ConversationSession human code (FR-243). */
export const SESSION_CODE_PATTERN = /^S-\d{8}-[0-9A-Z]{6}$/

/**
 * Bounded operational DTO; never exposes LINE ids, tokens or question/answer text.
 *
 * @req FR-243 — `sessionCode` narrows the list to one conversation session of this
 *   account's Tenant and account (ADR-094 D4). A code that names no session of this
 *   account answers an empty list, never another account's jobs; a malformed code
 *   is refused before any read.
 */
export async function listLineConversationJobs(accountId, { viewer, sessionCode, db = prisma } = {}) {
  const account = await db.lineOaAccount.findUnique({ where: { id: accountId } })
  if (!account) throw notFound()
  assertMayView(viewer, account.businessId)
  let session = null
  const where = { accountId }
  if (sessionCode !== undefined && sessionCode !== null && sessionCode !== '') {
    const code = String(sessionCode).trim().toUpperCase()
    if (!SESSION_CODE_PATTERN.test(code)) throw failure(400, 'SESSION_CODE_INVALID')
    session = await db.conversationSession.findFirst({
      where: { tenantId: account.tenantId, code, channelAccountId: account.bindingCode || account.id },
      select: { id: true, code: true, openedAt: true, lastMessageAt: true, closedAt: true, inboundCount: true, outboundCount: true },
    })
    if (!session) return { accountId, session: null, jobs: [] }
    where.sessionId = session.id
  }
  const rows = await db.lineConversationJob.findMany({ where, orderBy: { createdAt: 'desc' }, take: 100,
    select: { id: true, status: true, executionMode: true, modelAccess: true, sendMethod: true,
      attempts: true, errorCode: true, acceptedAt: true, createdAt: true, updatedAt: true, version: true,
      sessionId: true, session: { select: { code: true } } } })
  const jobs = rows.map(({ session: jobSession, ...job }) => ({ ...job, sessionCode: jobSession?.code ?? null }))
  return { accountId, session, jobs }
}

/**
 * Bounded health read for the owning Business. The health overlay must not
 * enumerate accounts first: this port reads the job table once and returns
 * only the operational fields FR-215 needs.
 */
export async function listLineConversationJobsForBusiness(businessId, { viewer, limit = 100, db = prisma } = {}) {
  const id = typeof businessId === 'string' ? businessId.trim() : ''
  if (!id) throw notFound()
  assertMayView(viewer, id)
  const take = Math.min(Math.max(Number(limit) || 100, 1), 100)
  return db.lineConversationJob.findMany({
    where: { businessId: id },
    orderBy: { updatedAt: 'desc' },
    take,
    select: { status: true, updatedAt: true },
  })
}

/** Payload inspection needs Business ownership in addition to Studio visibility. */
export async function readLineConversationTrace(id, { viewer, db = prisma } = {}) {
  const job = await db.lineConversationJob.findUnique({ where: { id } })
  if (!job) throw notFound()
  assertMayView(viewer, job.businessId)
  if (!ownsBusiness(viewer, job.businessId)) throw notFound()
  const events = await readExecutionTrace(db, { scope: { tenantId: job.tenantId, businessId: job.businessId }, turnId: id })
  return { turnId: id, events, playback: playbackTrace(events) }
}

/** Operator acknowledges uncertainty without claiming delivery or resending. */
export async function acknowledgeUnknownLineJob(id, input, { viewer, db = prisma } = {}) {
  const data = z.object({ version: z.number().int().positive(), acknowledgePossibleDelivery: z.literal(true) }).strict().parse(input)
  return atomic(db, async tx => {
    const job = await tx.lineConversationJob.findUnique({ where: { id } })
    if (!job) throw notFound()
    assertMayPublish(viewer, job.businessId)
    const result = await tx.lineConversationJob.updateMany({ where: { id, status: 'UNKNOWN', version: data.version },
      data: { status: 'CANCELLED', errorCode: 'OPERATOR_ACKNOWLEDGED_UNKNOWN', version: { increment: 1 } } })
    if (!result.count) throw failure(409, 'CONVERSATION_JOB_VERSION_CONFLICT')
    await recordAudit(tx, { entityType: 'LINE_CONVERSATION_JOB', entityId: id, action: 'UNKNOWN_ACKNOWLEDGED',
      actorId: viewer?.principal?.id ?? null, payload: { accountId: job.accountId, businessId: job.businessId, possibleDelivery: true } })
    return { id, status: 'CANCELLED', delivery: 'UNKNOWN' }
  })
}
