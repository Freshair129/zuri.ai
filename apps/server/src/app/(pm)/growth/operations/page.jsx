'use client'

// @req FR-162 — Operations collection is rooted in the active Business shell
// and preserves the selected tab in the URL.
// @spec SDD-089, SEC-001
// @tested tests/unit/marketing/marketing-operations-ui.test.js

import { Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { useScope } from '@/context/ScopeContext'
import { LoadingCard } from '@/modules/project-manager/components/useApi'
import OperationsCollection from '@/modules/marketing/components/operations/OperationsCollection'
import { OPERATIONS_TABS } from '@/modules/marketing/components/operations/operations-contract'

function OperationsPageContent({ businessId }) {
  const searchParams = useSearchParams()
  const requestedTab = searchParams.get('tab')
  const tab = OPERATIONS_TABS.some((item) => item.key === requestedTab) ? requestedTab : 'intake'
  return <OperationsCollection key={`${businessId || 'no-business'}:${tab}`} businessId={businessId} tab={tab} />
}

export default function MarketingOperationsPage() {
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  return <Suspense fallback={<main className="mx-auto max-w-6xl p-5"><LoadingCard /></main>}><OperationsPageContent businessId={businessId} /></Suspense>
}
