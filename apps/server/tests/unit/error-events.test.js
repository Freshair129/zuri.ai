// @req FR-247 — recordErrorEvent upserts one row per fingerprint; listErrorEvents
//   reads active rows first; resolveErrorEvent stops one counting as active.
// @spec ADR-095 D1
// @tested tests/unit/error-events.test.js
import { describe, expect, it, vi } from 'vitest'
import { recordErrorEvent, listErrorEvents, resolveErrorEvent } from '@/modules/platform-control/application/error-events'
import { createLogger } from '@/lib/observability/logger'

function fakeDb() {
  const rows = []
  let seq = 0
  const db = {
    errorEvent: {
      findUnique: vi.fn(async ({ where }) => rows.find((r) => r.fingerprint === where.fingerprint) || null),
      create: vi.fn(async ({ data }) => {
        const row = { id: `row-${++seq}`, occurrenceCount: 1, firstSeenAt: new Date(), lastSeenAt: new Date(), resolvedAt: null, resolvedByPersonId: null, correlationId: null, route: null, ...data }
        rows.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }) => {
        const row = where.fingerprint ? rows.find((r) => r.fingerprint === where.fingerprint) : rows.find((r) => r.id === where.id)
        Object.assign(row, data)
        return row
      }),
      findMany: vi.fn(async ({ where }) => {
        const filtered = where === undefined ? rows : rows.filter((r) => (where.resolvedAt === null ? r.resolvedAt === null : true))
        return [...filtered].sort((a, b) => (a.resolvedAt ? 1 : 0) - (b.resolvedAt ? 1 : 0) || b.lastSeenAt - a.lastSeenAt)
      }),
    },
  }
  return { db, rows }
}

const capture = () => createLogger({ sink: () => {}, clock: () => new Date('2026-09-16T00:00:00.000Z') })

function thrownError(name, message) {
  try {
    const err = new Error(message)
    err.name = name
    throw err
  } catch (err) {
    return err
  }
}

describe('FR-247 recordErrorEvent', () => {
  it('inserts one row for a new fingerprint', async () => {
    const { db } = fakeDb()
    const logger = capture()
    const parsed = logger.exception('e', thrownError('Error', 'QUEUE_UNAVAILABLE'))
    const event = await recordErrorEvent(db, parsed, { correlationId: 'corr-1', route: '/api/x' })
    expect(event.occurrenceCount).toBe(1)
    expect(event.name).toBe('Error')
    expect(event.message).toBe('QUEUE_UNAVAILABLE')
    expect(event.correlationId).toBe('corr-1')
    expect(event.resolvedAt).toBeNull()
  })

  it('a repeat of the same fingerprint increments occurrenceCount and lastSeenAt, leaving firstSeenAt untouched', async () => {
    const { db } = fakeDb()
    const logger = capture()
    const first = await recordErrorEvent(db, logger.exception('e', thrownError('Error', 'QUEUE_UNAVAILABLE')))
    const second = await recordErrorEvent(db, logger.exception('e', thrownError('Error', 'QUEUE_UNAVAILABLE')))
    expect(second.occurrenceCount).toBe(2)
    expect(second.firstSeenAt).toBe(first.firstSeenAt)
    expect(second.id).toBe(first.id)
  })

  it('a different message or a different first frame is a different fingerprint, a different row', async () => {
    const { db, rows } = fakeDb()
    const logger = capture()
    await recordErrorEvent(db, logger.exception('e', thrownError('Error', 'QUEUE_UNAVAILABLE')))
    await recordErrorEvent(db, logger.exception('e', thrownError('Error', 'CONNECTION_RESET')))
    expect(rows).toHaveLength(2)
  })
})

describe('FR-247 listErrorEvents and resolveErrorEvent', () => {
  it('lists active rows before resolved ones, newest active first', async () => {
    const { db } = fakeDb()
    const logger = capture()
    const a = await recordErrorEvent(db, logger.exception('e', thrownError('Error', 'A')))
    await new Promise((r) => setTimeout(r, 2))
    await recordErrorEvent(db, logger.exception('e', thrownError('Error', 'B')))
    await resolveErrorEvent(db, a.id, 'per-1')
    const list = await listErrorEvents(db)
    expect(list.map((e) => e.message)).toEqual(['B'])
  })

  it('resolving sets resolvedAt and resolvedByPersonId, and it stops counting as active', async () => {
    const { db } = fakeDb()
    const logger = capture()
    const created = await recordErrorEvent(db, logger.exception('e', thrownError('Error', 'A')))
    const resolved = await resolveErrorEvent(db, created.id, 'per-9')
    expect(resolved.resolvedAt).not.toBeNull()
    expect(resolved.resolvedByPersonId).toBe('per-9')
    const activeOnly = await listErrorEvents(db)
    expect(activeOnly).toHaveLength(0)
    const withResolved = await listErrorEvents(db, { includeResolved: true })
    expect(withResolved).toHaveLength(1)
  })
})
