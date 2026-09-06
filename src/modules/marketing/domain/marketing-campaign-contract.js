import { z } from 'zod'

import {
  MARKETING_CAMPAIGN_PHASES,
  MARKETING_CAMPAIGN_STATUSES,
  zMarketingCampaignActionInput,
  zMarketingCampaignBindHandoffInput,
  zMarketingCampaignClosureInput,
  zMarketingCampaignCreateInput,
  zMarketingCampaignRevisionInput,
  zMarketingCampaignBrief,
} from '@/modules/marketing/domain/marketing-plan-contract'

// @req FR-156 — Campaign identity uses a Business-scoped initiative wrapper,
// reuses the immutable Strategy brief and binds only an authorized PM receipt.
// @spec SDD-087, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-campaign-contract.test.js,
//   tests/integration/marketing-campaign.test.js

export {
  MARKETING_CAMPAIGN_PHASES,
  MARKETING_CAMPAIGN_STATUSES,
  zMarketingCampaignActionInput,
  zMarketingCampaignBindHandoffInput,
  zMarketingCampaignClosureInput,
  zMarketingCampaignCreateInput,
  zMarketingCampaignRevisionInput,
  zMarketingCampaignBrief,
}

export const zMarketingCampaignId = z.string().trim().min(1).max(100)
export const zMarketingCampaignExpectedVersion = z.number().int().min(1)

export function phaseForMarketingCampaign({ initiative, hasReadyHandoff = false, hasCurrentApproval = false } = {}) {
  if (initiative?.status === 'CLOSED') return 'CLOSED'
  if (initiative?.status === 'CANCELLED') return 'CANCELLED'
  if (hasReadyHandoff) return 'EXECUTING'
  if (hasCurrentApproval) return 'APPROVED'
  return 'DRAFT'
}

export const unavailableMarketingCampaignResults = Object.freeze({
  status: 'UNAVAILABLE',
  reasonCode: 'NO_APPROVED_SOURCE',
  measurementWindow: null,
  sources: [],
  metrics: [],
})

