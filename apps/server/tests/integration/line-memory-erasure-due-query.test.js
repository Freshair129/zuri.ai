import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { appendTraceEvent } from '@/modules/agent/execution-trace'
import { MEMORY_ERASURE_BACKOFF_MS, MEMORY_ERASURE_CLAIM_MS, MEMORY_ERASURE_GRACE_MS, MEMORY_ERASURE_KINDS,
  MEMORY_ERASURE_SCAN_MAX_PAGES, MEMORY_ERASURE_SCAN_PAGE, MEMORY_ERASURE_SCOPE,
  reconcileLineMemoryErasures, recordMemoryPrincipalErasure } from '@/modules/line-oa-studio/application/line-memory-erasure'

// @req FR-022 — the MSP memory erasure scanner picks due records with bounded
//   queries: an anti-join drops FAILED records (kept forever for manual erasure) from
//   each keyset page, and grace, the claim window and DEFERRED scheduling are checked
//   only for the page's turns. The scan resumes where the previous tick stopped, so a
//   due record behind any number of held ones is reached within a bounded number of
//   ticks. The same file runs on SQLite (default config) and on PostgreSQL
//   (vitest.postgres.config.js), because the anti-join and the keyset are raw SQL.
// @spec ADR-106, SEC-005
// @tested this file

const scope = { tenantId: randomUUID(), businessId: randomUUID() }
const channelAccountId = 'due-query-oa'

async function seed(room, occurredAt) {
  const sourceUserId = `${room}-speaker`
  await recordMemoryPrincipalErasure(prisma, { tenantId: scope.tenantId, principalId: `${room}-principal`,
    jobs: [{ id: `${room}-job`, memorySyncOptIn: true, audienceKind: 'GROUP', channelAccountId, businessId: scope.businessId, sourceUserId, recipientId: room }],
    speakers: [{ channelAccountId, providerSubject: sourceUserId }], now: occurredAt })
  const [row] = (await prisma.agentTraceEvent.findMany({ where: { ...scope, kind: MEMORY_ERASURE_KINDS.pending } }))
    .filter(item => item.payloadJson.includes(`"${room}-principal"`))
  return row
}

const append = (row, kind, key, occurredAt, payload = {}) => appendTraceEvent(prisma, { scope, turnId: row.turnId, executionId: null,
  kind, idempotencyKey: `${row.turnId}:${key}`, payload, occurredAt })

function recordingMsp() {
  const erased = []
  return { erased, port: {
    erasePrincipalInTenant: async input => {
      erased.push(input.principalId.slice(0, -'-principal'.length))
      return { erasureReceiptId: `receipt-${input.idempotencyKey}` }
    },
  } }
}

/** A database client of its own (so a scan cursor of its own) that counts pages and reads. */
function observed() {
  const stats = { pages: 0, reads: [] }
  const traceModel = new Proxy(prisma.agentTraceEvent, { get(target, prop) {
    const value = Reflect.get(target, prop)
    if (prop !== 'findMany') return typeof value === 'function' ? value.bind(target) : value
    return args => { stats.reads.push(args); return target.findMany(args) }
  } })
  const db = new Proxy(prisma, { get(target, prop) {
    if (prop === 'agentTraceEvent') return traceModel
    if (prop === '$queryRaw') return (...args) => { stats.pages += 1; return target.$queryRaw(...args) }
    const value = Reflect.get(target, prop)
    return typeof value === 'function' ? value.bind(target) : value
  } })
  return { db, stats }
}

describe('MSP memory erasure: bounded due selection', () => {
  it('reaches only due records: grace, claim window, DEFERRED schedule and FAILED are honoured', async () => {
    const at = new Date(Date.now() + 10 * 86_400_000)
    const old = new Date(at.getTime() - MEMORY_ERASURE_GRACE_MS - 60_000)
    const inGrace = await seed('due-in-grace', new Date(at.getTime() - MEMORY_ERASURE_GRACE_MS + 30_000))
    const fresh = await seed('due-fresh', old)
    const claimed = await seed('due-claimed', old)
    await append(claimed, MEMORY_ERASURE_KINDS.attempt, 'attempt:1', new Date(at.getTime() - MEMORY_ERASURE_CLAIM_MS + 5_000), { attemptNumber: 1, claim: 'c' })
    const stale = await seed('due-stale-claim', old)
    await append(stale, MEMORY_ERASURE_KINDS.attempt, 'attempt:1', new Date(at.getTime() - MEMORY_ERASURE_CLAIM_MS - 5_000), { attemptNumber: 1, claim: 'c' })
    const backoff = await seed('due-backoff', old)
    await append(backoff, MEMORY_ERASURE_KINDS.attempt, 'attempt:1', new Date(at.getTime() - 120_000), { attemptNumber: 1, claim: 'c' })
    await append(backoff, MEMORY_ERASURE_KINDS.deferred, 'deferred:1', new Date(at.getTime() + 30_000), { attemptNumber: 1, code: 'X' })
    const retry = await seed('due-retry', old)
    await append(retry, MEMORY_ERASURE_KINDS.attempt, 'attempt:1', new Date(at.getTime() - 3_600_000), { attemptNumber: 1, claim: 'c' })
    await append(retry, MEMORY_ERASURE_KINDS.deferred, 'deferred:1', new Date(at.getTime() - 3_600_000 + MEMORY_ERASURE_BACKOFF_MS[0]), { attemptNumber: 1, code: 'X' })
    const failed = await seed('due-failed', old)
    await append(failed, MEMORY_ERASURE_KINDS.failed, 'failed', new Date(at.getTime() - 60_000), { attemptNumber: 8, code: 'X' })
    expect([inGrace, fresh, claimed, stale, backoff, retry, failed].every(Boolean)).toBe(true)

    const msp = recordingMsp()
    await reconcileLineMemoryErasures({ db: prisma, threadMemory: msp.port, now: () => at, batchSize: 50 })
    expect(msp.erased.filter(room => room.startsWith('due-')).sort()).toEqual(['due-fresh', 'due-retry', 'due-stale-claim'])
  })

  it('a page of FAILED records larger than the candidate page does not hide an open record behind it', async () => {
    const at = new Date(Date.now() + 20 * 86_400_000)
    const oldest = at.getTime() - 86_400_000
    for (let index = 0; index < MEMORY_ERASURE_SCAN_PAGE + 5; index += 1) {
      const row = await seed(`mass-failed-${index}`, new Date(oldest + index))
      await append(row, MEMORY_ERASURE_KINDS.failed, 'failed', new Date(oldest + 1_000), { attemptNumber: 8, code: 'X' })
    }
    await seed('mass-open', new Date(at.getTime() - MEMORY_ERASURE_GRACE_MS - 1_000))
    const msp = recordingMsp()
    await reconcileLineMemoryErasures({ db: prisma, threadMemory: msp.port, now: () => at, batchSize: 50 })
    expect(msp.erased.filter(room => room.startsWith('mass-'))).toEqual(['mass-open'])
  })

  it('a full page of held records does not end the scan; only a record still in grace does', async () => {
    const at = new Date(Date.now() + 30 * 86_400_000)
    const base = at.getTime() - 86_400_000
    // A page and a half of records claimed moments ago, then one due record.
    for (let index = 0; index < MEMORY_ERASURE_SCAN_PAGE + 50; index += 1) {
      const row = await seed(`held-page-${index}`, new Date(base + index))
      await append(row, MEMORY_ERASURE_KINDS.attempt, 'attempt:1', new Date(at.getTime() - 1_000), { attemptNumber: 1, claim: 'c' })
    }
    await seed('held-page-due', new Date(base + 10_000))
    // Then a page and a half still inside the grace window, and nothing due behind them.
    for (let index = 0; index < MEMORY_ERASURE_SCAN_PAGE + 50; index += 1) {
      await seed(`held-grace-${index}`, new Date(at.getTime() - MEMORY_ERASURE_GRACE_MS + 60_000 + index))
    }
    // Open records anywhere in the database that come before the first one in grace.
    const graceCutoff = new Date(at.getTime() - MEMORY_ERASURE_GRACE_MS)
    const spent = new Set((await prisma.agentTraceEvent.findMany({ where: { kind: MEMORY_ERASURE_KINDS.failed },
      select: { turnId: true } })).map(row => row.turnId))
    const before = (await prisma.agentTraceEvent.findMany({ where: { kind: MEMORY_ERASURE_KINDS.pending,
      payloadJson: { not: '{"redacted":true}' }, occurredAt: { lte: graceCutoff } }, select: { turnId: true } }))
      .filter(row => !spent.has(row.turnId)).length
    const { db, stats } = observed()
    const msp = recordingMsp()
    await reconcileLineMemoryErasures({ db, threadMemory: msp.port, now: () => at, batchSize: 50 })
    expect(msp.erased.filter(room => room.startsWith('held-'))).toEqual(['held-page-due'])
    // The full held page did not stop the scan; the first record in grace did, so the
    // page after it, holding only in-grace records, was never read.
    expect(msp.erased.filter(room => room.startsWith('held-grace'))).toEqual([])
    expect(stats.pages).toBe(Math.floor(before / MEMORY_ERASURE_SCAN_PAGE) + 1)
  })

  // Last in this file: it leaves a thousand held records behind.
  it('keyset paging: a due record behind more held records than one tick reads is reached on the next tick', async () => {
    const at = new Date(Date.now() + 40 * 86_400_000)
    const base = at.getTime() - 2 * 86_400_000
    // The earlier tests' records would be due by now: close them, so what stands
    // before the due record is exactly the held records below.
    const leftovers = await prisma.agentTraceEvent.findMany({ where: { ...scope, kind: MEMORY_ERASURE_KINDS.pending,
      payloadJson: { not: '{"redacted":true}' } }, select: { turnId: true } })
    const spent = new Set((await prisma.agentTraceEvent.findMany({ where: { ...scope, kind: MEMORY_ERASURE_KINDS.failed },
      select: { turnId: true } })).map(row => row.turnId))
    await prisma.agentTraceEvent.createMany({ data: leftovers.filter(({ turnId }) => !spent.has(turnId)).map(({ turnId }) => ({ ...scope, turnId, executionId: null,
      kind: MEMORY_ERASURE_KINDS.failed, idempotencyKey: `${turnId}:failed`, payloadJson: '{"attemptNumber":8,"code":"X"}',
      occurredAt: new Date(base) })) })
    const heldCount = MEMORY_ERASURE_SCAN_PAGE * MEMORY_ERASURE_SCAN_MAX_PAGES + 50
    const pending = []
    const deferred = []
    for (let index = 0; index < heldCount; index += 1) {
      const turnId = randomUUID()
      pending.push({ ...scope, turnId, executionId: null, kind: MEMORY_ERASURE_KINDS.pending, idempotencyKey: `${turnId}:pending`,
        payloadJson: JSON.stringify({ scope: MEMORY_ERASURE_SCOPE, principalId: `keyset-held-${index}-principal`, audiences: ['DIRECT'],
          idempotencyKey: `msp-principal-erasure:${turnId}` }), occurredAt: new Date(base + index) })
      // In backoff for another day: held, not due.
      deferred.push({ ...scope, turnId, executionId: null, kind: MEMORY_ERASURE_KINDS.deferred, idempotencyKey: `${turnId}:deferred:1`,
        payloadJson: JSON.stringify({ attemptNumber: 1, code: 'X' }), occurredAt: new Date(at.getTime() + 86_400_000) })
    }
    await prisma.agentTraceEvent.createMany({ data: pending })
    await prisma.agentTraceEvent.createMany({ data: deferred })
    await seed('keyset-due', new Date(base + heldCount + 1_000))

    const { db, stats } = observed()
    const msp = recordingMsp()
    await reconcileLineMemoryErasures({ db, threadMemory: msp.port, now: () => at, batchSize: 50 })
    expect(msp.erased.filter(room => room.startsWith('keyset-'))).toEqual([])
    expect(stats.pages).toBeLessThanOrEqual(MEMORY_ERASURE_SCAN_MAX_PAGES)
    // The next tick resumes after the last record the first one read, so the due
    // record is reached by the second tick (a third at most if other due records,
    // anywhere in the database, fill a batch first).
    let ticks = 1
    while (!msp.erased.includes('keyset-due') && ticks < 3) {
      const before = stats.pages
      await reconcileLineMemoryErasures({ db, threadMemory: msp.port, now: () => new Date(at.getTime() + ticks * 1_000), batchSize: 50 })
      expect(stats.pages - before).toBeLessThanOrEqual(MEMORY_ERASURE_SCAN_MAX_PAGES)
      ticks += 1
    }
    expect(msp.erased.filter(room => room.startsWith('keyset-'))).toEqual(['keyset-due'])
    expect(msp.erased.filter(room => room.startsWith('keyset-held'))).toEqual([])
    // Every read is bounded: no id or turn list longer than one page, no `notIn`.
    for (const args of stats.reads) {
      expect(JSON.stringify(args?.where ?? {})).not.toContain('notIn')
      for (const list of [args?.where?.id?.in, args?.where?.turnId?.in].filter(Boolean)) {
        expect(list.length).toBeLessThanOrEqual(MEMORY_ERASURE_SCAN_PAGE)
      }
    }
  })
})
