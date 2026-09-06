'use client'

// @req FR-162 — Intake detail guards response identity, preserves optimistic
// version writes and archives through the Marketing owner service.
// @spec SDD-089, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-operations-ui.test.js

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { ArrowLeft } from 'lucide-react'
import { Card, ErrorState, PageHeader, StatusPill } from '@/components/ui'
import { LoadingCard, api, useFetch } from '@/modules/project-manager/components/useApi'
import { InlineNotice, MarketingDataState, ScopeNotice } from '../MarketingState'
import { intakePagePath, operationsIntakePath } from './operations-contract'
import OperationsIntakeForm from './OperationsIntakeForm'

export default function OperationsIntakeDetail({ businessId, intakeId }) {
  const router = useRouter()
  const detail = useFetch(businessId && intakeId ? operationsIntakePath(intakeId, businessId) : null, [businessId, intakeId])
  const intake = detail.data?.intake?.id === intakeId && detail.data?.intake?.businessId === businessId ? detail.data.intake : null
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const update = async (fields) => {
    setBusy(true); setError(null)
    try { await api(operationsIntakePath(intake.id, businessId), { method: 'PATCH', body: { action: 'update', businessId, expectedVersion: intake.version, fields } }); await detail.reload() } catch (requestError) { setError(requestError.message) } finally { setBusy(false) }
  }
  const archive = async () => {
    setBusy(true); setError(null)
    try { await api(operationsIntakePath(intake.id, businessId), { method: 'PATCH', body: { action: 'archive', businessId, expectedVersion: intake.version } }); router.replace('/growth/operations?tab=intake') } catch (requestError) { setError(requestError.message); setBusy(false) }
  }
  if (!businessId) return <ScopeNotice />
  if (detail.loading && !intake) return <main className="mx-auto max-w-6xl p-5"><LoadingCard /></main>
  if (detail.error) return <main className="mx-auto max-w-6xl p-5"><ErrorState title="Marketing intake unavailable" detail={detail.error} retry={detail.reload} /></main>
  if (!intake) return <main className="mx-auto max-w-6xl p-5"><ErrorState title="Marketing intake unavailable" detail="The requested intake does not belong to the active Business scope." retry={detail.reload} /></main>
  return <main className="mx-auto max-w-6xl p-5 max-md:p-3">
    <PageHeader eyebrow="MARKETING / OPERATIONS / INTAKE" title={intake.title} subtitle={intake.objective} actions={<StatusPill status={intake.status} />} />
    <div className="mb-4 flex flex-wrap gap-2"><Link href="/growth/operations?tab=intake" className="btn"><ArrowLeft size={13} aria-hidden /> Back to Intake</Link>{intake.status !== 'ARCHIVED' && <button type="button" className="btn" onClick={archive} disabled={busy}>Archive</button>}</div>
    {error && <div className="mb-4"><InlineNotice tone="error">{error}</InlineNotice></div>}
    <MarketingDataState loading={false} error={null} retry={detail.reload}>
      {intake.status === 'ARCHIVED' ? <Card><InlineNotice>This intake is archived and read-only.</InlineNotice></Card> : <OperationsIntakeForm value={intake} busy={busy} submitLabel="Save changes" onSubmit={update} onCancel={() => router.push('/growth/operations?tab=intake')} />}
      <Card className="mt-4"><dl className="grid gap-3 text-xs md:grid-cols-2"><div><dt className="text-muted">Capability owner</dt><dd className="font-semibold">{intake.capability}</dd></div><div><dt className="text-muted">Required date</dt><dd className="font-semibold">{intake.requiredAt ? new Date(intake.requiredAt).toLocaleDateString('en-GB') : 'No date'}</dd></div><div><dt className="text-muted">Responsible owner ID</dt><dd className="font-semibold">{intake.responsibleOwnerId || 'Unassigned'}</dd></div><div><dt className="text-muted">Version</dt><dd className="font-semibold">{intake.version}</dd></div><div className="md:col-span-2"><dt className="text-muted">Evidence reference</dt><dd className="font-semibold">{intake.evidenceReference || 'No evidence reference'}</dd></div></dl></Card>
    </MarketingDataState>
  </main>
}
