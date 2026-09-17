// @req FR-248, FR-249 — recordUsageEvent validates kind-shape (a PAGE_VIEW
//   never carries actionName, an ACTION never carries route); rollupUsageEvents
//   moves a stale raw row into a person-free daily aggregate and deletes it;
//   listUsageBreakdown reads total, recent and per-person counts.
// @req NFR-023 — the 90-day boundary.
// @spec ADR-095 D2, D3
// @tested tests/unit/usage-events.test.js
import { describe, expect, it, vi } from 'vitest'
import { recordUsageEvent, rollupUsageEvents, listUsageBreakdown } from '@/modules/platform-control/application/usage-events'

function fakeDb() {
  const events = []
  const rollups = []
  const audits = []
  const people = [
    { id: 'per-1', code: 'PER-1', displayName: 'Ploy' },
    { id: 'per-2', code: 'PER-2', displayName: 'Nok' },
  ]
  let seq = 0
  const controls = { failAt: null, conflictAttempts: 0 }
  const db = {
    usageEvent: {
      create: vi.fn(async ({ data }) => {
        const row = { id: `ue-${++seq}`, occurredAt: new Date(), ...data }
        events.push(row)
        return row
      }),
      findMany: vi.fn(async ({ where }) => events.filter((e) => e.occurredAt < where.occurredAt.lt)),
      deleteMany: vi.fn(async ({ where }) => {
        const ids = new Set(where.id.in)
        let count = 0
        for (let i = events.length - 1; i >= 0; i--) if (ids.has(events[i].id)) {
          events.splice(i, 1)
          count += 1
        }
        if (controls.failAt === 'delete') throw new Error('injected delete failure')
        return { count }
      }),
      groupBy: vi.fn(async ({ by, where }) => {
        const field = by.find((f) => f !== 'personId')
        const groups = new Map()
        for (const e of events) {
          if (e.kind !== where.kind) continue
          const key = by.map((f) => e[f]).join('|')
          const g = groups.get(key) || { [field]: e[field], personId: e.personId, _count: { _all: 0 } }
          g._count._all += 1
          groups.set(key, g)
        }
        return [...groups.values()]
      }),
    },
    usageEventRollup: {
      findUnique: vi.fn(async ({ where }) => rollups.find((r) => r.date.getTime() === where.date_kind_target.date.getTime() && r.kind === where.date_kind_target.kind && r.target === where.date_kind_target.target) || null),
      create: vi.fn(async ({ data }) => {
        const row = { id: `ur-${++seq}`, ...data }
        rollups.push(row)
        return row
      }),
      update: vi.fn(async ({ where, data }) => {
        const row = rollups.find((r) => r.id === where.id)
        Object.assign(row, data)
        return row
      }),
      upsert: vi.fn(async ({ where, create, update }) => {
        if (controls.failAt === 'upsert') throw new Error('injected aggregate failure')
        const key = where.date_kind_target
        const row = rollups.find((r) => r.date.getTime() === key.date.getTime() && r.kind === key.kind && r.target === key.target)
        if (row) {
          row.count += update.count.increment
          return row
        }
        const created = { id: `ur-${++seq}`, ...create }
        rollups.push(created)
        return created
      }),
      groupBy: vi.fn(async ({ where }) => {
        const groups = new Map()
        for (const r of rollups) {
          if (r.kind !== where.kind) continue
          groups.set(r.target, { target: r.target, _sum: { count: (groups.get(r.target)?._sum.count || 0) + r.count } })
        }
        return [...groups.values()]
      }),
    },
    person: { findMany: vi.fn(async ({ where }) => people.filter((p) => where.id.in.includes(p.id))) },
    auditEvent: {
      create: vi.fn(async ({ data }) => {
        if (controls.failAt === 'audit') throw new Error('injected audit failure')
        const row = { id: `audit-${++seq}`, occurredAt: new Date(), ...data }
        audits.push(row)
        return row
      }),
      findFirst: vi.fn(async ({ where }) => audits
        .filter((audit) => audit.entityType === where.entityType && audit.entityId === where.entityId && audit.action === where.action)
        .filter((audit) => audit.occurredAt >= where.occurredAt.gte && audit.occurredAt < where.occurredAt.lt)
        .sort((a, b) => b.occurredAt - a.occurredAt)[0] || null),
    },
  }
  db.$transaction = vi.fn(async (callback) => {
    if (controls.conflictAttempts > 0) {
      controls.conflictAttempts -= 1
      const error = new Error('could not serialize access')
      error.code = 'P2034'
      throw error
    }
    const eventState = events.map((row) => ({ ...row, occurredAt: new Date(row.occurredAt) }))
    const rollupState = rollups.map((row) => ({ ...row, date: new Date(row.date) }))
    const auditState = audits.map((row) => ({ ...row, occurredAt: new Date(row.occurredAt) }))
    try {
      return await callback(db)
    } catch (error) {
      events.splice(0, events.length, ...eventState)
      rollups.splice(0, rollups.length, ...rollupState)
      audits.splice(0, audits.length, ...auditState)
      throw error
    }
  })
  return { db, events, rollups, audits, controls }
}

describe('FR-248, FR-249 recordUsageEvent', () => {
  it('records a page view with route, no actionName', async () => {
    const { db } = fakeDb()
    const event = await recordUsageEvent(db, { kind: 'PAGE_VIEW', route: '/control/roadmap', personId: 'per-1', sessionId: 's-1' })
    expect(event.route).toBe('/control/roadmap')
    expect(event.actionName).toBeNull()
  })

  it('records an action with actionName, no route', async () => {
    const { db } = fakeDb()
    const event = await recordUsageEvent(db, { kind: 'ACTION', actionName: 'platform_control.sign_out', personId: 'per-1' })
    expect(event.actionName).toBe('platform_control.sign_out')
    expect(event.route).toBeNull()
  })

  it('refuses a PAGE_VIEW carrying an actionName, and an ACTION carrying a route', async () => {
    const { db } = fakeDb()
    await expect(recordUsageEvent(db, { kind: 'PAGE_VIEW', route: '/x', actionName: 'sneaky', personId: 'per-1' })).rejects.toThrow(/USAGE_EVENT_ROUTE_CARRIES_NO_ACTION_NAME/)
    await expect(recordUsageEvent(db, { kind: 'ACTION', actionName: 'x', route: '/sneaky', personId: 'per-1' })).rejects.toThrow(/USAGE_EVENT_ACTION_CARRIES_NO_ROUTE/)
  })

  it('refuses an invalid kind, a missing person, a route with no leading slash, and an actionName built from free text', async () => {
    const { db } = fakeDb()
    await expect(recordUsageEvent(db, { kind: 'CLICK', route: '/x', personId: 'per-1' })).rejects.toThrow(/USAGE_EVENT_KIND_INVALID/)
    await expect(recordUsageEvent(db, { kind: 'PAGE_VIEW', route: '/x' })).rejects.toThrow(/USAGE_EVENT_PERSON_REQUIRED/)
    await expect(recordUsageEvent(db, { kind: 'PAGE_VIEW', route: 'no-leading-slash', personId: 'per-1' })).rejects.toThrow(/USAGE_EVENT_ROUTE_INVALID/)
    await expect(recordUsageEvent(db, { kind: 'ACTION', actionName: 'this has spaces and stuff a user typed', personId: 'per-1' })).rejects.toThrow(/USAGE_EVENT_ACTION_NAME_INVALID/)
  })
})

describe('NFR-023 rollupUsageEvents', () => {
  it('moves rows older than 90 days into a person-free daily rollup and deletes them, and audits once', async () => {
    const { db, events, rollups, audits } = fakeDb()
    const old = new Date('2026-06-01T00:00:00.000Z')
    events.push(
      { id: 'ue-old-1', kind: 'PAGE_VIEW', route: '/control/roadmap', actionName: null, personId: 'per-1', occurredAt: old },
      { id: 'ue-old-2', kind: 'PAGE_VIEW', route: '/control/roadmap', actionName: null, personId: 'per-2', occurredAt: old },
      { id: 'ue-exact-cutoff', kind: 'PAGE_VIEW', route: '/control/roadmap', actionName: null, personId: 'per-1', occurredAt: new Date('2026-06-18T00:00:00.000Z') },
      { id: 'ue-recent', kind: 'PAGE_VIEW', route: '/control/roadmap', actionName: null, personId: 'per-1', occurredAt: new Date('2026-09-15T00:00:00.000Z') },
    )
    const result = await rollupUsageEvents(db, { now: new Date('2026-09-16T00:00:00.000Z'), cutoffDays: 90 })
    expect(result.rolledUpCount).toBe(2)
    expect(events.some((e) => e.id === 'ue-old-1')).toBe(false)
    expect(events.some((e) => e.id === 'ue-exact-cutoff')).toBe(true)
    expect(events.some((e) => e.id === 'ue-recent')).toBe(true)
    expect(rollups).toHaveLength(1)
    expect(rollups[0]).toMatchObject({ kind: 'PAGE_VIEW', target: '/control/roadmap', count: 2 })
    expect(rollups[0].date.toISOString()).toBe('2026-06-01T00:00:00.000Z')
    expect(audits).toHaveLength(1)
    expect(audits[0]).toMatchObject({ entityType: 'USAGE_EVENT_ROLLUP', action: 'USAGE_EVENT_ROLLUP_COMPLETED' })
    expect(audits[0].payloadJson).not.toContain('per-1')
    expect(audits[0].payloadJson).not.toContain('per-2')
  })

  it('claims a UTC day inside the transaction and returns the same receipt on replay', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      const { db, audits } = fakeDb()
      const now = new Date('2026-09-16T12:00:00.000Z')
      vi.setSystemTime(now)
      const first = await rollupUsageEvents(db, { now, oncePerDay: true })
      const replayNow = new Date('2026-09-16T23:59:59.000Z')
      vi.setSystemTime(replayNow)
      const replay = await rollupUsageEvents(db, { now: replayNow, oncePerDay: true })
      expect(first.alreadyRanToday).toBe(false)
      expect(replay).toMatchObject({ auditEventId: first.auditEventId, rolledUpCount: 0, groupCount: 0, alreadyRanToday: true })
      expect(audits).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rolls back aggregate and raw deletion when an operation fails, and retries a serialization conflict', async () => {
    const { db, events, rollups, audits, controls } = fakeDb()
    const old = new Date('2026-06-01T00:00:00.000Z')
    events.push({ id: 'ue-failure', kind: 'ACTION', route: null, actionName: 'x', personId: 'per-1', occurredAt: old })
    controls.failAt = 'audit'
    await expect(rollupUsageEvents(db, { now: new Date('2026-09-16T00:00:00.000Z') })).rejects.toThrow(/injected audit failure/)
    expect(events).toHaveLength(1)
    expect(rollups).toHaveLength(0)
    expect(audits).toHaveLength(0)
    controls.failAt = null
    controls.conflictAttempts = 1
    const retried = await rollupUsageEvents(db, { now: new Date('2026-09-16T00:00:00.000Z') })
    expect(retried.rolledUpCount).toBe(1)
    expect(db.$transaction).toHaveBeenCalledTimes(3)
  })

  it('a second run over the same window adds to the existing rollup rather than duplicating it', async () => {
    const { db, rollups } = fakeDb()
    const old = new Date('2026-06-01T00:00:00.000Z')
    await db.usageEvent.create({ data: { kind: 'ACTION', route: null, actionName: 'x', personId: 'per-1', occurredAt: old } })
    await rollupUsageEvents(db, { now: new Date('2026-09-16T00:00:00.000Z'), cutoffDays: 90 })
    await db.usageEvent.create({ data: { kind: 'ACTION', route: null, actionName: 'x', personId: 'per-1', occurredAt: old } })
    await rollupUsageEvents(db, { now: new Date('2026-09-17T00:00:00.000Z'), cutoffDays: 90 })
    expect(rollups).toHaveLength(1)
    expect(rollups[0].count).toBe(2)
  })
})

describe('FR-248, FR-249 listUsageBreakdown', () => {
  it('reports total (recent + rolled up), recent count and a per-person split from recent rows only', async () => {
    const { db, events, rollups } = fakeDb()
    events.push(
      { id: 'ue-1', kind: 'PAGE_VIEW', route: '/control/roadmap', actionName: null, personId: 'per-1', occurredAt: new Date() },
      { id: 'ue-2', kind: 'PAGE_VIEW', route: '/control/roadmap', actionName: null, personId: 'per-1', occurredAt: new Date() },
      { id: 'ue-3', kind: 'PAGE_VIEW', route: '/control/roadmap', actionName: null, personId: 'per-2', occurredAt: new Date() },
    )
    rollups.push({ id: 'ur-1', date: new Date('2026-06-01T00:00:00.000Z'), kind: 'PAGE_VIEW', target: '/control/roadmap', count: 40 })
    const rows = await listUsageBreakdown(db, { kind: 'PAGE_VIEW' })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ target: '/control/roadmap', recentCount: 3, rolledUpCount: 40, totalCount: 43 })
    expect(rows[0].byPerson).toEqual([
      { personId: 'per-1', label: 'Ploy', count: 2 },
      { personId: 'per-2', label: 'Nok', count: 1 },
    ])
  })

  it('rejects an invalid kind', async () => {
    const { db } = fakeDb()
    await expect(listUsageBreakdown(db, { kind: 'NOPE' })).rejects.toThrow(/USAGE_EVENT_KIND_INVALID/)
  })
})
