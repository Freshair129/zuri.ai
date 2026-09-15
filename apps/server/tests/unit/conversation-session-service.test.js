import { describe, expect, it } from 'vitest'
import {
  DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES,
  closedAtFor,
  continuesSession,
  effectiveIdleTimeoutMinutes,
  sessionCode,
} from '@/modules/crm/conversation-session-service'
import { planSittings, sittingIndexAt } from '@/modules/crm/conversation-session-backfill'

// @req FR-243 — the pure session rules: idle continuation, the timeout bounds,
//   the closing moment, the human code, and the backfill's grouping (ADR-094 D2, D3).
// @spec ADR-094, SDD-102
// @tested tests/unit/conversation-session-service.test.js

const at = (minutes) => new Date(Date.UTC(2026, 8, 15, 3, 0) + minutes * 60_000)

describe('effectiveIdleTimeoutMinutes', () => {
  it('defaults to 30 and accepts 10 to 120 inclusive', () => {
    expect(DEFAULT_SESSION_IDLE_TIMEOUT_MINUTES).toBe(30)
    expect(effectiveIdleTimeoutMinutes(undefined)).toBe(30)
    expect(effectiveIdleTimeoutMinutes(10)).toBe(10)
    expect(effectiveIdleTimeoutMinutes(120)).toBe(120)
  })

  it('falls back to 30 for a value outside the range or not a whole number', () => {
    for (const value of [9, 121, 0, -5, 30.5, 'abc', null]) expect(effectiveIdleTimeoutMinutes(value)).toBe(30)
  })
})

describe('continuesSession', () => {
  const session = { lastMessageAt: at(0), idleTimeoutMinutes: 30 }

  it('joins at 29 minutes and exactly at the timeout, and opens past it', () => {
    expect(continuesSession(session, at(29), 30)).toBe(true)
    expect(continuesSession(session, at(30), 30)).toBe(true)
    expect(continuesSession(session, at(31), 30)).toBe(false)
  })

  it('uses the timeout it is given, so a changed account setting applies to the next message', () => {
    expect(continuesSession(session, at(45), 60)).toBe(true)
    expect(continuesSession(session, at(15), 10)).toBe(false)
  })

  it('never continues when there is no session', () => {
    expect(continuesSession(null, at(0), 30)).toBe(false)
  })
})

describe('closedAtFor', () => {
  it('is the last message plus the timeout, not the time it was noticed', () => {
    expect(closedAtFor({ lastMessageAt: at(10), idleTimeoutMinutes: 30 }).toISOString()).toBe(at(40).toISOString())
    expect(closedAtFor({ lastMessageAt: at(10), idleTimeoutMinutes: 30 }, 60).toISOString()).toBe(at(70).toISOString())
  })
})

describe('sessionCode', () => {
  it('uses the Asia/Bangkok date and six base-36 characters', () => {
    const fixed = () => Buffer.from([0, 1, 10, 35, 36, 71])
    // 2026-09-15T20:30Z is already 2026-09-16 in Bangkok.
    expect(sessionCode(new Date('2026-09-15T20:30:00Z'), fixed)).toBe('S-20260916-01AZ0Z')
    expect(sessionCode(new Date('2026-09-15T03:00:00Z'))).toMatch(/^S-20260915-[0-9A-Z]{6}$/)
  })
})

describe('planSittings', () => {
  it('splits on a gap past the timeout and counts each direction', () => {
    const sittings = planSittings({ idleTimeoutMinutes: 30, messages: [
      { id: 'm1', direction: 'INBOUND', createdAt: at(0) },
      { id: 'm2', direction: 'OUTBOUND', createdAt: at(1), externalMessageId: 'reply:m1' },
      { id: 'm3', direction: 'INBOUND', createdAt: at(29) },
      { id: 'm4', direction: 'INBOUND', createdAt: at(61) },
    ] })
    expect(sittings.map((s) => s.messageIds)).toEqual([['m1', 'm2', 'm3'], ['m4']])
    expect(sittings[0]).toMatchObject({ inboundCount: 2, outboundCount: 1 })
    expect(sittings[0].lastMessageAt.toISOString()).toBe(at(29).toISOString())
  })

  it('puts a late reply in the sitting of the message it answers without opening one', () => {
    const sittings = planSittings({ idleTimeoutMinutes: 30, messages: [
      { id: 'm1', direction: 'INBOUND', createdAt: at(0) },
      { id: 'm2', direction: 'INBOUND', createdAt: at(200) },
      { id: 'r1', direction: 'OUTBOUND', createdAt: at(240), externalMessageId: 'reply:m1' },
    ] })
    expect(sittings.map((s) => s.messageIds)).toEqual([['m1', 'r1'], ['m2']])
    expect(sittings[0].lastMessageAt.toISOString()).toBe(at(0).toISOString())
  })

  it('never regroups a message that has a session, and joins an unassigned one just before it to that session', () => {
    const sittings = planSittings({ idleTimeoutMinutes: 30,
      sessions: [{ id: 'live-session', openedAt: at(5), lastMessageAt: at(5) }],
      messages: [
        { id: 'm1', direction: 'INBOUND', createdAt: at(0), sessionId: null },
        // Its createdAt is the server clock, far from the LINE time that decided its session.
        { id: 'm2', direction: 'INBOUND', createdAt: at(500), sessionId: 'live-session' },
      ] })
    expect(sittings).toEqual([expect.objectContaining({ sessionId: 'live-session', messageIds: ['m1'], inboundCount: 1 })])
    expect(sittings[0].openedAt.toISOString()).toBe(at(0).toISOString())
  })

  it('puts a reply to an already-assigned message in that session without stretching it', () => {
    const sittings = planSittings({ idleTimeoutMinutes: 30,
      sessions: [{ id: 's1', openedAt: at(0), lastMessageAt: at(0) }],
      messages: [
        { id: 'm1', direction: 'INBOUND', createdAt: at(0), sessionId: 's1' },
        { id: 'r1', direction: 'OUTBOUND', createdAt: at(300), externalMessageId: 'reply:m1' },
      ] })
    expect(sittings).toEqual([expect.objectContaining({ sessionId: 's1', messageIds: ['r1'], outboundCount: 1 })])
    expect(sittings[0].lastMessageAt.toISOString()).toBe(at(0).toISOString())
  })

  it('places an event in the sitting open when it occurred, or none', () => {
    const sittings = planSittings({ idleTimeoutMinutes: 30, messages: [
      { id: 'm1', direction: 'INBOUND', createdAt: at(0) },
      { id: 'm2', direction: 'INBOUND', createdAt: at(100) },
    ] })
    expect(sittingIndexAt(sittings, at(20), 30)).toBe(0)
    expect(sittingIndexAt(sittings, at(60), 30)).toBe(-1)
    expect(sittingIndexAt(sittings, at(110), 30)).toBe(1)
  })
})
