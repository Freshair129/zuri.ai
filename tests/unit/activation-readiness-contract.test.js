import { describe, expect, it } from 'vitest'
import {
  ACTIVATION_RECEIPT_STATES,
  parseCanaryReadinessPlan,
  parseGoldenQuestionCorpus,
} from '@/modules/agent/activation-readiness-contract'

// @req FR-053, FR-054 — shared activation contracts exist before parallel implementation.
// @spec BR-013, SDD-027, SEC-011 — readiness is dry-run, redacted and distinct from delivery.
// @tested tests/unit/activation-readiness-contract.test.js

function goldenCase(index) {
  return {
    id: `GQ-${String(index).padStart(2, '0')}`,
    question: `คำถามทดสอบ ${index}`,
    expectedQueryId: 'product_search',
    expectedEvidenceCodes: [`SKU-${index}`],
    expectedPolicy: 'ANSWER',
    allowedNumericClaims: [],
  }
}

describe('activation readiness shared contract', () => {
  it('requires a uniquely identified corpus of at least twenty golden questions', () => {
    const cases = Array.from({ length: 20 }, (_, index) => goldenCase(index + 1))
    expect(parseGoldenQuestionCorpus({ version: '1.0.0', cases }).cases).toHaveLength(20)
    expect(() => parseGoldenQuestionCorpus({ version: '1.0.0', cases: cases.slice(0, 19) })).toThrow()
    expect(() => parseGoldenQuestionCorpus({ version: '1.0.0', cases: [...cases, cases[0]] })).toThrow(/duplicate/i)
  })

  it('defaults canary planning to dry-run and rejects activation-shaped input', () => {
    const plan = parseCanaryReadinessPlan({
      projectRef: 'qcnmhyglarzcpudjorzc',
      tenantId: '11111111-1111-4111-8111-111111111111',
      businessId: '22222222-2222-4222-8222-222222222222',
      bindingId: '33333333-3333-4333-8333-333333333333',
      bindingStatus: 'PENDING',
      bindingHashesPresent: false,
      goldenReportSha256: 'a'.repeat(64),
      isolationReportSha256: 'b'.repeat(64),
    })
    expect(plan.mode).toBe('DRY_RUN')
    expect(() => parseCanaryReadinessPlan({ ...plan, mode: 'ACTIVATE' })).toThrow()
  })

  it('preserves truthful LINE receipt states', () => {
    expect(ACTIVATION_RECEIPT_STATES).toEqual([
      'GENERATED',
      'EVIDENCE_VERIFIED',
      'ACCEPTED_BY_LINE',
      'DISPLAYED_UNKNOWN',
      'READ_UNKNOWN',
    ])
  })
})
