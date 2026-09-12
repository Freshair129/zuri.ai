import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import prisma from '@/lib/db'
import { ingestLineMessage } from '@/modules/crm/line-ingest-service'
import { appendOutbound } from '@/modules/crm/reply-record-service'
import { assertMayView, assertMayPublish, notFound } from './line-oa-account-authority'
import { recordAudit } from '@/modules/project-manager/application/audit'
import { appendTraceEvent, readExecutionTrace, playbackTrace, sha256 } from '@/modules/agent/execution-trace'
import { createLineExecutionTrace } from '@/modules/agent/line-execution-trace'
import { ownsBusiness } from '@/modules/identity/viewer-authority'
import { prepareMemoryDeliveryPending, reconcileLineMemoryDeliveries } from './line-memory-delivery'

// @req FR-149, FR-150 — durable admission, optional compute, fenced send and receipt recovery.
// @req FR-171 — context and execution journal, attempt identity and truthful send observations.
// @spec ADR-061, SEC-001, FR-148 — queue and CRM share a transaction; devices cannot send.
// @tested tests/integration/server-line-jobs.test.js

export const LINE_JOB_LEASE_MS = 300_000
const JOB_TTL_MS = 30 * 60_000
const RETRY_WINDOW_MS = 23 * 60 * 60_000
const WAITING = ['QUEUED', 'CLAIMED', 'READY']
const runtimeInstanceId = randomUUID()
const zCompletion = z.object({ version: z.number().int().positive(), text: z.string().trim().min(1).max(5000) }).strict()
const zFailure = z.object({ version: z.number().int().positive(), code: z.enum(['EXECUTION_FAILED', 'LOCAL_POLICY_UNAVAILABLE']) }).strict()
const failure = (status, message) => Object.assign(new Error(message), { status })
const sourceTimeMs = timestamp => Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime())
  ? new Date(timestamp).getTime() : null
const sourceTime = timestamp => { const ms = sourceTimeMs(timestamp); return ms === null ? null : new Date(ms).toISOString() }

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

/** Called only after signature and destination validation. No authority from event text. */
export async function admitLineConversation({ account, event, correlationId, now = new Date(), ingressReceivedAt = now, env = process.env, db = prisma }) {
  if (event.type !== 'message' || event.message?.type !== 'text') return { skipped: true }
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
      channelAccountId, lineUserId: userId, threadId, text, externalMessageId: event.message.id, correlationId }, { db: tx })
    if (!shouldReply) return { skipped: true, inboundMessageId: inbound.messageId }
    const prior = await tx.lineConversationJob.findUnique({ where: { inboundMessageId: inbound.messageId } })
    if (prior) return { jobId: prior.id, created: false, inboundMessageId: inbound.messageId }
    const job = await tx.lineConversationJob.create({ data: {
      accountId: current.id, inboundMessageId: inbound.messageId, eventId,
      tenantId: current.tenantId, businessId: current.businessId, channelAccountId,
      transportEpoch: current.transportEpoch, executionMode: current.executionMode,
      modelAccess: current.modelAccess, allowDelayedPush: current.allowDelayedPush,
      // This is immutable trusted LINE admission provenance. The opt-in flag is
      // a per-job decision captured at the same boundary; later env changes do
      // not enroll or silently drop an already admitted job.
      audienceKind, memorySyncOptIn: env.ZURI_MSP_THREAD_MEMORY_ENABLED === 'true',
      recipientId: threadId, sourceUserId: userId, sealedReplyToken: sealed,
      replyExpiresAt: sealed ? new Date(replyDeadlineAnchorMs + 45_000) : null,
      availableAt: now, expiresAt: new Date(now.getTime() + JOB_TTL_MS), correlationId,
    } })
    await recordAudit(tx, { entityType: 'LINE_CONVERSATION_JOB', entityId: job.id, action: 'QUEUED',
      payload: { tenantId: job.tenantId, businessId: job.businessId, accountId: job.accountId, correlationId } })
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
    return { jobId: job.id, created: true, inboundMessageId: inbound.messageId }
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

async function claimExecution({ db, executionMode, claimantId, deviceContext, now }) {
  const scope = deviceContext ? { tenantId: deviceContext.tenantId, businessId: deviceContext.businessId } : {}
  const rows = await db.lineConversationJob.findMany({ where: { ...scope, executionMode, status: 'QUEUED', availableAt: { lte: now }, expiresAt: { gt: now } },
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
        instanceId: executionMode === 'SERVER' ? runtimeInstanceId : null,
        claimantRef: claimantId, executionMode, claimedAt: now.toISOString(),
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

/**
 * Admit events that have already been captured as evidence and acknowledged to LINE.
 *
 * @req FR-149 — admission is durable, but it is no longer what LINE waits for. The webhook answers
 *   once the event is recorded; this runs afterwards in the same process.
 * @spec ADR-061 — a device never sends; admission still owns the queue and the CRM write.
 */
export async function admitCapturedLineEvents({
  account, entries, correlationId, ingressReceivedAt, db = prisma,
  admit = admitLineConversation, env = process.env, delays = ADMISSION_RETRY_DELAYS_MS, nudge = nudgeWorker,
} = {}) {
  const outcome = { admitted: 0, skipped: 0, failed: 0 }
  for (const { event, rawRecordId } of entries || []) {
    // Once per entry, before the first attempt (not before each retry): if the process dies
    // partway through admission, this is what leaves exactly the stranded rows at ADMITTING —
    // never-attempted rows stay RECEIVED, so the 34 legacy RECEIVED rows from before this change
    // are not swept up as false positives.
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

export async function claimEdgeConversation({ deviceContext, db = prisma, now = new Date() }) {
  if (!deviceContext?.isEdgeDevice) throw failure(401, 'EDGE_CREDENTIAL_REQUIRED')
  // The route re-resolves the active credential on every call; maintenance has no payload output.
  await maintenance(db, now, { tenantId: deviceContext.tenantId, businessId: deviceContext.businessId })
  const job = await claimExecution({ db, executionMode: 'EDGE', claimantId: deviceContext.credentialId, deviceContext, now })
  if (!job) return null
  return { contractVersion: '1', job: { id: job.id, version: job.version, question: job.inbound.body,
    conversationKey: `line:${job.accountId}:${job.inbound.conversationId}`, leaseExpiresAt: job.leaseExpiresAt.toISOString(),
    policy: { modelAccess: job.modelAccess, role: 'sales', retainHistory: false } } }
}

async function settleExecution(id, { version, text, code, traceFailureCode, outcome }, { db, claimantId, deviceContext, now }) {
  return db.$transaction(async tx => {
    const scope = deviceContext ? { tenantId: deviceContext.tenantId, businessId: deviceContext.businessId, executionMode: 'EDGE' } : { executionMode: 'SERVER' }
    const job = await tx.lineConversationJob.findFirst({ where: { id, ...scope }, include: { account: true } })
    if (!job) throw failure(404, 'CONVERSATION_JOB_NOT_FOUND')
    if (!activeAccount(job.account, job) || job.status !== 'CLAIMED' || job.version !== version
      || job.claimantId !== claimantId || !job.leaseExpiresAt || job.leaseExpiresAt <= now || job.expiresAt <= now) throw failure(409, 'CONVERSATION_JOB_LEASE_CONFLICT')
    const finalStatus = outcome === 'UNKNOWN' ? 'UNKNOWN' : code ? 'FAILED' : 'READY'
    const update = await tx.lineConversationJob.updateMany({ where: { id, version, status: 'CLAIMED', claimantId },
      data: { status: finalStatus, answerText: finalStatus === 'UNKNOWN' ? null : text ?? null, errorCode: code ?? null,
        ...(code ? { sealedReplyToken: null } : {}), availableAt: now, claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
    if (!update.count) throw failure(409, 'CONVERSATION_JOB_LEASE_CONFLICT')
    await traceEvent(tx, job, code ? 'EXECUTION_FAILED' : 'ANSWER_READY', `settled:${version}`, {
      ...(code ? { errorCode: code, traceFailureCode: traceFailureCode ?? null,
        ...(outcome === 'UNKNOWN' ? { outcome: 'UNKNOWN' } : {}) }
        : { text, answerReadyAt: now.toISOString() }),
      executionEvidence: job.executionMode === 'EDGE' ? 'EXTERNAL_CONTEXT_NOT_REPORTED' : 'SERVER',
    }, now)
    return { id, status: finalStatus, version: version + 1 }
  })
}

export async function completeEdgeConversation(id, input, { deviceContext, db = prisma, now = new Date() }) {
  if (!deviceContext?.isEdgeDevice) throw failure(401, 'EDGE_CREDENTIAL_REQUIRED')
  return settleExecution(id, zCompletion.parse(input), { db, claimantId: deviceContext.credentialId, deviceContext, now })
}

export async function failEdgeConversation(id, input, { deviceContext, db = prisma, now = new Date() }) {
  if (!deviceContext?.isEdgeDevice) throw failure(401, 'EDGE_CREDENTIAL_REQUIRED')
  return settleExecution(id, zFailure.parse(input), { db, claimantId: deviceContext.credentialId, deviceContext, now })
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
    const response = await answer(execution, {
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
        code: error.code === 'MSP_INJECTION_RECEIPT_UNKNOWN' ? error.code : 'EXECUTION_FAILED',
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
    const claimed = await claimExecution({ db, executionMode: 'SERVER', claimantId, now: now() })
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
  const at = now()
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

/** Bounded operational DTO; never exposes LINE ids, tokens or question/answer text. */
export async function listLineConversationJobs(accountId, { viewer, db = prisma } = {}) {
  const account = await db.lineOaAccount.findUnique({ where: { id: accountId } })
  if (!account) throw notFound()
  assertMayView(viewer, account.businessId)
  const jobs = await db.lineConversationJob.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 100,
    select: { id: true, status: true, executionMode: true, modelAccess: true, sendMethod: true,
      attempts: true, errorCode: true, acceptedAt: true, createdAt: true, updatedAt: true, version: true } })
  return { accountId, jobs }
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
