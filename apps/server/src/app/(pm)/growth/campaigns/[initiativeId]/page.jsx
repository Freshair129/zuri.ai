'use client'

// @req FR-160 — Campaign detail addresses the initiative by UUID and preserves
// one URL-selected tab across Back/reload.
// @spec SDD-087, SEC-001 — Business and initiative response identity are both
// checked before rendering or mutating.
// @tested tests/unit/marketing-campaign-ui.test.js, tests/e2e/marketing-campaigns.spec.js

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { LoadingCard } from '@/modules/project-manager/components/useApi'
import { useScope } from '@/context/ScopeContext'
import CampaignWorkspace from '@/modules/marketing/components/campaigns/CampaignWorkspace'

function CampaignDetailContent({ businessId, initiativeId }) {
  return <CampaignWorkspace key={`${businessId || 'no-business'}:${initiativeId}`} businessId={businessId} initiativeId={initiativeId} />
}

export default function MarketingCampaignDetailPage() {
  const scope = useScope()
  const params = useParams()
  const businessId = scope.shell.activeBusinessId
  const initiativeId = Array.isArray(params?.initiativeId) ? params.initiativeId[0] : params?.initiativeId
  return <Suspense fallback={<main className="mx-auto max-w-6xl p-5 max-md:p-3"><LoadingCard /></main>}><CampaignDetailContent businessId={businessId} initiativeId={initiativeId} /></Suspense>
}
