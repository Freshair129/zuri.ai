'use client'

// @req FR-161 — Intake detail re-checks the active Business identity before
// rendering the returned record.
// @spec SDD-089, SEC-001
// @tested tests/unit/marketing/marketing-operations-ui.test.js

import { Suspense } from 'react'
import { useParams } from 'next/navigation'
import { useScope } from '@/context/ScopeContext'
import { LoadingCard } from '@/modules/project-manager/components/useApi'
import OperationsIntakeDetail from '@/modules/marketing/components/operations/OperationsIntakeDetail'

export default function MarketingOperationsIntakePage() {
  const scope = useScope()
  const params = useParams()
  const businessId = scope.shell.activeBusinessId
  const intakeId = Array.isArray(params?.intakeId) ? params.intakeId[0] : params?.intakeId
  return <Suspense fallback={<main className="mx-auto max-w-6xl p-5"><LoadingCard /></main>}><OperationsIntakeDetail key={`${businessId || 'no-business'}:${intakeId}`} businessId={businessId} intakeId={intakeId} /></Suspense>
}
