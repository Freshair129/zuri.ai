import { createHash, randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { appendTraceEvent, redactTraceTurn } from '@/modules/agent/execution-trace'

// @req FR-022, FR-149 — erasing one speaker of a LINE group or room also erases that
//   speaker's contributions from the group's MSP thread memory, and nobody else's.
//   The erasure transaction records one Core-owned pending erasure per (person,
//   shared thread) they had memory-sync turns in; a Core scanner in the Server tick
//   asks MSP to erase that principal from that thread (`msp_thread_principal_erase`),
//   once, under a stable idempotency key. Core stays the only MSP caller, and the
//   same record serves SERVER- and runtime-cohort turns, because both append to the
//   same MSP thread through Core. Nothing is sent to MSP inside the erasure
//   transaction; until MSP acknowledges, the record stays PENDING and visible
//   (docs/plans/LINE-TO-GKS-GROUNDING-AND-CANDIDATE-PIPELINE-DESIGN.md, D-8 and the
//   MSP row: "never silently dropped"). On acknowledgement the record's own trace is
//   redacted, so Core keeps no list of the groups an erased person was in.
// @spec ADR-061, ADR-091, SEC-001, SEC-005 — a DIRECT thread keeps today's behaviour
//   (its pending delivery receipt is closed by the job erasure).
// @tested tests/integration/conversation-runtime-memory-group-gks.test.js

export const MEMORY_ERASURE_KINDS = Object.freeze({
  pending: 'MEMORY_THREAD_ERASURE_PENDING',
  attempt: 'MEMORY_THREAD_ERASURE_ATTEMPT',
  acknowledged: 'MEMORY_THREAD_ERASURE_ACKNOWLEDGED',
})
export const MEMORY_ERASURE_BACKOFF_MS = Object.freeze([1_000, 5_000, 30_000, 60_000, 300_000])
const SHARED_AUDIENCES = new Set(['GROUP', 'ROOM'])
const REDACTED = '{"redacted":true}'
// The Core erasure authority MSP sees. It acts for the data subject, never as them.
export const MEMORY_ERASURE_ACTOR = 'zuri-core-pdpa-erasure'

/** A deterministic synthetic turn for one (tenant, person, shared thread) erasure. */
export function memoryErasureTurnId({ tenantId, principalId, channelAccountId, externalRoomRef }) {
  const hex = createHash('sha256').update(JSON.stringify(['msp-thread-erasure', tenantId, principalId, channelAccountId, externalRoomRef])).digest('hex')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

/**
 * In the erasure transaction, before the jobs are overwritten: one pending erasure
 * per shared thread the erased person spoke in with memory sync. `jobs` are the
 * rows `redactLineConversationJobs` selected (with audience, recipient, speaker and
 * channel account still intact); `speakers` are the person's own subjects.
 */
export async function recordMemoryThreadErasures(tx, { tenantId, principalId, jobs = [], speakers = [], now = new Date() } = {}) {
  if (typeof principalId !== 'string' || !principalId) return { pendingThreads: 0 }
  const own = new Set(speakers.map(speaker => `${speaker.channelAccountId}|${speaker.providerSubject}`))
  const threads = new Map()
  for (const job of jobs) {
    if (!job.memorySyncOptIn || !SHARED_AUDIENCES.has(job.audienceKind) || !own.has(`${job.channelAccountId}|${job.sourceUserId}`)
      || typeof job.recipientId !== 'string' || !job.recipientId || job.recipientId === job.sourceUserId) continue
    const route = { tenantId, businessId: job.businessId, channelAccountId: job.channelAccountId,
      externalRoomRef: job.recipientId, audienceKind: job.audienceKind }
    const turnId = memoryErasureTurnId({ tenantId, principalId, channelAccountId: route.channelAccountId, externalRoomRef: route.externalRoomRef })
    threads.set(turnId, route)
  }
  let recorded = 0
  for (const [turnId, route] of threads) {
    try {
      await appendTraceEvent(tx, { scope: { tenantId, businessId: route.businessId }, turnId, executionId: null,
        kind: MEMORY_ERASURE_KINDS.pending, idempotencyKey: `${turnId}:pending`,
        payload: { route, principalId, idempotencyKey: `msp-thread-erasure:${turnId}` }, occurredAt: now })
      recorded += 1
    } catch (error) {
      // Already erased and acknowledged: that record's turn is closed and redacted.
      if (error?.code !== 'EXECUTION_TRACE_TURN_REDACTED') throw error
    }
  }
  return { pendingThreads: recorded }
}

function backoff(attempts) {
  return MEMORY_ERASURE_BACKOFF_MS[Math.max(0, Math.min(MEMORY_ERASURE_BACKOFF_MS.length - 1, attempts - 1))]
}

/** Core's data-subject authority over one thread: MSP-scoped to the route, no private read or write. */
function erasureAuthorization(route) {
  return { authContext: {
    actor: { principalId: MEMORY_ERASURE_ACTOR },
    scope: { tenantId: route.tenantId, businessId: route.businessId ?? null },
    policy: { decision: 'ALLOW', version: 'pdpa-erasure-v1', privateMemoryAllowed: false,
      mspAuthorization: { read: false, writePrivate: false, dataSubjectAccess: true, dataSubjectAdmin: true } },
  } }
}

/**
 * Fair, bounded scanner. Each pending erasure is claimed by appending the next
 * ATTEMPT row with a nonce (a concurrent scanner loses on the idempotency key),
 * then MSP is asked to erase the principal from the thread. On success the
 * ACKNOWLEDGED row is appended and the record's turn is redacted.
 */
export async function reconcileLineMemoryErasures({ db = prisma, threadMemory, now = () => new Date(), batchSize = 10 } = {}) {
  const result = { scanned: 0, acknowledged: 0, pending: 0 }
  if (typeof threadMemory?.erasePrincipal !== 'function' || typeof threadMemory?.resolveThread !== 'function') return result
  const at = typeof now === 'function' ? now() : now
  const rows = await db.agentTraceEvent.findMany({
    where: { kind: MEMORY_ERASURE_KINDS.pending, payloadJson: { not: REDACTED } },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], take: Number.isInteger(batchSize) && batchSize > 0 && batchSize <= 50 ? batchSize : 10,
  })
  for (const row of rows) {
    const scope = { tenantId: row.tenantId, businessId: row.businessId }
    const events = await db.agentTraceEvent.findMany({ where: { ...scope, turnId: row.turnId } })
    const acknowledged = events.find(event => event.kind === MEMORY_ERASURE_KINDS.acknowledged)
    if (acknowledged) {
      await redactTraceTurn(db, { scope, turnId: row.turnId, now: at })
      continue
    }
    const attempts = events.filter(event => event.kind === MEMORY_ERASURE_KINDS.attempt)
    const last = attempts.reduce((latest, event) => (!latest || event.occurredAt > latest ? event.occurredAt : latest), null)
    if (last && at.getTime() - new Date(last).getTime() < backoff(attempts.length)) continue
    const attemptNumber = attempts.length + 1
    try {
      await appendTraceEvent(db, { scope, turnId: row.turnId, executionId: null, kind: MEMORY_ERASURE_KINDS.attempt,
        idempotencyKey: `${row.turnId}:attempt:${attemptNumber}`, payload: { attemptNumber, claim: randomUUID() }, occurredAt: at })
    } catch { continue } // another scanner holds this attempt
    result.scanned += 1
    const { route, principalId, idempotencyKey } = JSON.parse(row.payloadJson)
    try {
      const resolved = await threadMemory.resolveThread({ threadKind: route.audienceKind, audienceKind: route.audienceKind,
        channelType: 'LINE', channelAccountId: route.channelAccountId, externalRoomRef: route.externalRoomRef,
        tenantId: route.tenantId, businessId: route.businessId })
      const threadId = resolved?.thread?.threadId
      if (!threadId) throw new Error('MSP_THREAD_UNRESOLVED')
      const erased = await threadMemory.erasePrincipal({ threadId, principalId, idempotencyKey, authorization: erasureAuthorization(route) })
      if (!erased || typeof erased !== 'object') throw new Error('MSP_ERASURE_UNACKNOWLEDGED')
      await appendTraceEvent(db, { scope, turnId: row.turnId, executionId: null, kind: MEMORY_ERASURE_KINDS.acknowledged,
        idempotencyKey: `${row.turnId}:acknowledged`, payload: { acknowledgedAt: at.toISOString(), attemptNumber }, occurredAt: at })
      await redactTraceTurn(db, { scope, turnId: row.turnId, now: at })
      result.acknowledged += 1
    } catch {
      // Unknown or refused: the record stays PENDING and is retried after backoff.
      result.pending += 1
    }
  }
  return result
}
