import prisma from '@/lib/db'
import { appendTraceEvent } from '@/modules/agent/execution-trace'
import { resolveAgentAuthorization } from '@/modules/agent/auth-context'
import { CUSTOMER_ERASURE_TOMBSTONE } from '@/modules/crm/conversation-redaction-service'

// @req FR-149, FR-171 — reconcile one provider-accepted server reply into the
// opt-in MSP thread without another LINE send or CRM message.
// @spec ADR-061, ADR-070, SEC-001 — the local job/CRM rows remain authoritative;
// MSP receives only a scoped, persisted receipt through its adapter.
// @tested tests/integration/line-worker-memory.test.js

export const MEMORY_DELIVERY_STATES = Object.freeze(['NONE', 'PENDING', 'ACKNOWLEDGED', 'CLOSED'])
export const MEMORY_DELIVERY_LEASE_MS = 30_000
export const MEMORY_DELIVERY_BATCH = 10
export const MEMORY_DELIVERY_BACKOFF_MS = Object.freeze([1_000, 5_000, 30_000, 60_000, 300_000])
const MEMORY_SUCCESS_OUTCOMES = new Set(['ACCEPTED', 'ACKNOWLEDGED', 'PENDING_INBOUND'])
const MEMORY_TERMINAL_OUTCOMES = new Set(['REJECTED', 'UNKNOWN', 'AMBIGUOUS', 'FAILED', 'ERROR'])
const MEMORY_AUDIENCES = new Set(['DIRECT', 'GROUP', 'ROOM'])

const MEMORY_TRACE_KINDS = Object.freeze({
  pending: 'MEMORY_DELIVERY_PENDING',
  attempt: 'MEMORY_DELIVERY_ATTEMPT',
  acknowledged: 'MEMORY_DELIVERY_ACKNOWLEDGED',
  closed: 'MEMORY_DELIVERY_CLOSED',
})

const failure = (code, status = 409) => Object.assign(new Error(code), { code, status })

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(date.getTime())) throw failure('MEMORY_DELIVERY_TIME_INVALID', 500)
  return date
}

function nonEmpty(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function receiptOutcome(receipt) {
  if (!receipt || typeof receipt !== 'object') return null
  const value = nonEmpty(receipt.outcome ?? receipt.status)
  return value ? value.toUpperCase() : null
}

function successfulReceiptOutcome(receipt) {
  const outcome = receiptOutcome(receipt)
  if (!MEMORY_SUCCESS_OUTCOMES.has(outcome)) return null
  const receiptId = nonEmpty(receipt?.receiptId)
  if (!receiptId) return null
  // MSP's durable DTO has two successful shapes: a normal accepted record has
  // a returned message id, while PENDING_INBOUND is durable before that id
  // exists. Callers compare receiptId to the local CRM Message id below.
  if (outcome !== 'PENDING_INBOUND' && !nonEmpty(receipt?.messageId)) return null
  return outcome
}

function scopeOf(job, conversation = job?.inbound?.conversation) {
  if (!job || !conversation || job.tenantId !== conversation.tenantId
    || job.businessId !== conversation.businessId || conversation.channel !== 'LINE'
    || job.channelAccountId !== conversation.channelAccountId
    || typeof conversation.externalThreadId !== 'string'
    || !conversation.externalThreadId.trim()) {
    throw failure('MEMORY_DELIVERY_SCOPE_MISMATCH', 403)
  }
  if (!job.account || job.account.tenantId !== job.tenantId || job.account.businessId !== job.businessId) {
    throw failure('MEMORY_DELIVERY_SCOPE_MISMATCH', 403)
  }
  const accountChannel = job.account.bindingCode || job.account.id
  if (accountChannel !== job.channelAccountId) throw failure('MEMORY_DELIVERY_SCOPE_MISMATCH', 403)
  const audienceKind = typeof job.audienceKind === 'string' ? job.audienceKind.toUpperCase() : 'DIRECT'
  if (!MEMORY_AUDIENCES.has(audienceKind)) throw failure('MEMORY_DELIVERY_SCOPE_MISMATCH', 403)
  return {
    tenantId: job.tenantId,
    businessId: job.businessId,
    channelAccountId: job.channelAccountId,
    externalRoomRef: conversation.externalThreadId,
    audienceKind,
  }
}

function tracePayload({ job, inboundMessageId, outboundMessageId, conversation, attemptNumber, outcome, reason, providerAcceptance }) {
  const payload = {
    jobId: job.id,
    inboundMessageId,
    outboundMessageId: outboundMessageId ?? null,
    receiptId: outboundMessageId ?? null,
    channelAccountId: job.channelAccountId,
    externalThreadRef: conversation?.externalThreadId ?? null,
    audienceKind: typeof job.audienceKind === 'string' ? job.audienceKind.toUpperCase() : 'DIRECT',
    providerAcceptance: providerAcceptance ?? (job.providerMessageId || job.providerRequestId ? 'ACCEPTED_BY_LINE' : null),
    ...(reason ? { reason } : {}),
  }
  if (attemptNumber !== undefined) payload.attemptNumber = attemptNumber
  if (outcome !== undefined) payload.outcome = outcome
  return payload
}

/** Append one stable memory checkpoint. Delivery events never carry message text. */
export async function appendMemoryDeliveryCheckpoint(tx, {
  job,
  kind,
  key,
  payload,
  occurredAt = new Date(),
} = {}) {
  if (!job?.id || !job.tenantId || !job.businessId) throw failure('MEMORY_DELIVERY_SCOPE_MISMATCH', 403)
  try {
    return await appendTraceEvent(tx, {
      scope: { tenantId: job.tenantId, businessId: job.businessId },
      turnId: job.id,
      executionId: job.executionId ?? null,
      kind,
      idempotencyKey: key,
      payload,
      occurredAt,
    })
  } catch (error) {
    if (error?.code === 'EXECUTION_TRACE_IDEMPOTENCY_CONFLICT') {
      throw failure('MEMORY_DELIVERY_CHECKPOINT_CONFLICT')
    }
    throw error
  }
}

/**
 * Called by the provider acceptance transaction. The caller applies the
 * returned fields in the same transaction as the CRM OUTBOUND row and the
 * RECORDED job state.
 */
export async function prepareMemoryDeliveryPending(tx, {
  job,
  outboundMessageId,
  conversation,
  acceptedAt = new Date(),
} = {}) {
  if (!job?.memorySyncOptIn) return null
  const route = scopeOf(job, conversation)
  const at = asDate(acceptedAt)
  const payload = tracePayload({ job, inboundMessageId: job.inboundMessageId,
    outboundMessageId, conversation, providerAcceptance: 'ACCEPTED_BY_LINE' })
  await appendMemoryDeliveryCheckpoint(tx, {
    job,
    kind: MEMORY_TRACE_KINDS.pending,
    key: `memory-delivery:pending:${job.id}`,
    payload,
    occurredAt: at,
  })
  return {
    memoryDeliveryState: 'PENDING',
    memoryDeliveryNextAttemptAt: at,
    memoryDeliveryLeaseUntil: null,
    route,
  }
}

function dueWhere(now) {
  return {
    memorySyncOptIn: true,
    memoryDeliveryState: 'PENDING',
    OR: [{ memoryDeliveryLeaseUntil: null }, { memoryDeliveryLeaseUntil: { lte: now } }],
    AND: [{ OR: [{ memoryDeliveryNextAttemptAt: null }, { memoryDeliveryNextAttemptAt: { lte: now } }] }],
  }
}

function backoff(attempts) {
  const index = Math.max(0, Math.min(MEMORY_DELIVERY_BACKOFF_MS.length - 1, Number(attempts || 1) - 1))
  return MEMORY_DELIVERY_BACKOFF_MS[index]
}

async function transaction(db, work) {
  if (typeof db?.$transaction !== 'function') return work(db)
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await db.$transaction(work, { timeout: 15_000, maxWait: 5_000 })
    } catch (error) {
      if (attempt >= 2 || !['P2002', 'P2034'].includes(error?.code)) throw error
    }
  }
}

async function claimMemoryDelivery(db, candidate, { now, workerId, leaseMs }) {
  const at = asDate(now)
  return transaction(db, async tx => {
    const current = await tx.lineConversationJob.findUnique({ where: { id: candidate.id } })
    if (!current || !current.memorySyncOptIn || current.memoryDeliveryState !== 'PENDING'
      || (current.memoryDeliveryLeaseUntil && current.memoryDeliveryLeaseUntil > at)
      || (current.memoryDeliveryNextAttemptAt && current.memoryDeliveryNextAttemptAt > at)) return null
    const attemptNumber = current.memoryDeliveryAttempts + 1
    const leaseUntil = new Date(at.getTime() + leaseMs)
    const claimed = await tx.lineConversationJob.updateMany({
      where: {
        id: current.id,
        version: current.version,
        memorySyncOptIn: true,
        memoryDeliveryState: 'PENDING',
        OR: [{ memoryDeliveryLeaseUntil: null }, { memoryDeliveryLeaseUntil: { lte: at } }],
        AND: [{ OR: [{ memoryDeliveryNextAttemptAt: null }, { memoryDeliveryNextAttemptAt: { lte: at } }] }],
      },
      data: {
        memoryDeliveryAttempts: { increment: 1 },
        memoryDeliveryLeaseUntil: leaseUntil,
        version: { increment: 1 },
      },
    })
    if (!claimed.count) return null
    const attemptJob = { ...current, memoryDeliveryAttempts: attemptNumber,
      memoryDeliveryLeaseUntil: leaseUntil, version: current.version + 1, claimantId: workerId }
    const conversation = candidate.inbound?.conversation
    await appendMemoryDeliveryCheckpoint(tx, {
      job: attemptJob,
      kind: MEMORY_TRACE_KINDS.attempt,
      key: `memory-delivery:attempt:${current.id}:${attemptNumber}`,
      payload: tracePayload({ job: attemptJob, inboundMessageId: current.inboundMessageId,
        outboundMessageId: null, conversation, attemptNumber, outcome: 'UNKNOWN' }),
      occurredAt: at,
    })
    return attemptJob
  })
}

function sameInstant(left, right) {
  if (left === null || left === undefined || right === null || right === undefined) return left === right
  return new Date(left).getTime() === new Date(right).getTime()
}

function claimStillOwned(job, claimed) {
  return Boolean(job && claimed && job.id === claimed.id
    && job.version === claimed.version
    && job.memorySyncOptIn === true
    && job.memoryDeliveryState === 'PENDING'
    && sameInstant(job.memoryDeliveryLeaseUntil, claimed.memoryDeliveryLeaseUntil))
}

async function loadSource(db, claimed) {
  const job = await db.lineConversationJob.findUnique({
    where: { id: claimed.id },
    include: { account: true, inbound: { include: { conversation: true } } },
  })
  if (!job) return { job, stale: true, closed: true, reason: 'CLAIM_LOST' }
  if (!claimStillOwned(job, claimed)) return { job, stale: true, closed: true, reason: 'CLAIM_LOST' }
  if (!job.account || job.account.serverEnabled !== true || job.account.transportMode !== 'CLOUD'
    || job.account.status !== 'CONNECTED' || job.account.transportEpoch !== job.transportEpoch) {
    return { job, closed: true, reason: 'ACCOUNT_DISABLED' }
  }
  const conversation = job.inbound?.conversation
  if (job.errorCode === 'PDPA_ERASURE' || !job.inbound || job.inbound.body === CUSTOMER_ERASURE_TOMBSTONE) {
    return { job, conversation, closed: true, reason: 'PDPA_ERASURE' }
  }
  let route
  try { route = scopeOf(job, conversation) } catch { return { job, conversation, closed: true, reason: 'SCOPE_MISMATCH' } }
  const outbound = await db.message.findFirst({
    where: { conversationId: conversation.id, direction: 'OUTBOUND', externalMessageId: `reply:${job.inbound.id}` },
    include: { conversation: true },
  })
  if (!outbound || outbound.body === CUSTOMER_ERASURE_TOMBSTONE || outbound.conversationId !== conversation.id) {
    return { job, conversation, route, outbound, closed: true, reason: outbound ? 'PDPA_ERASURE' : 'CRM_RECEIPT_UNAVAILABLE' }
  }
  if (outbound.conversation.tenantId !== route.tenantId || outbound.conversation.businessId !== route.businessId
    || outbound.conversation.channel !== 'LINE' || outbound.conversation.channelAccountId !== route.channelAccountId) {
    return { job, conversation, route, outbound, closed: true, reason: 'SCOPE_MISMATCH' }
  }
  return { job, conversation, route, outbound, closed: false }
}

async function policyAllows({ job, route, policyResolver }) {
  const authorization = await policyResolver({
    tenantId: route.tenantId,
    businessId: route.businessId,
    lineUserId: job.sourceUserId,
    threadId: route.externalRoomRef,
    eventId: job.eventId,
    serverScope: {
      transportVerified: true,
      channelAccountId: route.channelAccountId,
      bindingId: route.channelAccountId,
      audienceKind: route.audienceKind,
      mspAuthorization: { read: true, writePrivate: false, writeShared: false },
    },
  })
  if (!authorization?.authContext?.scope
    || authorization.authContext.scope.tenantId !== route.tenantId
    || authorization.authContext.scope.businessId !== route.businessId) return false
  // A group/room transcript receipt is still scoped operational evidence, but
  // private context for those audiences remains denied by the existing fence.
  if (authorization.authContext.transport?.signatureVerified !== true) return false
  if (route.audienceKind === 'DIRECT') {
    return authorization.policy?.decision === 'ALLOW'
      && authorization.policy?.privateMemoryAllowed === true
      && authorization.policy?.mspAuthorization?.read === true
  }
  // A signed group/room transport is not an authorization to write a shared
  // transcript. The current MSP adapter grants deliveryWriter independently,
  // so this branch needs an affirmative Zuri shared/transcript grant before it
  // may invoke that writer; signature plus private denial is insufficient.
  return authorization.policy?.decision === 'ALLOW'
    && authorization.policy?.mspAuthorization?.allowed === true
    && authorization.policy?.mspAuthorization?.writeShared === true
    && authorization.policy?.privateMemoryAllowed !== true
}

async function releaseMemoryDelivery(db, claimed, { now, reason = null } = {}) {
  const at = asDate(now)
  try {
    return await transaction(db, async tx => {
      const current = await tx.lineConversationJob.findUnique({ where: { id: claimed.id } })
      if (!current || current.memoryDeliveryState !== 'PENDING' || current.version !== claimed.version) return false
      const result = await tx.lineConversationJob.updateMany({
        where: { id: claimed.id, version: claimed.version, memoryDeliveryState: 'PENDING', memoryDeliveryLeaseUntil: claimed.memoryDeliveryLeaseUntil },
        data: {
          memoryDeliveryLeaseUntil: null,
          memoryDeliveryNextAttemptAt: new Date(at.getTime() + backoff(current.memoryDeliveryAttempts)),
          version: { increment: 1 },
        },
      })
      return result.count === 1
    })
  } catch (error) {
    // A failed release is itself unknown; the short lease makes the row
    // reclaimable, and this path never creates a second provider or CRM effect.
    return false
  }
}

async function closeMemoryDelivery(db, source, { now, reason }) {
  if (!source?.job?.id) return false
  const at = asDate(now)
  return transaction(db, async tx => {
    const current = await tx.lineConversationJob.findUnique({ where: { id: source.job.id } })
    if (!current || current.memoryDeliveryState !== 'PENDING' || current.version !== source.job.version) return false
    const updated = await tx.lineConversationJob.updateMany({
      where: { id: current.id, version: source.job.version, memoryDeliveryState: 'PENDING', memoryDeliveryLeaseUntil: source.job.memoryDeliveryLeaseUntil },
      data: { memoryDeliveryState: 'CLOSED', memoryDeliveryNextAttemptAt: null, memoryDeliveryLeaseUntil: null, version: { increment: 1 } },
    })
    if (!updated.count) return false
    // Erasure redacts the complete trace immediately after this helper in the
    // erasure transaction. Once that tombstone exists, the trace turn guard
    // intentionally rejects new events; the closed operational state is still
    // durable and the tombstone is the authoritative erasure evidence.
    if (current.errorCode === 'PDPA_ERASURE') return true
    await appendMemoryDeliveryCheckpoint(tx, {
      job: current,
      kind: MEMORY_TRACE_KINDS.closed,
      key: `memory-delivery:closed:${current.id}`,
      payload: tracePayload({ job: current, inboundMessageId: current.inboundMessageId,
        outboundMessageId: source.outbound?.id ?? null, conversation: source.conversation, reason: reason || 'POLICY_DENIED' }),
      occurredAt: at,
    })
    return true
  })
}

async function acknowledgeMemoryDelivery(db, source, result, { now } = {}) {
  const at = asDate(now)
  return transaction(db, async tx => {
    const current = await tx.lineConversationJob.findUnique({ where: { id: source.job.id } })
    if (!current || current.memoryDeliveryState !== 'PENDING' || current.version !== source.job.version) return false
    const updated = await tx.lineConversationJob.updateMany({
      where: { id: current.id, version: source.job.version, memoryDeliveryState: 'PENDING', memoryDeliveryLeaseUntil: source.job.memoryDeliveryLeaseUntil },
      data: { memoryDeliveryState: 'ACKNOWLEDGED', memoryDeliveryNextAttemptAt: null, memoryDeliveryLeaseUntil: null, version: { increment: 1 } },
    })
    if (!updated.count) return false
    const outcome = successfulReceiptOutcome(result)
    if (!outcome) throw failure('MSP_DELIVERY_UNKNOWN')
    await appendMemoryDeliveryCheckpoint(tx, {
      job: current,
      kind: MEMORY_TRACE_KINDS.acknowledged,
      key: `memory-delivery:ack:${current.id}`,
      payload: tracePayload({ job: current, inboundMessageId: current.inboundMessageId,
        outboundMessageId: source.outbound?.id, conversation: source.conversation, outcome }),
      occurredAt: at,
    })
    return true
  })
}

/**
 * Fair, bounded receipt scanner. It only calls the injected MSP port and writes
 * local operational/checkpoint rows; LINE and CRM are never retried here.
 */
export async function reconcileLineMemoryDeliveries({
  db = prisma,
  threadMemory,
  now = () => new Date(),
  workerId = 'memory-scanner',
  batchSize = MEMORY_DELIVERY_BATCH,
  leaseMs = MEMORY_DELIVERY_LEASE_MS,
  policyResolver = resolveAgentAuthorization,
} = {}) {
  const result = { scanned: 0, acknowledged: 0, pending: 0, closed: 0, unknown: 0 }
  if (!threadMemory?.recordDelivery) return result
  const at = asDate(typeof now === 'function' ? now() : now)
  const take = Number.isInteger(batchSize) && batchSize > 0 && batchSize <= 50 ? batchSize : MEMORY_DELIVERY_BATCH
  const candidates = await db.lineConversationJob.findMany({
    where: dueWhere(at),
    orderBy: [{ memoryDeliveryNextAttemptAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    take,
    include: { inbound: { include: { conversation: true } } },
  })
  for (const candidate of candidates) {
    let claimed
    try { claimed = await claimMemoryDelivery(db, candidate, { now: at, workerId, leaseMs }) } catch {
      result.unknown += 1
      continue
    }
    if (!claimed) continue
    result.scanned += 1
    let source
    try {
      source = await loadSource(db, claimed)
    } catch {
      result.unknown += 1
      await releaseMemoryDelivery(db, claimed, { now: at, reason: 'SOURCE_READ_FAILED' })
      continue
    }
    source.job = source.job || claimed
    if (source.stale) continue
    // The source read races the erasure transaction intentionally. A missing or
    // tombstoned source is a local closed checkpoint, never a guessed payload.
    if (source.closed) {
      try {
        if (await closeMemoryDelivery(db, source, { now: at, reason: source.reason })) result.closed += 1
      } catch { result.unknown += 1 }
      continue
    }
    try {
      if (!(await policyAllows({ job: source.job, route: source.route, policyResolver }))) {
        if (await closeMemoryDelivery(db, source, { now: at, reason: 'POLICY_DENIED' })) result.closed += 1
        continue
      }

      // Policy resolution can await identity/database state. Re-read the claim
      // after it returns so an erasure, account disable or lease loss cannot
      // feed the pre-policy body into MSP.
      source = await loadSource(db, claimed)
      if (source.stale) continue
      if (source.closed) {
        if (await closeMemoryDelivery(db, source, { now: at, reason: source.reason })) result.closed += 1
        continue
      }
      const receipt = await threadMemory.recordDelivery({
        route: source.route,
        inboundMessageId: source.job.inboundMessageId,
        receiptId: source.outbound.id,
        text: source.outbound.body,
        providerRef: source.job.providerMessageId || source.job.providerRequestId || undefined,
        outcome: 'ACCEPTED',
      })
      const outcome = successfulReceiptOutcome(receipt)
      if (outcome && receipt.receiptId !== source.outbound.id) throw failure('MSP_DELIVERY_RECEIPT_MISMATCH')
      if (!outcome) throw failure(MEMORY_TERMINAL_OUTCOMES.has(receiptOutcome(receipt))
        ? 'MSP_DELIVERY_REJECTED' : 'MSP_DELIVERY_UNKNOWN')
      if (await acknowledgeMemoryDelivery(db, source, { ...receipt, outcome }, { now: at })) result.acknowledged += 1
    } catch {
      await releaseMemoryDelivery(db, claimed, { now: at })
      result.pending += 1
      result.unknown += 1
    }
  }
  return result
}

export { MEMORY_TRACE_KINDS, backoff, dueWhere }
