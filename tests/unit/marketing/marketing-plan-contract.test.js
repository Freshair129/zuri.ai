import { describe, expect, it } from 'vitest'
import {
  hashMarketingPlanContent,
  parseMarketingPlanVersionPayload,
  serializeMarketingPlanVersion,
  zMarketingPlanPayload,
} from '@/modules/marketing/domain/marketing-plan-contract'

// @req FR-153 — the strict Strategy payload and title-bound hash are stable
// before any persistence adapter is involved.
// @spec SDD-086, BR-007
// @tested tests/unit/marketing/marketing-plan-contract.test.js

const payload = {
  objective: 'Increase qualified inbound demand',
  situation: 'The current funnel has no consistent campaign learning loop.',
  audience: 'Thai SME owners seeking an operating system',
  channels: ['META_ADS', 'SEO'],
  budget: 10000,
  currency: 'THB',
  successMetric: 'Qualified leads at an agreed acquisition cost',
  actions: [{ title: 'Publish the first evidence-backed brief' }],
}

describe('Marketing plan contract', () => {
  it('rejects unknown payload fields and duplicate channels', () => {
    expect(() => zMarketingPlanPayload.parse({ ...payload, unexpected: true })).toThrow()
    expect(() => zMarketingPlanPayload.parse({ ...payload, channels: ['SEO', 'SEO'] })).toThrow(/unique/)
  })

  it('hashes canonical content independently of object key order', () => {
    const reordered = {
      actions: payload.actions,
      successMetric: payload.successMetric,
      currency: payload.currency,
      budget: payload.budget,
      channels: payload.channels,
      audience: payload.audience,
      situation: payload.situation,
      objective: payload.objective,
    }
    expect(hashMarketingPlanContent({ title: 'Demand Plan', payload }))
      .toBe(hashMarketingPlanContent({ title: 'Demand Plan', payload: reordered }))
    expect(hashMarketingPlanContent({ title: 'Demand Plan v2', payload }))
      .not.toBe(hashMarketingPlanContent({ title: 'Demand Plan', payload }))
  })

  it('stores title and payload together in an immutable revision envelope', () => {
    const stored = serializeMarketingPlanVersion({ title: 'Demand Plan', payload })
    expect(parseMarketingPlanVersionPayload(stored)).toEqual({ title: 'Demand Plan', payload })
    expect(() => parseMarketingPlanVersionPayload(JSON.stringify(payload))).toThrow(/immutable title/i)
  })
})

