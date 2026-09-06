'use client'

// @req FR-153 — Marketing dashboard reads the active Business scope.
// @spec SDD-086 — Dashboard shows persisted plan state and explicit unavailable metrics.
// @tested tests/unit/marketing-strategy-ui.test.js, tests/e2e/marketing-strategy.spec.js

import { useScope } from '@/context/ScopeContext'
import MarketingDashboard from '@/modules/marketing/components/MarketingDashboard'

export default function MarketingGrowthPage() {
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  return <MarketingDashboard key={businessId || 'no-business'} businessId={businessId} />
}
