// @req FR-244 — the aggregate residency directive: identity-free, one boolean,
//   derived from every server-enabled account's declared business hours.
// @spec ADR-094 D6 option A; ADR-061
// @tested tests/unit/model-residency-service.test.js
import { describe, expect, it } from 'vitest'
import { computeShouldBeWarm } from '@/modules/line-oa-studio/application/model-residency-service'

// Bangkok is UTC+7 with no DST: noon(1200) = 05:00Z, 20:00 = 13:00Z, 19:00 = 12:00Z.
const noon = new Date('2026-09-16T05:00:00Z')
const eightPm = new Date('2026-09-16T13:00:00Z')
const sevenPm = new Date('2026-09-16T12:00:00Z')
const open9to18 = { businessHoursOpen: '09:00', businessHoursClose: '18:00' }
const noHours = {}

describe('FR-244 computeShouldBeWarm', () => {
  it('sheds the model with no accounts at all', () => {
    expect(computeShouldBeWarm([], noon)).toBe(false)
  })

  it('stays warm forever if even one account declared no hours', () => {
    expect(computeShouldBeWarm([open9to18, noHours], eightPm)).toBe(true)
  })

  it('stays warm while any declared-hours account is open', () => {
    const closed = { businessHoursOpen: '09:00', businessHoursClose: '10:00' }
    expect(computeShouldBeWarm([closed, open9to18], noon)).toBe(true)
  })

  it('sheds only when every declared-hours account is closed', () => {
    expect(computeShouldBeWarm([open9to18], eightPm)).toBe(false)
    expect(computeShouldBeWarm([open9to18, { businessHoursOpen: '20:00', businessHoursClose: '22:00' }], sevenPm)).toBe(false)
  })
})
