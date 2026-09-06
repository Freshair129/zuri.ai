'use client'

// @req FR-157 — Content collection is rooted in the active Business shell.
// @spec ZAI:FR-157-NOTE — URL-selected tabs are Business-scoped and reset on
// scope changes before a new response is rendered.
// @tested tests/unit/marketing-content-ui.test.js, tests/e2e/marketing-content.spec.js

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useScope } from '@/context/ScopeContext'
import { LoadingCard } from '@/modules/project-manager/components/useApi'
import ContentCollection from '@/modules/marketing/components/content/ContentCollection'
import { CONTENT_TABS } from '@/modules/marketing/components/content/content-contract'

function ContentPageContent({ businessId }) {
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const tab = CONTENT_TABS.some((item) => item.key === requestedTab) ? requestedTab : 'briefs'
  return <ContentCollection key={businessId || 'no-business'} businessId={businessId} tab={tab} />
}
export default function MarketingContentPage() {
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  return <Suspense fallback={<main className="mx-auto max-w-6xl p-5"><LoadingCard /></main>}><ContentPageContent businessId={businessId} /></Suspense>
}
