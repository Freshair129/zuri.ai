'use client'

// @req FR-185 — AskMarketing page binds to the active Business and exposes a
// deterministic read-only answer without an action control.
// @spec SDD-086, SEC-001, SEC-003
// @tested tests/e2e/marketing-p5.spec.js

import { useScope } from '@/context/ScopeContext'
import AskMarketingWorkspace from '@/modules/marketing/components/AskMarketingWorkspace'

export default function AskMarketingPage() {
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  return <AskMarketingWorkspace key={businessId || 'no-business'} businessId={businessId} />
}

