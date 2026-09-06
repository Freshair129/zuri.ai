'use client'

// @req FR-162 — Handoff detail renders an authorized receipt and PM roadmap
// projection, with unavailable source evidence visible as a distinct state.
// @spec SDD-089, FR-158, SEC-001
// @tested tests/unit/marketing/marketing-operations-ui.test.js

import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { Card, ErrorState, PageHeader, StatusPill } from '@/components/ui'
import { LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'
import { InlineNotice, MarketingDataState, ScopeNotice, UnavailableState } from '../MarketingState'
import { formatOperationsDate, operationsHandoffPath } from './operations-contract'

export default function OperationsHandoffDetail({ businessId, handoffId }) {
  const detail = useFetch(businessId && handoffId ? operationsHandoffPath(handoffId, businessId) : null, [businessId, handoffId])
  const handoff = detail.data?.handoff?.id === handoffId && detail.data?.businessId === businessId ? detail.data.handoff : null
  if (!businessId) return <ScopeNotice />
  if (detail.loading && !handoff) return <main className="mx-auto max-w-6xl p-5"><LoadingCard /></main>
  if (detail.error) return <main className="mx-auto max-w-6xl p-5"><ErrorState title="Handoff unavailable" detail={detail.error} retry={detail.reload} /></main>
  if (!handoff) return <main className="mx-auto max-w-6xl p-5"><ErrorState title="Handoff unavailable" detail="The requested handoff does not belong to the active Business scope." retry={detail.reload} /></main>
  const roadmap = handoff.roadmap
  return <main className="mx-auto max-w-6xl p-5 max-md:p-3">
    <PageHeader eyebrow="MARKETING / OPERATIONS / HANDOFF" title={handoff.title} subtitle="Validated owner receipt and PM roadmap projection." actions={<StatusPill status={handoff.status} />} />
    <div className="mb-4 flex flex-wrap gap-2"><Link href="/growth/operations?tab=handoffs" className="btn"><ArrowLeft size={13} aria-hidden /> Back to Handoffs</Link>{handoff.projectId && <Link href={`/projects/${encodeURIComponent(handoff.projectId)}/roadmap`} className="btn">Open PM roadmap</Link>}</div>
    <MarketingDataState loading={false} error={null} retry={detail.reload}>
      {handoff.status !== 'READY' && <UnavailableState title="Owner receipt unavailable" hint={handoff.reasonCode || 'The handoff did not pass owner validation.'} />}
      <Card className="mb-4"><dl className="grid gap-3 text-xs md:grid-cols-2"><div><dt className="text-muted">Project</dt><dd className="font-semibold">{handoff.projectId || 'Unavailable'}</dd></div><div><dt className="text-muted">Workspace</dt><dd className="font-semibold">{handoff.workspaceId || 'Unavailable'}</dd></div><div><dt className="text-muted">Receipt status</dt><dd className="font-semibold">{handoff.receipt?.status || 'Unavailable'}</dd></div><div><dt className="text-muted">Created</dt><dd className="font-semibold">{formatOperationsDate(handoff.createdAt)}</dd></div></dl></Card>
      {roadmap && <Card data-testid="marketing-operations-handoff-roadmap"><h2 className="mb-3 text-sm font-bold">PM roadmap projection</h2><div className="grid gap-3 md:grid-cols-3"><div><p className="text-[10px] text-muted">Project</p><p className="text-sm font-semibold">{roadmap.project?.name || 'Unavailable'}</p></div><div><p className="text-[10px] text-muted">Progress</p><p className="text-sm font-semibold">{roadmap.project?.progress ?? 'Unavailable'}%</p></div><div><p className="text-[10px] text-muted">Work items</p><p className="text-sm font-semibold">{roadmap.items?.length ?? 0}</p></div></div></Card>}
      {handoff.status === 'READY' && !roadmap && <InlineNotice>Receipt is valid but the PM roadmap returned no detail.</InlineNotice>}
    </MarketingDataState>
  </main>
}
