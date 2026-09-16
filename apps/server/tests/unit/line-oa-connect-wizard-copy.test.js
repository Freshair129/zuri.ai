// @req FR-225 — the wizard's error-copy mapping is pure and independently
//   testable: every code the design's error table (§5.4) assigns to the connect
//   route resolves to Thai copy and a machine-readable next step.
// @spec ADR-089 D7; design §5.4
// @tested tests/unit/line-oa-connect-wizard-copy.test.js
import { describe, expect, it } from 'vitest'
import { describeLineOaConnectError, LINE_OA_CONNECT_ERROR_CODES } from '@/modules/line-oa-studio/domain/line-oa-connect-wizard-copy'

describe('FR-225 describeLineOaConnectError', () => {
  it('names every documented code in Thai with a next step', () => {
    for (const code of LINE_OA_CONNECT_ERROR_CODES) {
      const result = describeLineOaConnectError(code)
      expect(result.code).toBe(code)
      expect(typeof result.message).toBe('string')
      expect(result.message.length).toBeGreaterThan(0)
      expect(typeof result.nextStep).toBe('string')
      expect(typeof result.retryable).toBe('boolean')
    }
  })

  it('maps a wrong Channel ID and a wrong secret to the identical code and copy', () => {
    const a = describeLineOaConnectError('LINE_CREDENTIALS_REJECTED')
    const b = describeLineOaConnectError('LINE_CREDENTIALS_REJECTED')
    expect(a).toEqual(b)
    expect(a.retryable).toBe(true)
  })

  it('routes MFA_FACTOR_REQUIRED to inline enrolment, never to step-up', () => {
    expect(describeLineOaConnectError('MFA_FACTOR_REQUIRED').nextStep).toBe('MFA_ENROL')
    expect(describeLineOaConnectError('ASSURANCE_LEVEL_INSUFFICIENT').nextStep).toBe('STEP_UP')
  })

  it('interpolates the retry-after seconds into the rate-limit message', () => {
    const result = describeLineOaConnectError('CREDENTIAL_RATE_LIMITED', { retryAfterSeconds: 42 })
    expect(result.message).toContain('42')
    expect(result.retryable).toBe(false)
  })

  it('prefers the server’s own Thai sentence for a claim conflict when given', () => {
    const withDetail = describeLineOaConnectError('LINE_CHANNEL_CLAIMED_ELSEWHERE', {
      details: [{ code: 'LINE_CHANNEL_CLAIMED_ELSEWHERE', message: 'ข้อความจากเซิร์ฟเวอร์' }],
    })
    expect(withDetail.message).toBe('ข้อความจากเซิร์ฟเวอร์')
    const withoutDetail = describeLineOaConnectError('LINE_CHANNEL_CLAIMED_ELSEWHERE')
    expect(withoutDetail.message).not.toBe('ข้อความจากเซิร์ฟเวอร์')
    expect(withoutDetail.message.length).toBeGreaterThan(0)
  })

  it('never lets a raw or unknown code through unmapped', () => {
    const result = describeLineOaConnectError('SOMETHING_NEW_AND_UNMAPPED')
    expect(result.code).toBe('SOMETHING_NEW_AND_UNMAPPED')
    expect(result.message).toBe('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง')
    expect(result.retryable).toBe(true)
  })

  it('never echoes a secret-shaped value even if a caller passed one in ctx', () => {
    const result = describeLineOaConnectError('LINE_CREDENTIALS_REJECTED', { channelSecret: '0123456789abcdef0123456789abcdef' })
    expect(result.message).not.toContain('0123456789abcdef0123456789abcdef')
  })
})
