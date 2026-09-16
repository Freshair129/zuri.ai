import { describe, expect, it } from 'vitest'
import { broadcastPayloadTemplate, classifyMarketingQuestion } from '@/modules/marketing/components/marketing-broadcast-client-contract'

// @req FR-185 — client uses only browser-safe planning labels and deterministic question mapping.
// @spec SDD-086
// @tested tests/unit/marketing/marketing-broadcast-client-contract.test.js

describe('Marketing broadcast client contract', () => {
  it('keeps the null account state explicit', () => {
    expect(broadcastPayloadTemplate({ criteriaHash: 'a'.repeat(64) })).toMatchObject({ account: null, accountState: 'UNAVAILABLE', accountReasonCode: 'LINE_ACCOUNT_NOT_SELECTED' })
  })
  it('maps only approved deterministic question classes', () => {
    expect(classifyMarketingQuestion('')).toBe('EXECUTIVE_OVERVIEW')
    expect(classifyMarketingQuestion('ROAS')).toBe('ANALYZE_ROAS')
    expect(classifyMarketingQuestion('what now?')).toBe('UNSUPPORTED')
  })
})

