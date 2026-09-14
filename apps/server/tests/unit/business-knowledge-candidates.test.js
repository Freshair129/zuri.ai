import { describe, expect, it } from 'vitest'
import { businessHasKnowledgeCandidatesEnabled } from '@/lib/business-knowledge-candidates'

// @req FR-236 — Business.knowledgeCandidatesEnabled is a content-safety gate
//   (ADR-090 D6), distinct from a `capabilitiesJson` module capability: it
//   defaults OFF for every Business, and reading it never throws.
// @spec ADR-090 D6
// @tested tests/unit/business-knowledge-candidates.test.js

describe('businessHasKnowledgeCandidatesEnabled', () => {
  it('reads true only when the column is the literal boolean true', () => {
    expect(businessHasKnowledgeCandidatesEnabled({ knowledgeCandidatesEnabled: true })).toBe(true)
    expect(businessHasKnowledgeCandidatesEnabled({ knowledgeCandidatesEnabled: false })).toBe(false)
  })

  it('defaults to false — never true, never a throw — on no Business, no column, or an untrustworthy value', () => {
    expect(businessHasKnowledgeCandidatesEnabled(null)).toBe(false)
    expect(businessHasKnowledgeCandidatesEnabled(undefined)).toBe(false)
    expect(businessHasKnowledgeCandidatesEnabled({})).toBe(false)
    expect(businessHasKnowledgeCandidatesEnabled({ knowledgeCandidatesEnabled: 'true' })).toBe(false)
    expect(businessHasKnowledgeCandidatesEnabled({ knowledgeCandidatesEnabled: 1 })).toBe(false)
    expect(businessHasKnowledgeCandidatesEnabled({ knowledgeCandidatesEnabled: null })).toBe(false)
  })
})
