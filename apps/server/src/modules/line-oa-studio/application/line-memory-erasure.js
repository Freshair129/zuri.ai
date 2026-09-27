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
// @tested tests/integration/conversation-runtime-memory-group-gks.test.js,
//   tests/integration/line-memory-erasure-due-query.test.js

export const MEMORY_ERASURE_KINDS = Object.freeze({
  pending: 'MEMORY_THREAD_ERASURE_PENDING',
  attempt: 'MEMORY_THREAD_ERASURE_ATTEMPT',
  // Its `occurredAt` is the time the next attempt is scheduled for, so which
  // records are due is decided in the query, never by scanning a fixed batch.
  deferred: 'MEMORY_THREAD_ERASURE_DEFERRED',
  acknowledged: 'MEMORY_THREAD_ERASURE_ACKNOWLEDGED',
  // Terminal: the attempts are spent. Alerted, never retried silently, never dropped.
  failed: 'MEMORY_THREAD_ERASURE_FAILED',
})
// Retries after the first failed attempt; the attempt after the last one is final.
export const MEMORY_ERASURE_BACKOFF_MS = Object.freeze([60_000, 300_000, 900_000, 3_600_000, 21_600_000, 86_400_000, 86_400_000])
export const MEMORY_ERASURE_MAX_ATTEMPTS = MEMORY_ERASURE_BACKOFF_MS.length + 1
// An attempt in flight holds its record this long; a scanner that dies mid-call
// frees it for the next scan after that, and MSP deduplicates by the idempotency key.
export const MEMORY_ERASURE_CLAIM_MS = 60_000
// @req FR-022 — a turn of the erased speaker may already be past its last fence and
// about to append to the thread when the erasure commits. No first attempt is made
// until any such turn's claim (LINE_JOB_LEASE_MS, 5 minutes) must have ended, plus
// a margin, so a late append cannot land after the acknowledged erasure.
export const MEMORY_ERASURE_GRACE_MS = 330_000
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

function backoff(attemptNumber) {
  return MEMORY_ERASURE_BACKOFF_MS[Math.max(0, Math.min(MEMORY_ERASURE_BACKOFF_MS.length - 1, attemptNumber - 1))]
}

const safeCode = error => {
  const code = error?.code ?? error?.message
  return typeof code === 'string' && /^[A-Z0-9_:-]{1,80}$/.test(code) ? code : 'MSP_ERASURE_FAILED'
}

function defaultAlert(entry) {
  process.stderr.write(`${JSON.stringify(entry)}\n`)
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

// Candidate pages read per tick. A page holds at most this many open records; the
// scan stops at the first page that yields a full batch or at the last page.
export const MEMORY_ERASURE_SCAN_PAGE = 100
export const MEMORY_ERASURE_SCAN_MAX_PAGES = 10

/**
 * The next `take` due records, oldest first, with every query bounded:
 *  - a page of open records (PENDING, not redacted, no FAILED row for the turn) is
 *    read with an anti-join, so FAILED records, which are kept for manual erasure
 *    and never removed, cost nothing however many accumulate;
 *  - grace, the claim window and DEFERRED scheduling are checked only for that
 *    page's turns (at most MEMORY_ERASURE_SCAN_PAGE of them).
 * Only records that are alive (in grace, in backoff or with an attempt in flight)
 * can stand between the scan and a due record, and at most
 * MEMORY_ERASURE_SCAN_PAGE * MEMORY_ERASURE_SCAN_MAX_PAGES are looked at per tick.
 * The anti-join compares no timestamps, so it reads the same on SQLite and
 * PostgreSQL whatever the session time zone; every time comparison goes through
 * Prisma.
 */
async function dueErasureRecords(db, { at, take }) {
  const graceCutoff = new Date(at.getTime() - MEMORY_ERASURE_GRACE_MS)
  const claimCutoff = new Date(at.getTime() - MEMORY_ERASURE_CLAIM_MS)
  const due = []
  for (let page = 0; page < MEMORY_ERASURE_SCAN_MAX_PAGES && due.length < take; page += 1) {
    const open = await db.$queryRaw`
      SELECT p."id" AS "id" FROM "AgentTraceEvent" p
      WHERE p."kind" = ${MEMORY_ERASURE_KINDS.pending} AND p."payloadJson" <> ${REDACTED}
        AND NOT EXISTS (SELECT 1 FROM "AgentTraceEvent" f
          WHERE f."tenantId" = p."tenantId" AND f."businessId" = p."businessId" AND f."turnId" = p."turnId"
            AND f."kind" = ${MEMORY_ERASURE_KINDS.failed})
      ORDER BY p."occurredAt" ASC, p."id" ASC
      LIMIT ${MEMORY_ERASURE_SCAN_PAGE} OFFSET ${page * MEMORY_ERASURE_SCAN_PAGE}`
    if (!open.length) break
    const candidates = await db.agentTraceEvent.findMany({
      where: { id: { in: open.map(row => row.id) }, kind: MEMORY_ERASURE_KINDS.pending, occurredAt: { lte: graceCutoff } },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    })
    if (candidates.length) {
      const held = new Set((await db.agentTraceEvent.findMany({
        where: { turnId: { in: candidates.map(row => row.turnId) }, OR: [
          { kind: MEMORY_ERASURE_KINDS.deferred, occurredAt: { gt: at } },
          { kind: MEMORY_ERASURE_KINDS.attempt, occurredAt: { gt: claimCutoff } },
        ] },
        select: { tenantId: true, businessId: true, turnId: true },
      })).map(row => `${row.tenantId}|${row.businessId}|${row.turnId}`))
      for (const row of candidates) {
        if (due.length >= take) break
        if (!held.has(`${row.tenantId}|${row.businessId}|${row.turnId}`)) due.push(row)
      }
    }
    // Records still in grace are the newest: once a page ends inside the grace
    // period, no later page can hold a due record.
    if (open.length < MEMORY_ERASURE_SCAN_PAGE || candidates.length < open.length) break
  }
  return due
}

/**
 * Bounded scanner over DUE records only. A record is due when its grace period has
 * passed and nothing holds it: no attempt in flight (claimed within
 * MEMORY_ERASURE_CLAIM_MS), no retry scheduled for later, not FAILED. That is
 * decided in bounded queries (`dueErasureRecords`), so records in backoff or spent
 * never occupy a batch, a fresh erasure in any tenant is reached, and FAILED
 * records never grow what a tick reads. Each due record is claimed by
 * appending the next ATTEMPT row with a nonce (a concurrent scanner loses on the
 * idempotency key); MSP is then asked to erase the principal from the thread. On
 * success: ACKNOWLEDGED, then the record's trace is redacted. On failure: a DEFERRED
 * row scheduled after the backoff, or, when the attempts are spent, a FAILED row and
 * an alert. Nothing is ever dropped.
 */
export async function reconcileLineMemoryErasures({ db = prisma, threadMemory, now = () => new Date(), batchSize = 10,
  alert = defaultAlert } = {}) {
  const result = { scanned: 0, acknowledged: 0, pending: 0, failed: 0 }
  if (typeof threadMemory?.erasePrincipal !== 'function' || typeof threadMemory?.resolveThread !== 'function') return result
  const at = typeof now === 'function' ? now() : now
  const take = Number.isInteger(batchSize) && batchSize > 0 && batchSize <= 50 ? batchSize : 10
  const rows = await dueErasureRecords(db, { at, take })
  for (const row of rows) {
    const scope = { tenantId: row.tenantId, businessId: row.businessId }
    const events = await db.agentTraceEvent.findMany({ where: { ...scope, turnId: row.turnId } })
    if (events.some(event => event.kind === MEMORY_ERASURE_KINDS.acknowledged)) {
      await redactTraceTurn(db, { scope, turnId: row.turnId, now: at })
      continue
    }
    const attemptNumber = events.filter(event => event.kind === MEMORY_ERASURE_KINDS.attempt).length + 1
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
      if (!threadId) throw Object.assign(new Error('MSP_THREAD_UNRESOLVED'), { code: 'MSP_THREAD_UNRESOLVED' })
      const erased = await threadMemory.erasePrincipal({ threadId, principalId, idempotencyKey, authorization: erasureAuthorization(route) })
      if (!erased || typeof erased !== 'object') throw Object.assign(new Error('MSP_ERASURE_UNACKNOWLEDGED'), { code: 'MSP_ERASURE_UNACKNOWLEDGED' })
      await appendTraceEvent(db, { scope, turnId: row.turnId, executionId: null, kind: MEMORY_ERASURE_KINDS.acknowledged,
        idempotencyKey: `${row.turnId}:acknowledged`, payload: { acknowledgedAt: at.toISOString(), attemptNumber }, occurredAt: at })
      await redactTraceTurn(db, { scope, turnId: row.turnId, now: at })
      result.acknowledged += 1
    } catch (error) {
      const code = safeCode(error)
      if (attemptNumber >= MEMORY_ERASURE_MAX_ATTEMPTS) {
        await appendTraceEvent(db, { scope, turnId: row.turnId, executionId: null, kind: MEMORY_ERASURE_KINDS.failed,
          idempotencyKey: `${row.turnId}:failed`, payload: { attemptNumber, code }, occurredAt: at })
        // Operator signal: an erasure MSP never acknowledged. The record keeps the
        // route and principal it needs for a manual erasure; the log names neither.
        alert({ event: 'line-memory-erasure.failed', severity: 'error', recordTurnId: row.turnId,
          tenantId: row.tenantId, attempts: attemptNumber, code })
        result.failed += 1
      } else {
        await appendTraceEvent(db, { scope, turnId: row.turnId, executionId: null, kind: MEMORY_ERASURE_KINDS.deferred,
          idempotencyKey: `${row.turnId}:deferred:${attemptNumber}`, payload: { attemptNumber, code },
          occurredAt: new Date(at.getTime() + backoff(attemptNumber)) })
        result.pending += 1
      }
    }
  }
  return result
}
