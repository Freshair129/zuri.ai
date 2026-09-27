import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { appendTraceEvent } from '@/modules/agent/execution-trace'
import { MEMORY_ERASURE_BACKOFF_MS, MEMORY_ERASURE_CLAIM_MS, MEMORY_ERASURE_GRACE_MS, MEMORY_ERASURE_KINDS,
  MEMORY_ERASURE_SCAN_PAGE, reconcileLineMemoryErasures, recordMemoryThreadErasures } from '@/modules/line-oa-studio/application/line-memory-erasure'

// @req FR-022 — the group-memory erasure scanner picks due records with bounded
//   queries: an anti-join drops FAILED records (kept forever for manual erasure) from
//   the candidate page, and grace, the claim window and DEFERRED scheduling are
//   checked only for the page's turns. The same file runs on SQLite (default config)
//   and on PostgreSQL (vitest.postgres.config.js), because the anti-join is raw SQL.
// @spec ADR-106, SEC-005
// @tested this file

const scope = { tenantId: randomUUID(), businessId: randomUUID() }
const channelAccountId = 'due-query-oa'

async function seed(room, occurredAt) {
  const sourceUserId = `${room}-speaker`
  await recordMemoryThreadErasures(prisma, { tenantId: scope.tenantId, principalId: `${room}-principal`,
    jobs: [{ memorySyncOptIn: true, audienceKind: 'GROUP', channelAccountId, businessId: scope.businessId, sourceUserId, recipientId: room }],
    speakers: [{ channelAccountId, providerSubject: sourceUserId }], now: occurredAt })
  const [row] = (await prisma.agentTraceEvent.findMany({ where: { ...scope, kind: MEMORY_ERASURE_KINDS.pending } }))
    .filter(item => item.payloadJson.includes(`"${room}"`))
  return row
}

const append = (row, kind, key, occurredAt, payload = {}) => appendTraceEvent(prisma, { scope, turnId: row.turnId, executionId: null,
  kind, idempotencyKey: `${row.turnId}:${key}`, payload, occurredAt })

function recordingMsp() {
  const erased = []
  return { erased, port: {
    resolveThread: async input => ({ thread: { threadId: `thread:${input.externalRoomRef}` } }),
    erasePrincipal: async input => { erased.push(input.threadId.slice('thread:'.length)); return { erased: true } },
  } }
}

describe('group-memory erasure: bounded due selection', () => {
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
})
