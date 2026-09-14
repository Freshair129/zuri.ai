import { describe, expect, it } from 'vitest'
import {
  assertCandidateProseZeroPii,
  CANDIDATE_ZERO_PII_POLICY,
  composeCandidateContent,
  findCandidateProseViolation,
} from '@/modules/knowledge/knowledge-candidate-zero-pii'
import { isStructuredRecordProvider, STRUCTURED_RECORD_PROVIDERS } from '@/modules/knowledge/structured-record-policy'
import { CLEAN, MUST_PASS_ANSWERS, MUST_REFUSE_ANSWERS } from '../fixtures/knowledge-candidate-prose-fixtures'

// @req FR-236 — the candidate prose policy: one entry point,
// `findCandidateProseViolation(content)`, taking exactly the text the
// admission service will store (`composeCandidateContent`'s output). Every
// caller — creation, edit, decision and, per genesisrag17-executor.js, Stage
// 5 classify — calls this same function on this same composed text.
// @spec ADR-090 D6 (revised 2026-09-14, owner decision): both checks run the
//   candidate prose policy (names, phone numbers, LINE ids, quoted wording),
//   never FR-187's structured-record category-word policy — FR-187 denies
//   the literal words ลูกค้า/ใบเสนอราคา/customer/contact/quotation, which an
//   ordinary approved FAQ legitimately contains as free text.
const content = (answer) => composeCandidateContent({ ...CLEAN, answer })

describe('knowledge candidate prose Zero-PII policy (FR-236)', () => {
  it('passes a clean, locator-only Q/A', () => {
    expect(findCandidateProseViolation(composeCandidateContent(CLEAN))).toBeNull()
    expect(() => assertCandidateProseZeroPii(composeCandidateContent(CLEAN))).not.toThrow()
  })

  it('refuses every documented PII shape, and names which rule matched', () => {
    for (const { answer, term } of MUST_REFUSE_ANSWERS) {
      const violation = findCandidateProseViolation(content(answer))
      expect(violation, answer).toMatchObject({ field: 'answer', term })
      expect(() => assertCandidateProseZeroPii(content(answer))).toThrow(
        expect.objectContaining({ status: 422, code: 'KNOWLEDGE_CANDIDATE_ZERO_PII_DENIED' }),
      )
    }
  })

  it('reports a violation in the question field too', () => {
    expect(findCandidateProseViolation(composeCandidateContent({ ...CLEAN, question: 'ติดต่อที่เบอร์ 0891234567 ใช่ไหม' })))
      .toMatchObject({ field: 'question', term: 'phone_number' })
  })

  it('carries its own policy identity, distinct from FR-187 SmartGift policy', () => {
    expect(CANDIDATE_ZERO_PII_POLICY).toBe('line-faq-candidate-zero-pii-1')
  })

  it('scans malformed/non-JSON content whole, under field "content", rather than throwing or silently passing', () => {
    expect(findCandidateProseViolation('not json at all, but has 081-234-5678 in it')).toMatchObject({ field: 'content', term: 'phone_number' })
    expect(findCandidateProseViolation('not json, and clean')).toBeNull()
  })

  it('lists at least 15 realistic must-pass fixtures', () => {
    expect(MUST_PASS_ANSWERS.length).toBeGreaterThanOrEqual(15)
  })

  it.each(MUST_PASS_ANSWERS)('does not refuse realistic FAQ prose: %s', (answer) => {
    expect(findCandidateProseViolation(content(answer))).toBeNull()
    expect(() => assertCandidateProseZeroPii(content(answer))).not.toThrow()
  })
})

describe('Stage 5 provider routing is explicit, per ADR-090 D6 (revised 2026-09-14)', () => {
  it('LINE_FAQ_CANDIDATE is NOT a structured-record (FR-187) provider — it never carries that policy', () => {
    expect(isStructuredRecordProvider('LINE_FAQ_CANDIDATE')).toBe(false)
    expect(STRUCTURED_RECORD_PROVIDERS).not.toContain('LINE_FAQ_CANDIDATE')
  })

  it('SMARTGIFT_CATALOG keeps the FR-187 structured-record policy, unchanged', () => {
    expect(isStructuredRecordProvider('SMARTGIFT_CATALOG')).toBe(true)
    expect(STRUCTURED_RECORD_PROVIDERS).toEqual(['SMARTGIFT_CATALOG'])
  })
})
