// @req FR-156 — Campaign navigation, brief extension, PM receipt binding and
// unavailable results are covered by executable UI contract assertions.
// @spec SDD-087
// @tested tests/unit/marketing-campaign-ui.test.js

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CAMPAIGN_TABS,
  campaignMutationBody,
  campaignTabHref,
  growthCampaignPath,
} from '@/modules/marketing/components/campaigns/campaign-contract'
import {
  diffPlanPayload,
  emptyCampaignBrief,
  emptyPlanPayload,
  normalizePlanPayload,
  validatePlanPayload,
} from '@/modules/marketing/components/marketing-contract'

const read = (path) => readFileSync(resolve(process.cwd(), path), 'utf8')
const planForm = read('src/modules/marketing/components/PlanForm.jsx')
const collection = read('src/modules/marketing/components/campaigns/CampaignCollection.jsx')
const workspace = read('src/modules/marketing/components/campaigns/CampaignWorkspace.jsx')
const planTab = read('src/modules/marketing/components/campaigns/CampaignPlanTab.jsx')
const resultsTab = read('src/modules/marketing/components/campaigns/CampaignResultsTab.jsx')
const decisionsTab = read('src/modules/marketing/components/campaigns/CampaignDecisionsTab.jsx')
const history = read('src/modules/marketing/components/PlanVersionHistory.jsx')

const validPayload = {
  ...emptyPlanPayload(),
  objective: 'Increase qualified enquiries',
  situation: 'The offer page is under-reached.',
  audience: 'Thai SME owners',
  channels: ['META_ADS'],
  budget: 12000,
  currency: 'THB',
  successMetric: 'Qualified enquiries observed in PM KPI records',
  actions: [{ title: 'Publish campaign landing page' }],
  campaignBrief: {
    ...emptyCampaignBrief(),
    startDate: '2026-09-10',
    endDate: '2026-09-30',
    offer: 'Corporate gifting consultation',
    conditions: 'Business customers only',
  },
}

describe('FR-156 Campaign UI contracts', () => {
  it('keeps the five detail tabs addressable without a collection tab bar', () => {
    expect(CAMPAIGN_TABS.map((item) => item.key)).toEqual(['brief', 'plan', 'timeline', 'results', 'decisions'])
    expect(campaignTabHref('/growth/campaigns/initiative-1', 'timeline')).toBe('/growth/campaigns/initiative-1?tab=timeline')
    expect(growthCampaignPath('initiative-1', 'business-1')).toBe('/api/growth/campaigns/initiative-1?businessId=business-1')
    expect(collection).toContain('marketing-campaign-board')
    expect(collection).toContain('aria-pressed={view === value}')
  })

  it('requires campaign brief fields and preserves absent extensions on old Strategy payloads', () => {
    expect(validatePlanPayload(validPayload, 'Campaign name', { campaignBriefRequired: true })).toEqual([])
    expect(validatePlanPayload({ ...validPayload, campaignBrief: { ...validPayload.campaignBrief, endDate: '2026-09-01' } }, 'Campaign name', { campaignBriefRequired: true })).toContain('End date must be on or after the start date.')
    expect(validatePlanPayload({ ...validPayload, campaignBrief: { ...validPayload.campaignBrief, offer: '' } }, 'Campaign name', { campaignBriefRequired: true })).toContain('Describe the offer.')
    expect(normalizePlanPayload(emptyPlanPayload())).not.toHaveProperty('campaignBrief')
    expect(normalizePlanPayload(validPayload).campaignBrief).toEqual(validPayload.campaignBrief)
    expect(diffPlanPayload(emptyPlanPayload(), validPayload)).toContain('campaignBrief')
  })

  it('keeps strict lifecycle request bodies distinct from plan binding writes', () => {
    const campaign = { version: 4, plan: { version: 7 } }
    expect(campaignMutationBody(campaign, 'business-1', 'close', { reason: 'Completed' })).toEqual({ businessId: 'business-1', expectedVersion: 4, action: 'close', reason: 'Completed' })
    expect(campaignMutationBody(campaign, 'business-1', 'cancel', { reason: 'Cancelled' })).toEqual({ businessId: 'business-1', expectedVersion: 4, action: 'cancel', reason: 'Cancelled' })
    expect(campaignMutationBody(campaign, 'business-1', 'bind-handoff', { handoffId: 'handoff-1' })).toMatchObject({ expectedPlanVersion: 7, handoffId: 'handoff-1' })
  })
})

describe('FR-156 Campaign UI integration seams', () => {
  it('uses one scope-keyed detail read and guards both Business and initiative identity', () => {
    expect(workspace).toContain('loaded?.id === initiativeId && loaded?.businessId === businessId')
    expect(workspace).toContain('[businessId, initiativeId]')
    expect(workspace).toContain('<MarketingTabs')
    expect(workspace).toContain('key={`decisions-${campaign.id}`}')
    expect(workspace).toContain("action, reason")
    expect(workspace).not.toContain("/api/projects/${")
  })

  it('keeps execution reads on the server adapter and exposes PM progress caveats', () => {
    expect(planTab).toContain('campaign?.execution')
    expect(planTab).toContain('campaignExecutionReady')
    expect(planTab).toContain('PM execution progress (not Marketing results)')
    expect(planTab).toContain('PM KPI targets or observations are unavailable')
    expect(resultsTab).toContain('NO_APPROVED_SOURCE')
    expect(resultsTab).toContain('Budget and PM work completion are planning and execution facts')
  })

  it('binds only explicit receipts, reuses Strategy evidence and keeps Team runtime out', () => {
    expect(decisionsTab).toContain('campaignHandoffs')
    expect(decisionsTab).toContain('Bind selected receipt')
    expect(decisionsTab).toContain('Open Strategy controls')
    expect(decisionsTab).toContain('Closure reason')
    expect(history).toContain('Campaign brief')
    expect(history).toContain('Dates:')
    expect(history).not.toContain('[object Object]')
  })

  it('uses real accessible Campaign fields instead of fixture rows', () => {
    expect(planForm).toContain('mode === \'campaign\'')
    expect(planForm).toContain('label="Start date"')
    expect(planForm).toContain('label="End date"')
    expect(planForm).toContain('label="Offer"')
    expect(planForm).toContain('label="Conditions"')
    expect(collection).toContain('Search visible campaigns')
    expect(collection).not.toContain('Autumn Gift Edit')
  })
})
