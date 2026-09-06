'use client'

// @req FR-155 — Strategy URL state composes the native Marketing planning view.
// @req FR-154 — Plan detail includes the verified Project Manager handoff.
// @spec SDD-086 — the child is keyed by active Business to clear stale scope data.
// @tested tests/unit/marketing-strategy-ui.test.js, tests/e2e/marketing-strategy.spec.js

import { Suspense } from 'react'
import { LoadingCard } from '@/modules/project-manager/components/useApi'
import { useScope } from '@/context/ScopeContext'
import StrategyWorkspace from '@/modules/marketing/components/StrategyWorkspace'

function StrategyPageContent({ businessId }) {
  return <StrategyWorkspace key={businessId || 'no-business'} businessId={businessId} />
}

export default function MarketingStrategyPage() {
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  return <Suspense fallback={<div className="mx-auto max-w-6xl p-5"><LoadingCard /></div>}><StrategyPageContent businessId={businessId} /></Suspense>
}
