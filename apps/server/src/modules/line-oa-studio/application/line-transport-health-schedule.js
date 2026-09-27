import { randomUUID } from 'node:crypto'
import prisma from '@/lib/db'
import { sweepLineTransportHealth } from './line-transport-health'

// @req FR-190 — the transport-health sweep is advisory, but its cadence must
// not depend on the memory of one API process.
// @spec ADR-105 D1/D3
// @tested tests/unit/line-transport-health-schedule.test.js

export const LINE_TRANSPORT_HEALTH_CHECKPOINT_KIND = 'TRANSPORT_HEALTH'
export const LINE_TRANSPORT_HEALTH_INTERVAL_MS = 60 * 60 * 1000
export const LINE_TRANSPORT_HEALTH_LEASE_MS = 10 * 60 * 1000

const checkpoint = {
  id: true,
  kind: true,
  version: true,
  nextDueAt: true,
}

async function ensureCheckpoint(db) {
  try {
    return await db.lineOaWorkerCheckpoint.upsert({
      where: { kind: LINE_TRANSPORT_HEALTH_CHECKPOINT_KIND },
      create: {
        id: randomUUID(),
        kind: LINE_TRANSPORT_HEALTH_CHECKPOINT_KIND,
        nextDueAt: new Date(0),
      },
      update: {},
      select: checkpoint,
    })
  } catch (error) {
    // Two stateless replicas can initialise the one row at the same time. The
    // unique kind is the durable winner; the loser simply reads it back.
    if (error?.code !== 'P2002') throw error
    return db.lineOaWorkerCheckpoint.findUnique({
      where: { kind: LINE_TRANSPORT_HEALTH_CHECKPOINT_KIND },
      select: checkpoint,
    })
  }
}

/**
 * Run the advisory health sweep only when the durable checkpoint is due.
 * Every process may call this function; only one live lease can run the sweep.
 */
export async function runDueLineTransportHealth({
  db = prisma,
  env = process.env,
  now = new Date(),
  workerId = `line-health:${randomUUID()}`,
  intervalMs = LINE_TRANSPORT_HEALTH_INTERVAL_MS,
  leaseMs = LINE_TRANSPORT_HEALTH_LEASE_MS,
  sweep = sweepLineTransportHealth,
  sweepOptions = {},
} = {}) {
  const at = now instanceof Date ? now : new Date(now)
  const current = await ensureCheckpoint(db)
  if (!current) return { status: 'UNAVAILABLE', ran: false }

  const claimed = await db.lineOaWorkerCheckpoint.updateMany({
    where: {
      id: current.id,
      kind: current.kind,
      version: current.version,
      nextDueAt: { lte: at },
      OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: at } }],
    },
    data: {
      claimantId: workerId,
      leaseExpiresAt: new Date(at.getTime() + leaseMs),
      version: { increment: 1 },
    },
  })
  if (!claimed.count) return { status: 'NOT_DUE', ran: false }

  try {
    const result = await sweep({ db, env, now: at, ...sweepOptions })
    const completed = await db.lineOaWorkerCheckpoint.updateMany({
      where: {
        id: current.id,
        kind: current.kind,
        claimantId: workerId,
        version: current.version + 1,
      },
      data: {
        lastCompletedAt: at,
        nextDueAt: new Date(at.getTime() + intervalMs),
        claimantId: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    })
    return completed.count
      ? { status: 'COMPLETED', ran: true, ...result }
      : { status: 'FENCED', ran: false }
  } catch (error) {
    // Keep the row due so another stateless worker can retry after this process
    // fails. Releasing the lease here also makes a normal provider failure
    // recover on the next tick instead of waiting ten minutes.
    await db.lineOaWorkerCheckpoint.updateMany({
      where: {
        id: current.id,
        kind: current.kind,
        claimantId: workerId,
        version: current.version + 1,
      },
      data: { claimantId: null, leaseExpiresAt: null, version: { increment: 1 } },
    }).catch(() => {})
    throw error
  }
}
