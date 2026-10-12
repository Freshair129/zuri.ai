import { describe, expect, it } from 'vitest'
import { BUSINESS_KPI_RESULT_STATUS, kpiStatus } from '@/modules/business/application/business-kpi-status'

const up = { direction: 'UP', target: 100, warningThreshold: 80 }
const down = { direction: 'DOWN', target: 5, warningThreshold: 8 }
const observation = (value) => ({ value })

describe('FR-269 Business KPI result status', () => {
  it('returns NO_SIGNAL when the KPI has no observation', () => {
    expect(kpiStatus(up, null)).toBe(BUSINESS_KPI_RESULT_STATUS.NO_SIGNAL)
  })

  it('uses inclusive target and warning boundaries for an UP KPI', () => {
    expect(kpiStatus(up, observation(100.01))).toBe('OK')
    expect(kpiStatus(up, observation(100))).toBe('OK')
    expect(kpiStatus(up, observation(90))).toBe('WARN')
    expect(kpiStatus(up, observation(80))).toBe('WARN')
    expect(kpiStatus(up, observation(79.99))).toBe('BAD')
  })

  it('mirrors the threshold rules for a DOWN KPI', () => {
    expect(kpiStatus(down, observation(4.99))).toBe('OK')
    expect(kpiStatus(down, observation(5))).toBe('OK')
    expect(kpiStatus(down, observation(6.5))).toBe('WARN')
    expect(kpiStatus(down, observation(8))).toBe('WARN')
    expect(kpiStatus(down, observation(8.01))).toBe('BAD')
  })

  it('uses native binary64 comparisons without rounding or an epsilon', () => {
    const binary64 = { direction: 'UP', target: 0.3, warningThreshold: 0.2 }
    expect(0.1 + 0.2).toBeGreaterThan(binary64.target)
    expect(kpiStatus(binary64, observation(0.1 + 0.2))).toBe('OK')
  })

  it('rejects non-finite and non-numeric persisted KPI values', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, 'not-a-number']) {
      expect(() => kpiStatus(up, observation(value))).toThrow(/must be finite numbers/)
    }
  })

  it('rejects unsupported persisted directions instead of guessing', () => {
    expect(() => kpiStatus({ ...up, direction: 'SIDEWAYS' }, observation(90))).toThrow(/Unsupported Business KPI direction/)
  })
})
