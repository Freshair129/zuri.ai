import { describe, expect, it } from 'vitest'

import {
  zMarketingCampaignActionInput,
  zMarketingCampaignCreateInput,
} from '@/modules/marketing/domain/marketing-campaign-contract'
import {
  hashMarketingPlanContent,
  parseMarketingPlanVersionPayload,
  serializeMarketingPlanVersion,
  zMarketingPlanPayload,
} from '@/modules/marketing/domain/marketing-plan-contract'

// @req FR-156 — Campaign input keeps date-only planning semantics strict while
// Strategy payloads without campaignBrief remain backward-compatible.
// @spec SDD-087, BR-001, SEC-001
// @tested tests/unit/marketing/marketing-campaign-contract.test.js

const basePayload = {
  objective: 'Objective',
  situation: 'Situation',
  audience: 'Audience',
  channels: ['SEO'],
  budget: 0,
  currency: 'THB',
  successMetric: 'Leads',
  actions: [{ title: 'Action' }],
}

const brief = {
  startDate: '2026-09-10',
  endDate: '2026-09-20',
  offer: 'Offer',
  conditions: 'Conditions',
}

describe('Marketing Campaign contract', () => {
  it('requires a complete brief for Campaign creation and rejects invalid calendars', () => {
    expect(zMarketingCampaignCreateInput.parse({ businessId: 'b-1', title: 'Campaign', payload: { ...basePayload, campaignBrief: brief } })).toMatchObject({
      payload: { campaignBrief: brief },
    })
    expect(() => zMarketingCampaignCreateInput.parse({
      businessId: 'b-1', title: 'Campaign', payload: { ...basePayload, campaignBrief: { ...brief, endDate: '2026-09-01' } },
    })).toThrow(/endDate/i)
    expect(() => zMarketingCampaignActionInput.parse({
      action: 'close', businessId: 'b-1', expectedVersion: 1, reason: 'close', tenantId: 'forged',
    })).toThrow(/Unrecognized key/i)
  })

  it('keeps old Strategy payloads and hashes unchanged when brief is absent', () => {
    const parsed = zMarketingPlanPayload.parse(basePayload)
    expect(parsed).not.toHaveProperty('campaignBrief')
    const serialized = serializeMarketingPlanVersion({ title: 'Strategy', payload: basePayload })
    expect(parseMarketingPlanVersionPayload(serialized).payload).toEqual(basePayload)
    expect(hashMarketingPlanContent({ title: 'Strategy', payload: basePayload }))
      .toBe(hashMarketingPlanContent({ title: 'Strategy', payload: parsed }))
  })
})

