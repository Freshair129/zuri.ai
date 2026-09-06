'use client'

// @req FR-161 — Handoff detail renders only the validated receipt projection
// returned for the active Business.
// @spec SDD-089, FR-158, SEC-001
// @tested tests/unit/marketing/marketing-operations-ui.test.js

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { useScope } from '@/context/ScopeContext'
import { LoadingCard } from '@/modules/project-manager/components/useApi'
import OperationsHandoffDetail from '@/modules/marketing/components/operations/OperationsHandoffDetail'

export default function MarketingOperationsHandoffPage() {
  const scope = useScope()
  const params = useParams()
  const businessId = scope.shell.activeBusinessId
  const handoffId = Array.isArray(params?.handoffId) ? params.handoffId[0] : params?.handoffId
  return <Suspense fallback={<main className="mx-auto max-w-6xl p-5"><LoadingCard /></main>}><OperationsHandoffDetail key={`${businessId || 'no-business'}:${handoffId}`} businessId={businessId} handoffId={handoffId} /></Suspense>
}
