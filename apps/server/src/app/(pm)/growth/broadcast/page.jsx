'use client'

// @req FR-185 — Broadcast page binds to the active Business and offers only
// durable planning intent actions; dispatch is unavailable.
// @spec SDD-086, SEC-001, SEC-003
// @tested tests/e2e/marketing-p5.spec.js

import { useScope } from '@/context/ScopeContext'
import BroadcastWorkspace from '@/modules/marketing/components/campaigns/BroadcastWorkspace'

export default function BroadcastPage() {
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  return <BroadcastWorkspace key={businessId || 'no-business'} businessId={businessId} />
}

