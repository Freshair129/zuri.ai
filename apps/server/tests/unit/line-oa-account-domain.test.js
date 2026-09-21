// @req FR-146 — the pure rules of the LineOaAccount aggregate, proven without
//   a database: input contracts, the stored status machine, the derived LIVE
//   status and the transport-mode default.
// @spec ADR-060 D2, D3, D5
// @tested tests/unit/line-oa-account-domain.test.js
import { describe, expect, it } from 'vitest'
import {
  STORED_STATUS_TRANSITIONS,
  defaultTransportMode,
  deriveEffectiveStatus,
  initialStoredStatus,
  isAccountWithinBusinessHours,
  nextStoredStatus,
  parseBotProfile,
  suggestLineOaAccountCode,
  timeOfDayInBangkok,
  zConnectLineOaAccount,
  zLineOaAccountAction,
  zLineOaAccountCode,
} from '@/modules/line-oa-studio/domain/line-oa-account'
import { LINE_OA_ACCOUNT_STATUSES, LINE_OA_TRANSPORT_MODES } from '@/lib/validation/enums'

describe('FR-146 LineOaAccount domain rules', () => {
  it('LIVE is derived, never a stored status', () => {
    expect(LINE_OA_ACCOUNT_STATUSES).not.toContain('LIVE')
    expect(deriveEffectiveStatus('CONNECTED', 'ACTIVE')).toBe('LIVE')
    // Any other binding state — pending, inactive, rotated or unknown — leaves
    // the stored status as the truth.
    for (const binding of ['PENDING', 'INACTIVE', 'ROTATED', null, undefined]) {
      expect(deriveEffectiveStatus('CONNECTED', binding)).toBe('CONNECTED')
    }
    // A paused or draft account is never LIVE even with an ACTIVE binding.
    expect(deriveEffectiveStatus('PAUSED', 'ACTIVE')).toBe('PAUSED')
    expect(deriveEffectiveStatus('DRAFT', 'ACTIVE')).toBe('DRAFT')
  })

  it('starts DRAFT without a binding code and CONNECTED with one', () => {
    expect(initialStoredStatus({})).toBe('DRAFT')
    expect(initialStoredStatus({ bindingCode: 'smartgift-main' })).toBe('CONNECTED')
  })

  it('defines exactly the stored transitions ADR-060 names, and refuses the rest', () => {
    expect(Object.keys(STORED_STATUS_TRANSITIONS).sort()).toEqual(['ARCHIVE', 'PAUSE', 'RESUME'])
    expect(nextStoredStatus('CONNECTED', 'PAUSE')).toBe('PAUSED')
    expect(nextStoredStatus('PAUSED', 'RESUME')).toBe('CONNECTED')
    for (const from of ['DRAFT', 'CONNECTED', 'PAUSED']) expect(nextStoredStatus(from, 'ARCHIVE')).toBe('ARCHIVED')
    // Archived is terminal; a draft cannot be paused; unknown actions and
    // statuses yield null so the service answers 409, never a guess.
    expect(nextStoredStatus('ARCHIVED', 'RESUME')).toBeNull()
    expect(nextStoredStatus('ARCHIVED', 'ARCHIVE')).toBeNull()
    expect(nextStoredStatus('DRAFT', 'PAUSE')).toBeNull()
    expect(nextStoredStatus('CONNECTED', 'RESUME')).toBeNull()
    expect(nextStoredStatus('CONNECTED', 'SET_DEFAULT')).toBeNull()
    expect(nextStoredStatus('LIVE', 'PAUSE')).toBeNull()
  })

  it('defaults LINE transport to CLOUD independently of Edge credentials (ADR-061)', () => {
    // @req FR-265 — EDGE left the vocabulary (ADR-100 D1); CLOUD is the only
    // transport owner, and the default that already was CLOUD is now also the
    // only value the schema will take.
    expect(LINE_OA_TRANSPORT_MODES).toEqual(['CLOUD'])
    expect(defaultTransportMode({ hasActiveEdgeCredential: true })).toBe('CLOUD')
    expect(defaultTransportMode({ hasActiveEdgeCredential: false })).toBe('CLOUD')
    expect(defaultTransportMode()).toBe('CLOUD')
  })

  it('accepts a well-formed connect input and rejects the shapes that would widen scope or corrupt identity', () => {
    const ok = zConnectLineOaAccount.parse({
      businessId: 'b-1', integrationConnectionId: 'c-1', code: 'oa-smartgift-main', displayName: 'SmartGift',
      basicId: '@smartgift', transportMode: 'CLOUD', botProfile: { greeting: 'สวัสดีค่ะ' },
    })
    expect(ok.code).toBe('oa-smartgift-main')
    // Unknown properties are refused (strict), so tenantId or status can never
    // ride in on the payload.
    expect(() => zConnectLineOaAccount.parse({ businessId: 'b', integrationConnectionId: 'c', code: 'oa-x', displayName: 'X', tenantId: 't' })).toThrow()
    expect(() => zConnectLineOaAccount.parse({ businessId: 'b', integrationConnectionId: 'c', code: 'oa-x', displayName: 'X', status: 'LIVE' })).toThrow()
    // Codes are human, bounded and kebab; a LINE id shape is not a code.
    for (const code of ['OA X', 'U4af4980629', '-oa', 'oa--x', 'ab']) {
      expect(() => zConnectLineOaAccount.parse({ businessId: 'b', integrationConnectionId: 'c', code, displayName: 'X' })).toThrow()
    }
    expect(() => zConnectLineOaAccount.parse({ businessId: 'b', integrationConnectionId: 'c', code: 'oa-x', displayName: 'X', basicId: 'smartgift' })).toThrow()
    expect(() => zConnectLineOaAccount.parse({ businessId: 'b', integrationConnectionId: 'c', code: 'oa-x', displayName: 'X', transportMode: 'HYBRID' })).toThrow()
    // @req FR-265 — and EDGE is now refused by the same enum that refuses HYBRID.
    expect(() => zConnectLineOaAccount.parse({ businessId: 'b', integrationConnectionId: 'c', code: 'oa-x', displayName: 'X', transportMode: 'EDGE' })).toThrow()
  })

  // @req FR-265 — the "target mode on a switch" half of this case is retired with
  // `SWITCH_TRANSPORT_MODE` (ADR-100 D1). Its place is taken by the one field
  // `CONFIGURE_EXECUTION` still requires, and by proving the withdrawn action is
  // refused by the enum rather than merely unhandled by the writer.
  it('requires a version on every action, a delivery choice on CONFIGURE_EXECUTION, and refuses withdrawn actions', () => {
    expect(zLineOaAccountAction.parse({ action: 'PAUSE', version: 1 })).toEqual({ action: 'PAUSE', version: 1 })
    expect(() => zLineOaAccountAction.parse({ action: 'PAUSE' })).toThrow()
    expect(() => zLineOaAccountAction.parse({ action: 'PAUSE', version: 0 })).toThrow()
    expect(() => zLineOaAccountAction.parse({ action: 'CONFIGURE_EXECUTION', version: 1 })).toThrow()
    expect(zLineOaAccountAction.parse({ action: 'CONFIGURE_EXECUTION', version: 1, allowDelayedPush: true }).allowDelayedPush).toBe(true)
    // Absent and false must not mean the same thing for a delivery policy.
    expect(zLineOaAccountAction.parse({ action: 'CONFIGURE_EXECUTION', version: 1, allowDelayedPush: false }).allowDelayedPush).toBe(false)
    expect(() => zLineOaAccountAction.parse({ action: 'SWITCH_TRANSPORT_MODE', version: 1, transportMode: 'CLOUD' })).toThrow()
    // The retired execution/model-access fields are refused outright by .strict().
    expect(() => zLineOaAccountAction.parse({ action: 'CONFIGURE_EXECUTION', version: 1, allowDelayedPush: true, executionMode: 'EDGE' })).toThrow()
    expect(() => zLineOaAccountAction.parse({ action: 'CONFIGURE_EXECUTION', version: 1, allowDelayedPush: true, modelAccess: 'LOCAL_ONLY' })).toThrow()
    expect(() => zLineOaAccountAction.parse({ action: 'GO_LIVE', version: 1 })).toThrow()
  })

  it('reads a bot profile defensively', () => {
    expect(parseBotProfile('{"greeting":"hi","personaLabel":"Zuri"}')).toEqual({ greeting: 'hi', personaLabel: 'Zuri' })
    expect(parseBotProfile('not json')).toEqual({})
    expect(parseBotProfile('{"apiKey":"leak"}')).toEqual({})
    expect(parseBotProfile(null)).toEqual({})
  })
})

// @req FR-244 — business hours and the out-of-hours reply (ADR-094 D6 option A).
describe('FR-244 business hours', () => {
  it('accepts CONFIGURE_BUSINESS_HOURS only with all three fields, or clearBusinessHours alone', () => {
    const declared = zLineOaAccountAction.parse({
      action: 'CONFIGURE_BUSINESS_HOURS', version: 1,
      businessHoursOpen: '09:00', businessHoursClose: '18:00', outOfHoursReplyText: 'ปิดทำการแล้วค่ะ',
    })
    expect(declared.businessHoursOpen).toBe('09:00')
    const cleared = zLineOaAccountAction.parse({ action: 'CONFIGURE_BUSINESS_HOURS', version: 1, clearBusinessHours: true })
    expect(cleared.clearBusinessHours).toBe(true)
    // Partial declarations are refused, never defaulted or clamped.
    expect(() => zLineOaAccountAction.parse({ action: 'CONFIGURE_BUSINESS_HOURS', version: 1, businessHoursOpen: '09:00' })).toThrow()
    expect(() => zLineOaAccountAction.parse({ action: 'CONFIGURE_BUSINESS_HOURS', version: 1 })).toThrow()
    // Clearing and declaring at once is refused, not merged.
    expect(() => zLineOaAccountAction.parse({
      action: 'CONFIGURE_BUSINESS_HOURS', version: 1, clearBusinessHours: true,
      businessHoursOpen: '09:00', businessHoursClose: '18:00', outOfHoursReplyText: 'x',
    })).toThrow()
    // An inverted or zero-length window is refused, not swapped.
    expect(() => zLineOaAccountAction.parse({
      action: 'CONFIGURE_BUSINESS_HOURS', version: 1,
      businessHoursOpen: '18:00', businessHoursClose: '09:00', outOfHoursReplyText: 'x',
    })).toThrow()
    expect(() => zLineOaAccountAction.parse({
      action: 'CONFIGURE_BUSINESS_HOURS', version: 1,
      businessHoursOpen: '09:00', businessHoursClose: '09:00', outOfHoursReplyText: 'x',
    })).toThrow()
    // Not "HH:MM" is refused.
    for (const bad of ['9:00', '25:00', '09:60', 'nine am', '']) {
      expect(() => zLineOaAccountAction.parse({
        action: 'CONFIGURE_BUSINESS_HOURS', version: 1,
        businessHoursOpen: bad, businessHoursClose: '18:00', outOfHoursReplyText: 'x',
      })).toThrow()
    }
  })

  it('timeOfDayInBangkok reads UTC+7 with no DST', () => {
    // 2026-09-16T02:30:00Z is 09:30 in Bangkok.
    expect(timeOfDayInBangkok(new Date('2026-09-16T02:30:00Z'))).toBe('09:30')
    // Crossing midnight UTC still lands on the correct Bangkok clock face.
    expect(timeOfDayInBangkok(new Date('2026-09-16T17:00:00Z'))).toBe('00:00')
  })

  it('isAccountWithinBusinessHours is always true with no declared hours (today\'s behaviour)', () => {
    expect(isAccountWithinBusinessHours({}, new Date('2026-09-16T20:00:00Z'))).toBe(true)
    expect(isAccountWithinBusinessHours({ businessHoursOpen: '09:00' }, new Date('2026-09-16T20:00:00Z'))).toBe(true)
  })

  it('isAccountWithinBusinessHours is inclusive at both ends of a same-day window', () => {
    const account = { businessHoursOpen: '09:00', businessHoursClose: '18:00' }
    // 09:00 Bangkok = 02:00Z; 18:00 Bangkok = 11:00Z.
    expect(isAccountWithinBusinessHours(account, new Date('2026-09-16T02:00:00Z'))).toBe(true)
    expect(isAccountWithinBusinessHours(account, new Date('2026-09-16T11:00:00Z'))).toBe(true)
    expect(isAccountWithinBusinessHours(account, new Date('2026-09-16T06:00:00Z'))).toBe(true)
    // 01:59Z = 08:59 Bangkok, one minute before opening; 11:01Z = 18:01, one after closing.
    expect(isAccountWithinBusinessHours(account, new Date('2026-09-16T01:59:00Z'))).toBe(false)
    expect(isAccountWithinBusinessHours(account, new Date('2026-09-16T11:01:00Z'))).toBe(false)
  })
})

// @req FR-225 — the self-serve wizard's auto-generated account code, always a
//   valid zLineOaAccountCode so the caller never has to special-case its output.
describe('FR-225 suggestLineOaAccountCode', () => {
  it('slugs a Basic ID, stripping the leading @', () => {
    const code = suggestLineOaAccountCode({ basicId: '@SmartGift.Thailand' })
    expect(code).toBe('smartgift-thailand')
    expect(() => zLineOaAccountCode.parse(code)).not.toThrow()
  })

  it('falls back to the display name when there is no Basic ID', () => {
    const code = suggestLineOaAccountCode({ displayName: 'Smart Gift Thailand' })
    expect(code).toBe('smart-gift-thailand')
  })

  it('never produces a code shorter than the schema allows', () => {
    const code = suggestLineOaAccountCode({ basicId: '@ok' })
    expect(code.length).toBeGreaterThanOrEqual(3)
    expect(() => zLineOaAccountCode.parse(code)).not.toThrow()
  })

  it('falls back to a fixed label when there is nothing to slug', () => {
    expect(suggestLineOaAccountCode({})).toBe('line-oa')
    expect(suggestLineOaAccountCode({ basicId: '@***' })).toBe('line-oa-account')
    expect(zLineOaAccountCode.parse(suggestLineOaAccountCode({ basicId: '@***' }))).toMatch(/^line-oa-/)
  })

  it('never exceeds the 64-character schema bound', () => {
    const code = suggestLineOaAccountCode({ basicId: `@${'a'.repeat(120)}` })
    expect(code.length).toBeLessThanOrEqual(64)
    expect(() => zLineOaAccountCode.parse(code)).not.toThrow()
  })
})
