// @req FR-227, FR-228 — the pure Thai-copy mapping for webhook health and the
//   derived-quiescence refusal, tested without a database or a network call.
// @tested tests/unit/line-oa-webhook-copy.test.js
import { describe, expect, it } from 'vitest'
import {
  LINE_OA_WEBHOOK_REASON_CODES,
  describeLineOaLegacyTransportActive,
  describeLineOaWebhookHealth,
} from '@/modules/line-oa-studio/domain/line-oa-webhook-copy'

describe('describeLineOaWebhookHealth', () => {
  it('reports NOT_REGISTERED for a null/empty state without inventing a LINE reason', () => {
    expect(describeLineOaWebhookHealth(null)).toMatchObject({ code: 'NOT_REGISTERED', showManualCard: false, nextStep: 'REGISTER' })
    expect(describeLineOaWebhookHealth({})).toMatchObject({ code: 'NOT_REGISTERED' })
  })

  it('a successful test carries the HTTP status in its Thai message and no manual card', () => {
    const result = describeLineOaWebhookHealth({ endpoint: 'https://x/webhook', active: true, lastTestReason: 'LINE_OK', lastTestStatusCode: 200 })
    expect(result.code).toBe('LINE_OK')
    expect(result.message).toContain('200')
    expect(result.showManualCard).toBe(false)
  })

  it('every declared reason code maps to a non-empty message with a manual card only where the design table shows one', () => {
    const expectManualCard = {
      LINE_OK: false,
      LINE_WEBHOOK_INACTIVE: true,
      LINE_WEBHOOK_SET_FAILED: true,
      'LINE_WEBHOOK_TEST_FAILED:COULD_NOT_CONNECT': true,
      'LINE_WEBHOOK_TEST_FAILED:ERROR_STATUS_CODE': true,
      'LINE_WEBHOOK_TEST_FAILED:REQUEST_TIMEOUT': true,
      'LINE_WEBHOOK_TEST_FAILED:UNCLASSIFIED': true,
      LINE_WEBHOOK_SIGNATURE_INVALID: false,
      PUBLIC_BASE_URL_NOT_CONFIGURED: false,
    }
    for (const code of LINE_OA_WEBHOOK_REASON_CODES) {
      const result = describeLineOaWebhookHealth({ endpoint: 'https://x/webhook', active: true, lastTestReason: code, lastTestStatusCode: 500 })
      expect(result.message.length, `message for ${code}`).toBeGreaterThan(0)
      expect(result.showManualCard, `showManualCard for ${code}`).toBe(expectManualCard[code])
    }
  })

  it('a manual card carries the attempted endpoint, never a masked or guessed one', () => {
    const result = describeLineOaWebhookHealth({ endpoint: 'https://zuri.example/api/line-oa/accounts/a1/webhook', active: false, lastTestReason: 'LINE_WEBHOOK_SET_FAILED', lastTestStatusCode: null })
    expect(result.manualCardUrl).toBe('https://zuri.example/api/line-oa/accounts/a1/webhook')
  })

  it('a signature mismatch routes to rotation, distinct from an ordinary test failure', () => {
    const signature = describeLineOaWebhookHealth({ lastTestReason: 'LINE_WEBHOOK_SIGNATURE_INVALID', lastTestStatusCode: 401 })
    const timeout = describeLineOaWebhookHealth({ lastTestReason: 'LINE_WEBHOOK_TEST_FAILED:REQUEST_TIMEOUT', lastTestStatusCode: null })
    expect(signature.nextStep).toBe('ROTATE')
    expect(timeout.nextStep).not.toBe('ROTATE')
    expect(signature.message).not.toBe(timeout.message)
  })

  it('an unrecognised reason code falls back rather than throwing', () => {
    const result = describeLineOaWebhookHealth({ lastTestReason: 'SOMETHING_NEW_LINE_ADDED' })
    expect(result.message.length).toBeGreaterThan(0)
  })
})

describe('describeLineOaLegacyTransportActive', () => {
  it('names the last legacy receipt time when known', () => {
    const result = describeLineOaLegacyTransportActive({ lastLegacyReceiptAt: '2026-09-14T12:00:00.000Z' })
    expect(result.code).toBe('LINE_LEGACY_TRANSPORT_ACTIVE')
    expect(result.message).toContain('2026-09-14T12:00:00.000Z')
  })

  it('never fabricates a time it does not have', () => {
    const result = describeLineOaLegacyTransportActive({ lastLegacyReceiptAt: null })
    expect(result.message).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })
})
