import { describe, expect, it } from 'vitest'
import {
  buildSyncFailureAlertText, retryKeyForFailure, ReportNotificationError, SAFE_ALERT_REASON_CODES, ALERT_TEXT_MAX_LENGTH,
} from '@/modules/marketing/insights/domain/report-notification'

const base = {
  brandDisplayName: 'FX INFRESH Page A',
  brandSlug: 'infresh',
  reasonCode: 'TRANSIENT_ERROR',
  syncRunId: 'fx-sync-1',
  window: { from: '2026-09-01', to: '2026-09-28' },
}

describe('sync failure alert text', () => {
  it('carries brand, safe code, syncRunId and window, and nothing longer than the LINE limit', () => {
    const text = buildSyncFailureAlertText(base)
    expect(text).toContain('FX INFRESH Page A')
    expect(text).toContain('TRANSIENT_ERROR')
    expect(text).toContain('fx-sync-1')
    expect(text).toContain('2026-09-01')
    expect(text).toContain('2026-09-28')
    expect(text.length).toBeLessThanOrEqual(ALERT_TEXT_MAX_LENGTH)
  })

  it('falls back to the brand slug when no display name is given', () => {
    const text = buildSyncFailureAlertText({ ...base, brandDisplayName: undefined })
    expect(text).toContain('infresh')
  })

  it('refuses a reason code that is not on the safe allow-list', () => {
    for (const bogus of ['Graph API returned 400: invalid_token for account 123', 'raw provider prose', null, undefined, '']) {
      expect(() => buildSyncFailureAlertText({ ...base, reasonCode: bogus })).toThrow(ReportNotificationError)
    }
    expect(SAFE_ALERT_REASON_CODES).toContain(base.reasonCode)
  })

  it('requires a brand, a syncRunId and a complete window', () => {
    expect(() => buildSyncFailureAlertText({ ...base, brandDisplayName: undefined, brandSlug: undefined })).toThrow(ReportNotificationError)
    expect(() => buildSyncFailureAlertText({ ...base, syncRunId: undefined })).toThrow(ReportNotificationError)
    expect(() => buildSyncFailureAlertText({ ...base, window: { from: '2026-09-01' } })).toThrow(ReportNotificationError)
    expect(() => buildSyncFailureAlertText({ ...base, window: undefined })).toThrow(ReportNotificationError)
  })

  it('strips control characters from a hostile brand name instead of letting it inject extra lines', () => {
    const text = buildSyncFailureAlertText({ ...base, brandDisplayName: 'FX Evil\nรหัส: FORGED_OK\nรอบซิงค์: forged' })
    const lines = text.split('\n')
    // The attacker's embedded newlines are flattened into the brand line's
    // own text, so the real reason/run lines below it are still the only
    // ones a line-oriented reader (or grep) would recognise as such.
    expect(lines).toHaveLength(4)
    expect(lines[0]).toContain('FORGED_OK')
    expect(lines[1]).toBe('รหัส: TRANSIENT_ERROR')
    expect(lines[2]).toBe('รอบซิงค์: fx-sync-1')
  })
})

describe('retry key for a failure intent', () => {
  it('is deterministic for the same syncRunId + failureKey', () => {
    const a = retryKeyForFailure({ syncRunId: 'fx-sync-1', failureKey: 'TRANSIENT_ERROR' })
    const b = retryKeyForFailure({ syncRunId: 'fx-sync-1', failureKey: 'TRANSIENT_ERROR' })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  })

  it('differs when the syncRunId or the failureKey differs', () => {
    const a = retryKeyForFailure({ syncRunId: 'fx-sync-1', failureKey: 'TRANSIENT_ERROR' })
    const b = retryKeyForFailure({ syncRunId: 'fx-sync-2', failureKey: 'TRANSIENT_ERROR' })
    const c = retryKeyForFailure({ syncRunId: 'fx-sync-1', failureKey: 'AUTH_ERROR' })
    expect(a).not.toBe(b)
    expect(a).not.toBe(c)
  })

  it('requires both a syncRunId and a failureKey', () => {
    expect(() => retryKeyForFailure({ failureKey: 'x' })).toThrow(ReportNotificationError)
    expect(() => retryKeyForFailure({ syncRunId: 'fx-sync-1' })).toThrow(ReportNotificationError)
  })
})
