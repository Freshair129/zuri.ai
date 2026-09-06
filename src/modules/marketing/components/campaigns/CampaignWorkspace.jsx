'use client'

// @req FR-156 — Campaign detail keeps one URL-addressable tab bar over Brief,
// Plan, Timeline, Results and Decisions, with scoped writes and receipt-bound
// execution.
// @spec SDD-087, SEC-001, SEC-003 — Business and initiative identity guard every
// read; expected versions guard every mutation.
// @tested tests/unit/marketing-campaign-ui.test.js, tests/e2e/marketing-campaigns.spec.js

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Card, ErrorState, PageHeader, StatusPill } from '@/components/ui'
import { LoadingCard, useFetch, api } from '@/modules/project-manager/components/useApi'
import { CAMPAIGN_TABS, campaignIsMutable, campaignMutationBody, campaignPhase, campaignSelectedHandoff, growthCampaignPath, campaignTabHref } from './campaign-contract'
import { InlineNotice, MarketingDataState, ScopeNotice } from '../MarketingState'
import { MarketingTabs } from '../MarketingTabs'
import CampaignBriefTab from './CampaignBriefTab'
import CampaignDecisionsTab from './CampaignDecisionsTab'
import CampaignPlanTab from './CampaignPlanTab'
import CampaignResultsTab from './CampaignResultsTab'
import CampaignTimelineTab from './CampaignTimelineTab'

function responseCampaign(value) {
  return value?.campaign || value?.initiative || value || null
}

export default function CampaignWorkspace({ businessId, initiativeId }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState(null)
  const tabValue = searchParams.get('tab')
  const tab = CAMPAIGN_TABS.some((item) => item.key === tabValue) ? tabValue : 'brief'
  const detail = useFetch(businessId && initiativeId ? growthCampaignPath(initiativeId, businessId) : null, [businessId, initiativeId])
  const loaded = responseCampaign(detail.data)
  const campaign = loaded?.id === initiativeId && loaded?.businessId === businessId ? loaded : null
  const mutable = campaignIsMutable(campaign)
  const selectedHandoff = campaign?.execution?.status === 'READY' ? campaignSelectedHandoff(campaign) : null

  const mutate = async (action, extra = {}) => {
    if (!campaign || !businessId) return null
    setBusy(true)
    setMutationError(null)
    try {
      const result = await api(growthCampaignPath(campaign.id, businessId), { method: 'PATCH', body: campaignMutationBody(campaign, businessId, action, extra) })
      await detail.reload()
      return result
    } catch (error) {
      setMutationError(error.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const revise = ({ title, payload }) => mutate('revise', { title, payload })
  const bindHandoff = (handoffId) => mutate('bind-handoff', { handoffId })
  const closeOrCancel = (action, reason) => {
    if (!reason) {
      setMutationError('A written reason is required.')
      return null
    }
    return mutate(action, { reason })
  }
  const hrefForTab = (nextTab) => campaignTabHref(pathname, nextTab)

  if (!businessId) return <ScopeNotice />
  if (detail.loading && !campaign) return <main className="mx-auto max-w-6xl p-5 max-md:p-3"><LoadingCard /></main>
  if (detail.error) return <main className="mx-auto max-w-6xl p-5 max-md:p-3"><ErrorState title="Campaign unavailable" detail={detail.error} retry={detail.reload} /></main>
  if (!campaign) return <main className="mx-auto max-w-6xl p-5 max-md:p-3"><ErrorState title="Campaign unavailable" detail="The requested Campaign does not belong to the active Business scope." retry={detail.reload} /></main>

  return (
    <main className="mx-auto max-w-6xl p-5 max-md:p-3">
      <PageHeader
        eyebrow="MARKETING / CAMPAIGNS"
        title={campaign.plan?.title || campaign.title || 'Campaign'}
        subtitle="Business initiative brief, PM execution receipt and source-aware decisions."
        actions={<StatusPill status={campaignPhase(campaign)} />}
      />
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><Link href="/growth/campaigns" className="btn text-[11px]"><ArrowLeft size={13} aria-hidden /> Back to campaigns</Link>{selectedHandoff?.projectId && <Link href={`/projects/${encodeURIComponent(selectedHandoff.projectId)}/roadmap`} className="btn text-[11px]">Open PM roadmap</Link>}</div>
      <MarketingTabs tabs={CAMPAIGN_TABS} activeKey={tab} hrefForTab={hrefForTab} ariaLabel="Marketing campaign sections" />
      {mutationError && <div className="mb-4"><InlineNotice tone="error">{mutationError} Refresh the Campaign before retrying a stale write.</InlineNotice></div>}
      <MarketingDataState loading={detail.loading && !campaign} error={null} retry={detail.reload}>
        {tab === 'brief' && <CampaignBriefTab key={`brief-${campaign.id}`} campaign={campaign} busy={busy} onRevise={revise} />}
        {tab === 'plan' && <CampaignPlanTab key={`plan-${campaign.id}`} campaign={campaign} />}
        {tab === 'timeline' && <CampaignTimelineTab key={`timeline-${campaign.id}`} campaign={campaign} />}
        {tab === 'results' && <CampaignResultsTab key={`results-${campaign.id}`} campaign={campaign} />}
        {tab === 'decisions' && <CampaignDecisionsTab key={`decisions-${campaign.id}`} campaign={campaign} busy={busy} onBindHandoff={bindHandoff} onClosure={closeOrCancel} />}
      </MarketingDataState>
      {!mutable && campaign.status !== 'CLOSED' && campaign.status !== 'CANCELLED' && <Card className="mt-4"><InlineNotice>This Campaign is read-only for the current Business grant. You can still inspect its plan evidence and selected PM receipt.</InlineNotice></Card>}
    </main>
  )
}
