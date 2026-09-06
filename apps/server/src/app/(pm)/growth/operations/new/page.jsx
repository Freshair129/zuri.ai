'use client'

// @req FR-161 — New Intake is a Marketing-owned request form; it does not
// create PM, CRM, Commerce or provider records.
// @spec SDD-089, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-operations-ui.test.js

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PageHeader } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, useFetch } from '@/modules/project-manager/components/useApi'
import { InlineNotice, MarketingDataState, ScopeNotice } from '@/modules/marketing/components/MarketingState'
import OperationsIntakeForm from '@/modules/marketing/components/operations/OperationsIntakeForm'
import { operationsCollectionPath, intakePagePath } from '@/modules/marketing/components/operations/operations-contract'

export default function NewMarketingOperationsIntakePage() {
  const scope = useScope()
  const router = useRouter()
  const businessId = scope.shell.activeBusinessId
  const capability = useFetch(businessId ? operationsCollectionPath(businessId) : null, [businessId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  if (!businessId) return <ScopeNotice />
  const create = async (fields) => {
    setBusy(true); setError(null)
    try {
      const result = await api('/api/growth/operations', { method: 'POST', body: { businessId, ...fields } })
      const created = result?.intake || result
      if (!created?.id) throw new Error('Marketing intake creation did not return an identity.')
      router.replace(intakePagePath(created.id))
    } catch (requestError) { setError(requestError.message); throw requestError } finally { setBusy(false) }
  }
  return <main className="mx-auto max-w-6xl p-5 max-md:p-3">
    <PageHeader eyebrow="MARKETING / OPERATIONS" title="New marketing intake" subtitle="Route a request to the right capability owner before PM work is created." actions={<Link href="/growth/operations?tab=intake" className="btn">Cancel</Link>} />
    <MarketingDataState loading={capability.loading && !capability.data} error={capability.error} retry={capability.reload}>
      {capability.data?.canWrite !== true ? <InlineNotice>Creating an Operations intake requires Business owner access.</InlineNotice> : <OperationsIntakeForm busy={busy} onSubmit={create} onCancel={() => router.replace('/growth/operations?tab=intake')} />}
      {error && <div className="mt-3"><InlineNotice tone="error">{error}</InlineNotice></div>}
    </MarketingDataState>
  </main>
}
