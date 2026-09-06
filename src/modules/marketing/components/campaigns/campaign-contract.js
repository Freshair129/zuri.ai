// @req FR-156 — Campaign UI binds one Marketing Initiative to one immutable
// Strategy plan and an explicit persisted Project Manager handoff.
// @spec SDD-087, SEC-001, SEC-003 — Business scope, optimistic versions and
// receipt identity stay server-authoritative.
// @tested tests/unit/marketing-campaign-ui.test.js

import {
  CAMPAIGN_TABS,
  GROWTH_CAMPAIGNS_PATH,
  campaignTabHref,
  currentPlanVersion,
  formatMarketingDate,
  growthCampaignPath,
  growthCampaignsPath,
  normalizeCampaignBrief,
} from '../marketing-contract'

export { CAMPAIGN_TABS, campaignTabHref, currentPlanVersion, formatMarketingDate, growthCampaignPath, growthCampaignsPath }

export const CAMPAIGN_PHASES = ['DRAFT', 'APPROVED', 'EXECUTING', 'CLOSED', 'CANCELLED']

export function campaignPhase(campaign) {
  const phase = String(campaign?.phase || '').toUpperCase()
  if (CAMPAIGN_PHASES.includes(phase)) return phase
  const status = String(campaign?.status || '').toUpperCase()
  if (status === 'CLOSED' || status === 'CANCELLED') return status
  return status === 'APPROVED' ? 'APPROVED' : 'DRAFT'
}

export function campaignIsMutable(campaign) {
  return campaign?.canWrite === true && !['CLOSED', 'CANCELLED'].includes(String(campaign?.status || '').toUpperCase())
}

export function campaignPlanIsArchived(campaign) {
  const status = String(campaignPlan(campaign)?.status || '').toUpperCase()
  return status === 'ARCHIVED' || campaignPlan(campaign)?.archived === true
}

export function campaignPlan(campaign) {
  return campaign?.plan || null
}

export function campaignCurrentBrief(campaign) {
  return normalizeCampaignBrief(currentPlanVersion(campaignPlan(campaign))?.payload?.campaignBrief)
}

export function campaignHandoffs(campaign) {
  return Array.isArray(campaignPlan(campaign)?.handoffs)
    ? [...campaignPlan(campaign).handoffs].sort((left, right) => new Date(right.createdAt || 0).getTime() - new Date(left.createdAt || 0).getTime())
    : []
}

export function campaignSelectedHandoff(campaign) {
  const handoffId = campaign?.handoffId || campaign?.execution?.handoff?.id
  return campaignHandoffs(campaign).find((handoff) => handoff.id === handoffId) || null
}

export function campaignExecutionReady(campaign) {
  return campaign?.execution?.status === 'READY' && Boolean(campaign.execution.roadmap)
}

export function campaignExecutionReceipt(campaign) {
  const handoff = campaign?.execution?.handoff
  if (!handoff) return null
  const version = (campaignPlan(campaign)?.versions || []).find((item) => item.id === handoff.planVersionId)
  return {
    revision: version?.revision || handoff.revision || 'unavailable',
    isCurrentRevision: handoff.isCurrentRevision !== false,
    workspaceId: handoff.workspaceId || null,
    projectId: handoff.projectId || null,
  }
}

export function campaignChannelLabel(value) {
  const labels = {
    META_ADS: 'Meta Ads',
    TIKTOK_ADS: 'TikTok Ads',
    INSTAGRAM: 'Instagram',
    GA4: 'Google Analytics 4',
    SEO: 'SEO',
  }
  return labels[value] || value || 'Unknown channel'
}

export function campaignDateWindow(campaign) {
  const brief = campaign?.campaignBrief || campaignCurrentBrief(campaign)
  if (!brief?.startDate && !brief?.endDate) return 'Dates unavailable'
  return `${brief.startDate || 'Start unavailable'} → ${brief.endDate || 'End unavailable'}`
}

export function campaignBudget(campaign) {
  const budget = campaign?.budget
  if (budget === null || budget === undefined || budget === '') return 'Budget unavailable'
  return `${budget} ${campaign.currency || ''}`.trim()
}

export function campaignMutationBody(campaign, businessId, action, extra = {}) {
  const body = {
    businessId,
    expectedVersion: campaign.version,
    action,
    ...extra,
  }
  if (action === 'revise' || action === 'bind-handoff') body.expectedPlanVersion = campaign.plan?.version
  return body
}

export { GROWTH_CAMPAIGNS_PATH }
