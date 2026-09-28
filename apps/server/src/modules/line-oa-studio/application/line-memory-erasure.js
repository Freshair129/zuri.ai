import { createHash, randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { appendTraceEvent, redactTraceTurn } from '@/modules/agent/execution-trace'

// @req FR-022, FR-149 — erasing a person also erases what MSP thread memory holds of
//   them. Owner decision 2026-09-28 (option A): every person with memory-sync data
//   gets exactly one tenant-wide MSP erase per erasure, whether their memory-sync
//   turns were DIRECT, GROUP or ROOM, including a person who only ever used DIRECT
//   memory. The erasure transaction records one Core-owned pending erasure per
//   (tenant, erased principal, erasure request) whenever the person had ANY
//   memory-sync job; a Core scanner in the Server tick asks MSP to erase that
//   principal (`msp_thread_principal_erase`), once, under a stable idempotency key.
//   Core stays the only MSP caller, and the same record serves SERVER- and
//   runtime-cohort turns, because both append to MSP through Core. Nothing is sent
//   to MSP inside the erasure transaction; until MSP acknowledges, the record stays
//   PENDING and visible (docs/plans/LINE-TO-GKS-GROUNDING-AND-CANDIDATE-PIPELINE-DESIGN.md,
//   D-8 and the MSP row: "never silently dropped"). On acknowledgement the record's
//   own trace is redacted.
//   What MSP does with the call (API-011 at the deployed MSP pin): the erase is
//   tenant- and principal-scoped, NOT thread-bound, and idempotent by (tenant,
//   idempotency key). It tombstones the principal's own HUMAN messages in every
//   thread of the tenant (text blanked), closes their participant rows, tombstones
//   session summaries and delivery receipts only in threads where they are the sole
//   human, tombstones protected_memory_records where they are the speaker or the
//   subject, and, only when asked with `erase_vault` (Core does not ask), their vault
//   rows. AGENT replies and shared-thread summaries are kept: whether those should
//   go too is an MSP contract question, not changed here. The call carries no room,
//   so no thread is resolved or minted to send it.
//   Records written before this decision (one per shared GROUP/ROOM thread, payload
//   with a `route`) drain through the same tenant-wide call under their own stored
//   key: the first to be acknowledged erases the whole tenant, later ones find
//   nothing left.
// @spec ADR-061, ADR-091, SEC-001, SEC-005 — Core's data-subject grant: private read
//   and write false, dataSubjectAccess and dataSubjectAdmin true.
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
const MEMORY_AUDIENCES = new Set(['DIRECT', 'GROUP', 'ROOM'])
const REDACTED = '{"redacted":true}'
// The Core erasure authority MSP sees. It acts for the data subject, never as them.
export const MEMORY_ERASURE_ACTOR = 'zuri-core-pdpa-erasure'
// The payload marker of a record written under the owner decision of 2026-09-28.
// A record without it (it has a `route`) is the earlier per-thread shape.
export const MEMORY_ERASURE_SCOPE = 'TENANT_PRINCIPAL'

const uuidShape = hex => `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`

/**
 * A deterministic synthetic turn for one (tenant, principal, erasure request). The
 * request is named by the memory-sync jobs it erased, so the same transaction
 * replayed writes the same record, and a later erasure of the same person covering
 * newer turns gets a record of its own instead of meeting a closed, redacted one.
 */
export function memoryErasureTurnId({ tenantId, principalId, jobIds = [] }) {
  const request = createHash('sha256').update(JSON.stringify([...new Set(jobIds)].sort())).digest('hex')
  return uuidShape(createHash('sha256').update(JSON.stringify(['msp-principal-erasure', tenantId, principalId, request])).digest('hex'))
}

/**
 * In the erasure transaction, before the jobs are overwritten: one pending erasure
 * for the person when any of their jobs synced memory, in any audience. `jobs` are
 * the rows `redactLineConversationJobs` selected (audience, speaker and channel
 * account still intact); `speakers` are the person's own subjects. A DIRECT job
 * counts as theirs by selection (their own thread); a GROUP or ROOM job only when
 * its speaker is one of their own subjects.
 */
export async function recordMemoryPrincipalErasure(tx, { tenantId, principalId, jobs = [], speakers = [], now = new Date() } = {}) {
  if (typeof tenantId !== 'string' || !tenantId || typeof principalId !== 'string' || !principalId) return { pendingPrincipalErasures: 0 }
  const own = new Set(speakers.map(speaker => `${speaker.channelAccountId}|${speaker.providerSubject}`))
  const synced = jobs.filter(job => job?.memorySyncOptIn && MEMORY_AUDIENCES.has(job.audienceKind)
    && typeof job.businessId === 'string' && job.businessId
    && (job.audienceKind === 'DIRECT' || own.has(`${job.channelAccountId}|${job.sourceUserId}`)))
  if (!synced.length) return { pendingPrincipalErasures: 0 }
  const turnId = memoryErasureTurnId({ tenantId, principalId,
    jobIds: synced.map(job => job.id ?? `${job.channelAccountId}|${job.recipientId}|${job.sourceUserId}`) })
  // The trace needs one Business scope; the erase itself is tenant-wide.
  const businessId = synced.map(job => job.businessId).sort()[0]
  const audiences = [...new Set(synced.map(job => job.audienceKind))].sort()
  try {
    await appendTraceEvent(tx, { scope: { tenantId, businessId }, turnId, executionId: null,
      kind: MEMORY_ERASURE_KINDS.pending, idempotencyKey: `${turnId}:pending`,
      payload: { scope: MEMORY_ERASURE_SCOPE, principalId, audiences, idempotencyKey: `msp-principal-erasure:${turnId}` }, occurredAt: now })
  } catch (error) {
    // Already erased and acknowledged: that record's turn is closed and redacted.
    if (error?.code !== 'EXECUTION_TRACE_TURN_REDACTED') throw error
    return { pendingPrincipalErasures: 0 }
  }
  return { pendingPrincipalErasures: 1 }
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

/** Core's data-subject authority in one tenant: no private read or write. */
function erasureAuthorization(tenantId) {
  return { authContext: {
    actor: { principalId: MEMORY_ERASURE_ACTOR },
    scope: { tenantId, businessId: null },
    policy: { decision: 'ALLOW', version: 'pdpa-erasure-v1', privateMemoryAllowed: false,
      mspAuthorization: { read: false, writePrivate: false, dataSubjectAccess: true, dataSubjectAdmin: true } },
  } }
}

/** What to send for a record of either shape; null when the record cannot name it. */
function erasureRequest(row) {
  let payload
  try { payload = JSON.parse(row.payloadJson) } catch { return null }
  const principalId = payload?.principalId
  const idempotencyKey = payload?.idempotencyKey
  if (typeof principalId !== 'string' || !principalId || typeof idempotencyKey !== 'string' || !idempotencyKey) return null
  // Both shapes erase in the record's own tenant: a per-thread record's route names
  // the same tenant, and MSP's erase takes no thread anyway.
  return { tenantId: row.tenantId, principalId, idempotencyKey }
}

// Candidate pages read per tick. A page holds at most this many open records.
export const MEMORY_ERASURE_SCAN_PAGE = 100
export const MEMORY_ERASURE_SCAN_MAX_PAGES = 10

// Where the previous tick stopped, per database client: the next tick resumes after
// it, so records held for a long time (backoff, a claim in flight) cannot keep a due
// record behind them out of reach for more than a bounded number of ticks.
const scanCursors = new WeakMap()

/**
 * One page of open records (PENDING, not redacted, no FAILED row for the turn),
 * oldest first, strictly after the record `afterId` by (occurredAt, id). The
 * anti-join keeps FAILED records, which are kept for manual erasure and never
 * removed, out of every page however many accumulate. The keyset reads the cursor
 * row's own (occurredAt, id) in SQL, so no timestamp is bound from JavaScript and
 * the page reads the same on SQLite and PostgreSQL whatever the session time zone.
 * Served by the index on AgentTraceEvent (kind, occurredAt, id).
 */
function openPage(db, afterId) {
  if (!afterId) {
    return db.$queryRaw`
      SELECT p."id" AS "id" FROM "AgentTraceEvent" p
      WHERE p."kind" = ${MEMORY_ERASURE_KINDS.pending} AND p."payloadJson" <> ${REDACTED}
        AND NOT EXISTS (SELECT 1 FROM "AgentTraceEvent" f
          WHERE f."tenantId" = p."tenantId" AND f."businessId" = p."businessId" AND f."turnId" = p."turnId"
            AND f."kind" = ${MEMORY_ERASURE_KINDS.failed})
      ORDER BY p."occurredAt" ASC, p."id" ASC
      LIMIT ${MEMORY_ERASURE_SCAN_PAGE}`
  }
  return db.$queryRaw`
    SELECT p."id" AS "id" FROM "AgentTraceEvent" p
    WHERE p."kind" = ${MEMORY_ERASURE_KINDS.pending} AND p."payloadJson" <> ${REDACTED}
      AND (p."occurredAt", p."id") > (SELECT c."occurredAt", c."id" FROM "AgentTraceEvent" c WHERE c."id" = ${afterId})
      AND NOT EXISTS (SELECT 1 FROM "AgentTraceEvent" f
        WHERE f."tenantId" = p."tenantId" AND f."businessId" = p."businessId" AND f."turnId" = p."turnId"
          AND f."kind" = ${MEMORY_ERASURE_KINDS.failed})
    ORDER BY p."occurredAt" ASC, p."id" ASC
    LIMIT ${MEMORY_ERASURE_SCAN_PAGE}`
}

/**
 * The next `take` due records, with every query bounded:
 *  - at most MEMORY_ERASURE_SCAN_MAX_PAGES keyset pages of at most
 *    MEMORY_ERASURE_SCAN_PAGE open records are read per tick;
 *  - grace, the claim window and DEFERRED scheduling are checked only for one
 *    page's turns at a time.
 * The scan resumes after the record the previous tick stopped at and wraps to the
 * oldest record once, so a due record is reached within a bounded delay: about
 * ceil(open records / (PAGE * MAX_PAGES)) ticks, plus one per full batch of due
 * records ahead of it, however many records in backoff or with an attempt in
 * flight stand before it. The page loop ends
 * early only when it meets a record still inside the grace window: records are
 * read oldest first, so every later one is inside it too.
 */
async function dueErasureRecords(db, { at, take }) {
  const graceCutoff = new Date(at.getTime() - MEMORY_ERASURE_GRACE_MS)
  const claimCutoff = new Date(at.getTime() - MEMORY_ERASURE_CLAIM_MS)
  const due = []
  const examined = new Set()
  let after = scanCursors.get(db) ?? null
  let wrapped = after === null
  let resume = null
  scan: for (let page = 0; page < MEMORY_ERASURE_SCAN_MAX_PAGES; page += 1) {
    const open = await openPage(db, after)
    const ids = open.map(row => row.id)
    const rows = ids.length ? await db.agentTraceEvent.findMany({
      where: { id: { in: ids }, kind: MEMORY_ERASURE_KINDS.pending },
      orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    }) : []
    const eligible = rows.filter(row => row.occurredAt <= graceCutoff)
    const held = new Set(eligible.length ? (await db.agentTraceEvent.findMany({
      where: { turnId: { in: eligible.map(row => row.turnId) }, OR: [
        { kind: MEMORY_ERASURE_KINDS.deferred, occurredAt: { gt: at } },
        { kind: MEMORY_ERASURE_KINDS.attempt, occurredAt: { gt: claimCutoff } },
      ] },
      select: { tenantId: true, businessId: true, turnId: true },
    })).map(row => `${row.tenantId}|${row.businessId}|${row.turnId}`) : [])
    let inGrace = false
    for (const row of rows) {
      if (examined.has(row.id)) { resume = null; break scan } // wrapped round to where this tick began
      if (row.occurredAt > graceCutoff) { inGrace = true; break }
      examined.add(row.id)
      if (!held.has(`${row.tenantId}|${row.businessId}|${row.turnId}`)) due.push(row)
      if (due.length >= take) { resume = row.id; break scan }
    }
    if (inGrace || open.length < MEMORY_ERASURE_SCAN_PAGE) {
      // The end of what can be due: start again from the oldest record, once.
      resume = null
      if (wrapped) break
      wrapped = true
      after = null
      continue
    }
    after = ids[ids.length - 1]
    resume = after
  }
  if (resume) scanCursors.set(db, resume)
  else scanCursors.delete(db)
  return due
}

/**
 * Bounded scanner over DUE records only. A record is due when its grace period has
 * passed and nothing holds it: no attempt in flight (claimed within
 * MEMORY_ERASURE_CLAIM_MS), no retry scheduled for later, not FAILED. That is
 * decided in bounded queries (`dueErasureRecords`), so records in backoff or spent
 * never occupy a batch, a fresh erasure in any tenant is reached within a bounded
 * delay, and FAILED records never grow what a tick reads. Each due record is
 * claimed by appending the next ATTEMPT row with a nonce (a concurrent scanner
 * loses on the idempotency key); MSP is then asked to erase the principal in the
 * record's tenant. On success: ACKNOWLEDGED, then the record's trace is redacted.
 * On failure: a DEFERRED row scheduled after the backoff, or, when the attempts are
 * spent, a FAILED row and an alert. Nothing is ever dropped.
 */
export async function reconcileLineMemoryErasures({ db = prisma, threadMemory, now = () => new Date(), batchSize = 10,
  alert = defaultAlert } = {}) {
  const result = { scanned: 0, acknowledged: 0, pending: 0, failed: 0 }
  if (typeof threadMemory?.erasePrincipalInTenant !== 'function') return result
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
    try {
      const request = erasureRequest(row)
      if (!request) throw Object.assign(new Error('MEMORY_ERASURE_RECORD_INVALID'), { code: 'MEMORY_ERASURE_RECORD_INVALID' })
      const erased = await threadMemory.erasePrincipalInTenant({ tenantId: request.tenantId, principalId: request.principalId,
        idempotencyKey: request.idempotencyKey, authorization: erasureAuthorization(request.tenantId) })
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
        // principal it needs for a manual erasure; the log names no principal.
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
