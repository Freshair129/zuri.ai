'use client'

// @req FR-157 — asset detail addresses MarketingContentVersion, not FileAsset,
// and never invents a creative preview or external action.
// @spec ZAI:FR-157-NOTE, SEC-001 — loaded identity is checked against active
// Business and URL revision before rendering.
// @tested tests/unit/marketing-content-ui.test.js, tests/e2e/marketing-content.spec.js

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { useScope } from '@/context/ScopeContext'
import { LoadingCard } from '@/modules/project-manager/components/useApi'
import ContentAssetDetail from '@/modules/marketing/components/content/ContentAssetDetail'

function AssetDetailContent({ businessId, assetVersionId }) {
  return <ContentAssetDetail key={`${businessId || 'no-business'}:${assetVersionId}`} businessId={businessId} assetVersionId={assetVersionId} />
}
export default function MarketingContentAssetDetailPage() {
  const scope = useScope()
  const params = useParams()
  const businessId = scope.shell.activeBusinessId
  const assetVersionId = Array.isArray(params?.assetId) ? params.assetId[0] : params?.assetId
  return <Suspense fallback={<main className="mx-auto max-w-6xl p-5 max-md:p-3"><LoadingCard /></main>}><AssetDetailContent businessId={businessId} assetVersionId={assetVersionId} /></Suspense>
}
