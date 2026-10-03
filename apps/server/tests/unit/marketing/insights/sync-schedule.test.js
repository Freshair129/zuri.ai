import { afterEach, describe, expect, it } from 'vitest'
import { nextScheduledSyncTick } from '@/modules/marketing/insights/domain/sync-schedule'

const ORIGINAL_TZ = process.env.TZ

afterEach(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ
  else process.env.TZ = ORIGINAL_TZ
})

describe('sync schedule', () => {
  it('returns today\'s Bangkok tick when the instant is still before 02:00 local', () => {
    const tick = nextScheduledSyncTick('2026-09-24T18:30:00.000Z')
    expect(tick.toISOString()).toBe('2026-09-24T19:00:00.000Z')
  })

  it('rolls over to tomorrow\'s Bangkok tick once 02:00 local has passed', () => {
    const tick = nextScheduledSyncTick('2026-09-24T20:00:00.000Z')
    expect(tick.toISOString()).toBe('2026-09-25T19:00:00.000Z')
  })

  it('treats an instant exactly on the tick as already passed', () => {
    const tick = nextScheduledSyncTick('2026-09-24T19:00:00.000Z')
    expect(tick.toISOString()).toBe('2026-09-25T19:00:00.000Z')
  })

  it('accepts a Date object as well as an ISO string', () => {
    const tick = nextScheduledSyncTick(new Date('2026-09-24T18:30:00.000Z'))
    expect(tick.toISOString()).toBe('2026-09-24T19:00:00.000Z')
  })

  it('does not depend on the container TZ setting', () => {
    process.env.TZ = 'America/New_York'
    const withForeignTz = nextScheduledSyncTick('2026-09-24T18:30:00.000Z').toISOString()
    process.env.TZ = 'UTC'
    const withUtc = nextScheduledSyncTick('2026-09-24T18:30:00.000Z').toISOString()
    expect(withForeignTz).toBe(withUtc)
    expect(withForeignTz).toBe('2026-09-24T19:00:00.000Z')
  })

  it('rejects an invalid instant', () => {
    expect(() => nextScheduledSyncTick('not-a-date')).toThrow()
  })
})
