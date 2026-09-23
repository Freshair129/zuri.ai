import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  LINE_TRANSPORT_HEALTH_CHECKPOINT_KIND,
  runDueLineTransportHealth,
} from '@/modules/line-oa-studio/application/line-transport-health-schedule'

// @req FR-190 — every stateless worker instance may wake the health sweep, but
// only one durable checkpoint lease may run it at a time.
// @spec ADR-105 D1/D3
// @tested tests/unit/line-transport-health-schedule.test.js

const at = new Date('2026-09-23T14:00:00.000Z')
const checkpoint = {
  id: 'checkpoint-1',
  kind: LINE_TRANSPORT_HEALTH_CHECKPOINT_KIND,
  version: 4,
  nextDueAt: new Date(0),
}

function fakeDb({ claimCount = 1, settleCount = 1, releaseCount = 1 } = {}) {
  const updateMany = vi.fn()
  updateMany
    .mockResolvedValueOnce({ count: claimCount })
    .mockResolvedValueOnce({ count: settleCount })
    .mockResolvedValue({ count: releaseCount })
  return {
    lineOaWorkerCheckpoint: {
      upsert: vi.fn().mockResolvedValue(checkpoint),
      findUnique: vi.fn().mockResolvedValue(checkpoint),
      updateMany,
    },
  }
}

describe('durable LINE transport-health scheduling', () => {
  it('claims, runs and completes the due checkpoint', async () => {
    const db = fakeDb()
    const sweep = vi.fn().mockResolvedValue({ scanned: 2, warned: 1 })

    const result = await runDueLineTransportHealth({ db, now: at, workerId: 'worker-a', sweep })

    expect(result).toEqual({ status: 'COMPLETED', ran: true, scanned: 2, warned: 1 })
    expect(sweep).toHaveBeenCalledWith(expect.objectContaining({ db, now: at }))
    expect(db.lineOaWorkerCheckpoint.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ id: checkpoint.id, version: checkpoint.version, nextDueAt: { lte: at } }),
      data: expect.objectContaining({ claimantId: 'worker-a', version: { increment: 1 } }),
    }))
    expect(db.lineOaWorkerCheckpoint.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ claimantId: 'worker-a', version: checkpoint.version + 1 }),
      data: expect.objectContaining({ lastCompletedAt: at, claimantId: null, leaseExpiresAt: null }),
    }))
  })

  it('does not run when another replica owns the live lease', async () => {
    const db = fakeDb({ claimCount: 0 })
    const sweep = vi.fn()

    const result = await runDueLineTransportHealth({ db, now: at, workerId: 'worker-b', sweep })

    expect(result).toEqual({ status: 'NOT_DUE', ran: false })
    expect(sweep).not.toHaveBeenCalled()
    expect(db.lineOaWorkerCheckpoint.updateMany).toHaveBeenCalledTimes(1)
  })

  it('releases the lease and leaves the checkpoint due when the sweep fails', async () => {
    const db = fakeDb()
    const sweep = vi.fn().mockRejectedValue(new Error('PROBE_FAILED'))

    await expect(runDueLineTransportHealth({ db, now: at, workerId: 'worker-c', sweep }))
      .rejects.toThrow('PROBE_FAILED')

    expect(db.lineOaWorkerCheckpoint.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: expect.objectContaining({ claimantId: 'worker-c', version: checkpoint.version + 1 }),
      data: { claimantId: null, leaseExpiresAt: null, version: { increment: 1 } },
    }))
  })

  it('grants the production runtime role access behind forced RLS', () => {
    const migration = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260923030000_line_oa_worker_checkpoint.sql'), 'utf8')
    expect(migration).toMatch(/ALTER TABLE public\."LineOaWorkerCheckpoint" FORCE ROW LEVEL SECURITY/)
    expect(migration).toMatch(/CREATE POLICY zuri_app_runtime_all[\s\S]*TO zuri_app_runtime, zuri_web_login/)
    expect(migration).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE[\s\S]*TO zuri_app_runtime, zuri_web_login/)
  })
})
