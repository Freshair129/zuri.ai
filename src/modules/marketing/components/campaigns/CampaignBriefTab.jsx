'use client'

// @req FR-156 — the Brief tab displays and revises the current immutable
// Strategy revision, including the required Campaign brief extension.
// @spec SDD-087 — dates describe intent and stay separate from PM scheduling
// and measured source windows.
// @tested tests/unit/marketing-campaign-ui.test.js, tests/e2e/marketing-campaigns.spec.js

import { Card, SectionTitle, StatusPill } from '@/components/ui'
import { InlineNotice } from '../MarketingState'
import { PlanVersionHistory } from '../PlanVersionHistory'
import { campaignBudget, campaignChannelLabel, campaignCurrentBrief, campaignIsMutable, campaignPhase, campaignPlanIsArchived } from './campaign-contract'
import CampaignForm from './CampaignForm'

function BriefRead({ campaign }) {
  const version = campaign?.plan?.currentVersion
  const payload = version?.payload || {}
  const brief = campaignCurrentBrief(campaign)
  return (
    <div className="space-y-4">
      <Card data-testid="marketing-campaign-brief">
        <div className="flex flex-wrap items-start justify-between gap-3"><SectionTitle caption="Saved content from the current immutable Strategy revision">Campaign brief</SectionTitle><StatusPill status={campaignPhase(campaign)} /></div>
        <dl className="grid gap-x-4 gap-y-3 text-xs sm:grid-cols-2">
          <div><dt className="text-[10px] text-muted">Objective</dt><dd className="mt-1 font-semibold">{payload.objective || 'Objective unavailable'}</dd></div>
          <div><dt className="text-[10px] text-muted">Audience reference</dt><dd className="mt-1 font-semibold">{payload.audience || 'Audience reference unavailable'}</dd></div>
          <div><dt className="text-[10px] text-muted">Situation</dt><dd className="mt-1 whitespace-pre-wrap">{payload.situation || 'Situation unavailable'}</dd></div>
          <div><dt className="text-[10px] text-muted">Offer</dt><dd className="mt-1 whitespace-pre-wrap">{brief.offer || 'Offer unavailable'}</dd></div>
          <div><dt className="text-[10px] text-muted">Conditions</dt><dd className="mt-1 whitespace-pre-wrap">{brief.conditions || 'Conditions unavailable'}</dd></div>
          <div><dt className="text-[10px] text-muted">Campaign dates</dt><dd className="mt-1 font-semibold">{brief.startDate || 'Start unavailable'} → {brief.endDate || 'End unavailable'}</dd></div>
          <div><dt className="text-[10px] text-muted">Channels</dt><dd className="mt-1 font-semibold">{(payload.channels || []).map(campaignChannelLabel).join(' · ') || 'Channels unavailable'}</dd></div>
          <div><dt className="text-[10px] text-muted">Planning budget</dt><dd className="mt-1 font-semibold">{campaignBudget({ ...campaign, budget: payload.budget, currency: payload.currency })}</dd></div>
          <div className="sm:col-span-2"><dt className="text-[10px] text-muted">Success metric intent</dt><dd className="mt-1 whitespace-pre-wrap">{payload.successMetric || 'Success metric intent unavailable. PM metric targets and observations are separate.'}</dd></div>
        </dl>
      </Card>
      <PlanVersionHistory plan={campaign.plan} />
    </div>
  )
}

export default function CampaignBriefTab({ campaign, busy, onRevise }) {
  const mutable = campaignIsMutable(campaign)
  const planArchived = campaignPlanIsArchived(campaign)
  if (!campaign?.plan) return <InlineNotice tone="error">The linked Strategy plan is unavailable for this Campaign.</InlineNotice>
  return (
    <div>
      {mutable && !planArchived ? <CampaignForm plan={campaign.plan} busy={busy} onSubmit={onRevise} /> : <InlineNotice>{planArchived ? 'The linked Strategy plan is archived. Campaign revisions are disabled; close or cancel remains available while this initiative is open.' : campaign.status === 'CLOSED' || campaign.status === 'CANCELLED' ? 'Closed and cancelled Campaigns are read-only.' : 'This Campaign is read-only for the current Business grant.'}</InlineNotice>}
      <BriefRead campaign={campaign} />
    </div>
  )
}
