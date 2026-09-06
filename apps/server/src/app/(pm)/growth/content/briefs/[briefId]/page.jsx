'use client'

// @req FR-157 — a Content brief is addressable by UUID and preserves its
// revision/review/decision state through Back and reload.
// @spec ZAI:FR-157-NOTE, SEC-001 — response identity is checked against both
// active Business and URL brief before rendering or mutating.
// @tested tests/unit/marketing-content-ui.test.js, tests/e2e/marketing-content.spec.js

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { useScope } from '@/context/ScopeContext'
import { LoadingCard } from '@/modules/project-manager/components/useApi'
import ContentBriefDetail from '@/modules/marketing/components/content/ContentBriefDetail'

function BriefDetailContent({ businessId, briefId }) {
  return <ContentBriefDetail key={`${businessId || 'no-business'}:${briefId}`} businessId={businessId} briefId={briefId} />
}
export default function MarketingContentBriefDetailPage() {
  const scope = useScope()
  const params = useParams()
  const businessId = scope.shell.activeBusinessId
  const briefId = Array.isArray(params?.briefId) ? params.briefId[0] : params?.briefId
  return <Suspense fallback={<main className="mx-auto max-w-6xl p-5 max-md:p-3"><LoadingCard /></main>}><BriefDetailContent businessId={businessId} briefId={briefId} /></Suspense>
}
