import { describe, it, expect } from 'vitest'
import { aggregateAnalyses } from '@/modules/crm/daily-brief-service'
import { zConversationAnalysisInput, zAnalyzedDate } from '@/modules/crm/conversation-analysis-service'
import { zCustomerProfileInference } from '@/modules/crm/customer-profile-service'
import { CONTACT_TYPES, ENGAGEMENT_STATES, BUDGET_SIGNALS, DAILY_BRIEF_STATUSES } from '@/lib/validation/enums'

// @req FR-127, FR-128 — the boundary vocabularies and the pure aggregation FR-128
//   recomputes from. Pure: no I/O in this file.
// @spec BR-004 — enums.js is the single source of truth; these tests import it
//   rather than restating values, so a vocabulary change fails here only when it
//   breaks a real invariant.

const row = (over = {}) => ({
  state: 'HOT', cta: null, tagsJson: '[]', ...over,
})

describe('aggregateAnalyses (FR-128)', () => {
  it('empty input produces empty aggregates, not errors', () => {
    expect(aggregateAnalyses([])).toEqual({ stateCounts: {}, topCtas: [], topTags: [] })
  })

  it('counts states, ranks CTAs and tags by count then name, and caps at top 5', () => {
    const rows = [
      row({ state: 'HOT', cta: 'BOOKED', tagsJson: JSON.stringify(['price', 'course']) }),
      row({ state: 'HOT', cta: 'BOOKED', tagsJson: JSON.stringify(['price']) }),
      row({ state: 'WARM', cta: 'ASKED_PRICE', tagsJson: JSON.stringify(['a', 'b', 'c', 'd', 'e', 'f']) }),
    ]
    const agg = aggregateAnalyses(rows)
    expect(agg.stateCounts).toEqual({ HOT: 2, WARM: 1 })
    expect(agg.topCtas[0]).toEqual({ value: 'BOOKED', count: 2 })
    expect(agg.topCtas[1]).toEqual({ value: 'ASKED_PRICE', count: 1 })
    // price appears twice → first; the rest tie at 1 and rank by name; capped at 5.
    expect(agg.topTags).toHaveLength(5)
    expect(agg.topTags[0]).toEqual({ value: 'price', count: 2 })
  })

  it('ties rank deterministically by name, so a recompute never reorders itself', () => {
    const rows = [row({ cta: 'B' }), row({ cta: 'A' })]
    expect(aggregateAnalyses(rows).topCtas.map((c) => c.value)).toEqual(['A', 'B'])
  })
})

describe('boundary vocabularies (FR-126/FR-127)', () => {
  it('accepts every declared contact type and engagement state', () => {
    for (const contactType of CONTACT_TYPES) {
      for (const state of ENGAGEMENT_STATES) {
        expect(() => zConversationAnalysisInput.parse({ analyzedDate: '2026-08-30', contactType, state })).not.toThrow()
      }
    }
  })

  it('rejects a state or contact type outside the enum', () => {
    expect(() => zConversationAnalysisInput.parse({ analyzedDate: '2026-08-30', contactType: 'NEW_LEAD', state: 'LUKEWARM' })).toThrow()
    expect(() => zConversationAnalysisInput.parse({ analyzedDate: '2026-08-30', contactType: 'VIP', state: 'HOT' })).toThrow()
  })

  it('rejects a malformed analyzedDate — the FR-128 aggregation key is a date label, not an instant', () => {
    for (const bad of ['2026-8-30', '30-08-2026', '2026-08-30T00:00:00Z', '']) {
      expect(() => zAnalyzedDate.parse(bad)).toThrow()
    }
    expect(() => zAnalyzedDate.parse('2026-08-30')).not.toThrow()
  })

  it('profile accepts every declared budget signal and rejects others', () => {
    for (const budgetSignal of BUDGET_SIGNALS) {
      expect(() => zCustomerProfileInference.parse({ budgetSignal })).not.toThrow()
    }
    expect(() => zCustomerProfileInference.parse({ budgetSignal: 'LUXURY' })).toThrow()
  })

  it('DAILY_BRIEF_STATUSES stays frozen to what the code writes — SENT/FAILED arrive with delivery, not before', () => {
    expect(DAILY_BRIEF_STATUSES).toEqual(['PENDING', 'PROCESSED'])
  })
})
