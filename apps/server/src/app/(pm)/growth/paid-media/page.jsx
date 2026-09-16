'use client'

// @req FR-185 — Paid Media page binds to the active Business and renders
// explicit unavailable/unknown owner states.
// @spec SDD-086, ADR-065
// @tested tests/e2e/marketing-p5.spec.js

import { useScope } from '@/context/ScopeContext'
import PaidMediaWorkspace from '@/modules/marketing/components/paid-media/PaidMediaWorkspace'

export default function PaidMediaPage() {
  const scope = useScope()
  const businessId = scope.shell.activeBusinessId
  return <PaidMediaWorkspace key={businessId || 'no-business'} businessId={businessId} />
}

