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
const sourceTime = timestamp => Number.isFinite(timestamp) && Number.isFinite(new Date(timestamp).getTime())
  ? new Date(timestamp).toISOString() : null

function traceEvent(db, job, kind, key, payload, occurredAt = new Date()) {
  return appendTraceEvent(db, { scope: { tenantId: job.tenantId, businessId: job.businessId },
    turnId: job.id, executionId: job.executionId ?? null, kind,
    idempotencyKey: `${job.id}:${key}`, payload, occurredAt })
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
  const eventId = event.webhookEventId || event.message?.id
  const text = event.message?.text
  if (!userId || !threadId || !eventId || !event.message?.id || typeof text !== 'string' || !text.trim()) return { skipped: true }
  if (text.length > 10000) throw failure(400, 'LINE_TEXT_TOO_LONG')
  const shouldReply = event.source?.type === 'user' || /ซูริ|zuri/i.test(text)
  const sealed = shouldReply ? sealLineReplyToken(event.replyToken, account.id, env) : null
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
      recipientId: threadId, sourceUserId: userId, sealedReplyToken: sealed,
      replyExpiresAt: sealed ? new Date(now.getTime() + 45_000) : null,
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
    }, now)
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

async function settleExecution(id, { version, text, code, traceFailureCode }, { db, claimantId, deviceContext, now }) {
  return db.$transaction(async tx => {
    const scope = deviceContext ? { tenantId: deviceContext.tenantId, businessId: deviceContext.businessId, executionMode: 'EDGE' } : { executionMode: 'SERVER' }
    const job = await tx.lineConversationJob.findFirst({ where: { id, ...scope }, include: { account: true } })
    if (!job) throw failure(404, 'CONVERSATION_JOB_NOT_FOUND')
    if (!activeAccount(job.account, job) || job.status !== 'CLAIMED' || job.version !== version
      || job.claimantId !== claimantId || !job.leaseExpiresAt || job.leaseExpiresAt <= now || job.expiresAt <= now) throw failure(409, 'CONVERSATION_JOB_LEASE_CONFLICT')
    const update = await tx.lineConversationJob.updateMany({ where: { id, version, status: 'CLAIMED', claimantId },
      data: { status: code ? 'FAILED' : 'READY', answerText: text ?? null, errorCode: code ?? null,
        ...(code ? { sealedReplyToken: null } : {}), availableAt: now, claimantId: null, leaseExpiresAt: null, version: { increment: 1 } } })
    if (!update.count) throw failure(409, 'CONVERSATION_JOB_LEASE_CONFLICT')
    await traceEvent(tx, job, code ? 'EXECUTION_FAILED' : 'ANSWER_READY', `settled:${version}`, {
      ...(code ? { errorCode: code, traceFailureCode: traceFailureCode ?? null } : { text, answerReadyAt: now.toISOString() }),
      executionEvidence: job.executionMode === 'EDGE' ? 'EXTERNAL_CONTEXT_NOT_REPORTED' : 'SERVER',
    }, now)
    return { id, status: code ? 'FAILED' : 'READY', version: version + 1 }
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
    const current = await tx.lineConversationJob.findUnique({ where: { id: job.id } })
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
    await tx.lineConversationJob.updateMany({ where: { id: current.id, status: 'ACCEPTED' },
      data: { status: 'RECORDED', sealedReplyToken: null, version: { increment: 1 } } })
    return { id: current.id, status: 'RECORDED' }
  })
}

/** One bounded tick. No fire-and-forget task lives inside the webhook process. */
export async function runLineConversationWorker({ db = prisma, answer, resolveAccount, replyTransport, pushTransport,
  env = process.env, now = () => new Date(), workerId = `server:${randomUUID()}` }) {
  await maintenance(db, now())
  const accepted = await db.lineConversationJob.findFirst({ where: { status: 'ACCEPTED' }, orderBy: { createdAt: 'asc' } })
  if (accepted) return reconcileAccepted(db, accepted)
  const execution = await claimExecution({ db, executionMode: 'SERVER', claimantId: workerId, now: now() })
  if (execution) {
    try {
      const response = await answer(execution, { trace: createLineExecutionTrace({ db, job: execution }) })
      const text = zCompletion.shape.text.parse(response?.text ?? response)
      await settleExecution(execution.id, { version: execution.version, text }, { db, claimantId: workerId, now: now() })
    } catch (error) {
      if (error.status !== 409) await settleExecution(execution.id, { version: execution.version, code: 'EXECUTION_FAILED',
        traceFailureCode: ['EXECUTION_TRACE_PAYLOAD_TOO_LARGE', 'EXECUTION_TRACE_SECRET_FIELD', 'EXECUTION_TRACE_UNAVAILABLE'].includes(error.code) ? error.code : null },
      { db, claimantId: workerId, now: now() })
      return { id: execution.id, status: 'FAILED' }
    }
  }
  const job = await db.lineConversationJob.findFirst({ where: { status: 'READY', availableAt: { lte: now() } },
    include: { account: true }, orderBy: { createdAt: 'asc' } })
  if (!job) return { status: 'IDLE' }
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
  const replyToken = method === 'REPLY' ? unsealLineReplyToken(job.sealedReplyToken, job.accountId, env) : null
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
  } catch {
    receivedProviderResponse = false
    result = { status: method === 'REPLY' ? 'UNKNOWN' : 'RETRYABLE_FAILURE', code: 'LINE_REQUEST_UNCONFIRMED' }
  }
  const status = result.status === 'ACCEPTED_BY_LINE' ? 'ACCEPTED'
    : result.status === 'UNKNOWN' ? 'UNKNOWN'
      : result.status === 'RETRYABLE_FAILURE' && method === 'PUSH' ? 'READY' : 'FAILED'
  const responseObservedAt = now()
  const changed = await atomic(db, async tx => {
    const updated = await tx.lineConversationJob.updateMany({ where: { id: job.id, status: 'SENDING', claimantId: workerId, version: job.version + 1 },
    data: { status, acceptedAt: status === 'ACCEPTED' ? now() : null,
      providerRequestId: result.requestId ?? null, providerMessageId: result.messageId ?? null,
      errorCode: result.code ?? null, sealedReplyToken: null, claimantId: null, leaseExpiresAt: null,
      availableAt: new Date(now().getTime() + Math.min(60_000, 1000 * 2 ** Math.min(job.attempts, 6))), version: { increment: 1 } } })
    await traceEvent(tx, job, 'SEND_RESULT', `send:${sendAttemptId}:result`, {
      deliveryId: job.retryKey, sendAttemptId, method, providerOutcome: result.status,
      providerRequestId: result.requestId ?? null, providerMessageId: result.messageId ?? null,
      errorCode: result.code ?? null,
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
