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
  nextStoredStatus,
  parseBotProfile,
  suggestLineOaAccountCode,
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
    expect(LINE_OA_TRANSPORT_MODES).toEqual(['EDGE', 'CLOUD'])
    expect(defaultTransportMode({ hasActiveEdgeCredential: true })).toBe('CLOUD')
    expect(defaultTransportMode({ hasActiveEdgeCredential: false })).toBe('CLOUD')
    expect(defaultTransportMode()).toBe('CLOUD')
  })

  it('accepts a well-formed connect input and rejects the shapes that would widen scope or corrupt identity', () => {
    const ok = zConnectLineOaAccount.parse({
      businessId: 'b-1', integrationConnectionId: 'c-1', code: 'oa-smartgift-main', displayName: 'SmartGift',
      basicId: '@smartgift', transportMode: 'EDGE', botProfile: { greeting: 'สวัสดีค่ะ' },
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
  })

  it('requires a version on every action and a target mode on a switch', () => {
    expect(zLineOaAccountAction.parse({ action: 'PAUSE', version: 1 })).toEqual({ action: 'PAUSE', version: 1 })
    expect(() => zLineOaAccountAction.parse({ action: 'PAUSE' })).toThrow()
    expect(() => zLineOaAccountAction.parse({ action: 'PAUSE', version: 0 })).toThrow()
    expect(() => zLineOaAccountAction.parse({ action: 'SWITCH_TRANSPORT_MODE', version: 1 })).toThrow()
    expect(zLineOaAccountAction.parse({ action: 'SWITCH_TRANSPORT_MODE', version: 1, transportMode: 'CLOUD' }).transportMode).toBe('CLOUD')
    expect(() => zLineOaAccountAction.parse({ action: 'GO_LIVE', version: 1 })).toThrow()
  })

  it('reads a bot profile defensively', () => {
    expect(parseBotProfile('{"greeting":"hi","personaLabel":"Zuri"}')).toEqual({ greeting: 'hi', personaLabel: 'Zuri' })
    expect(parseBotProfile('not json')).toEqual({})
    expect(parseBotProfile('{"apiKey":"leak"}')).toEqual({})
    expect(parseBotProfile(null)).toEqual({})
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
