'use client'

// @req FR-162 — one Operations collection renders Intake, Calendar, Approvals
// and Handoffs from a single aggregate response with explicit source states.
// @spec SDD-089, SEC-001, SEC-003
// @tested tests/unit/marketing/marketing-operations-ui.test.js

import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Card, DataTable, EmptyState, PageHeader, StatusPill, TruncationNotice } from '@/components/ui'
import { useFetch } from '@/modules/project-manager/components/useApi'
import { InlineNotice, MarketingDataState, ScopeNotice, UnavailableState } from '../MarketingState'
import { MarketingTabs } from '../MarketingTabs'
import {
  OPERATIONS_TABS,
  formatOperationsDate,
  handoffPagePath,
  intakePagePath,
  operationsCollectionPath,
  operationsPagePath,
  sectionFor,
} from './operations-contract'

function responseForScope(data, businessId) {
  return data?.businessId === businessId ? data : null
}

function SourceState({ section, noun }) {
  if (section.state === 'UNAVAILABLE' || section.state === 'FORBIDDEN') return <UnavailableState title={`${noun} is ${section.state.toLowerCase()}`} hint={section.warnings?.[0] || 'The owner source did not authorize this projection.'} />
  if (section.state === 'STALE') return <InlineNotice>{noun} is stale. Refresh the owner source before acting.</InlineNotice>
  if (section.state === 'PARTIAL') return <InlineNotice>{noun} is partial. Some source rows are unavailable and remain visible as unavailable.</InlineNotice>
  if (!section.rows?.length) return <EmptyState title={`No ${noun.toLowerCase()} yet`} hint="Create or connect the owner record before this view can show rows." />
  return null
}

function IntakeView({ section, query }) {
  const rows = useMemo(() => section.rows.filter((row) => !query || [row.title, row.capability, row.objective, row.status].join(' ').toLowerCase().includes(query.toLowerCase())), [section.rows, query])
  const empty = SourceState({ section: { ...section, rows }, noun: 'Intake requests' })
  if (empty) return empty
  return <Card data-testid="marketing-operations-intake-list"><DataTable columns={[
    { key: 'title', label: 'Request', render: (row) => <Link className="font-semibold underline-offset-2 hover:underline" href={intakePagePath(row.id)}>{row.title}</Link> },
    { key: 'capability', label: 'Capability', render: (row) => row.capability },
    { key: 'requiredAt', label: 'Required', render: (row) => formatOperationsDate(row.requiredAt) },
    { key: 'status', label: 'Status', render: (row) => <StatusPill status={row.status} /> },
  ]} rows={rows} rowKey={(row) => row.id} /></Card>
}

function CalendarView({ section }) {
  const empty = SourceState({ section, noun: 'Calendar delivery records' })
  if (empty) return empty
  return <Card data-testid="marketing-operations-calendar"><DataTable columns={[
    { key: 'title', label: 'PM record', render: (row) => row.projectId ? <Link className="font-semibold underline-offset-2 hover:underline" href={`/projects/${encodeURIComponent(row.projectId)}/roadmap`}>{row.title}</Link> : row.title },
    { key: 'recordType', label: 'Type', render: (row) => row.recordType },
    { key: 'targetAt', label: 'Target', render: (row) => formatOperationsDate(row.targetAt) },
    { key: 'status', label: 'Status', render: (row) => <StatusPill status={row.status || 'UNKNOWN'} /> },
  ]} rows={section.rows} rowKey={(row) => row.id} /></Card>
}

function ApprovalsView({ section }) {
  const empty = SourceState({ section, noun: 'Approval records' })
  if (empty) return empty
  return <Card data-testid="marketing-operations-approvals"><DataTable columns={[
    { key: 'title', label: 'Approval', render: (row) => row.title },
    { key: 'sourceType', label: 'Source', render: (row) => row.sourceType },
    { key: 'revision', label: 'Revision', render: (row) => `v${row.revision}` },
    { key: 'status', label: 'Status', render: (row) => <StatusPill status={row.status} /> },
    { key: 'updatedAt', label: 'Updated', render: (row) => formatOperationsDate(row.updatedAt) },
  ]} rows={section.rows} rowKey={(row) => row.id} /></Card>
}

function HandoffsView({ section }) {
  const empty = SourceState({ section, noun: 'Handoff receipts' })
  if (empty) return empty
  return <Card data-testid="marketing-operations-handoffs"><DataTable columns={[
    { key: 'title', label: 'Handoff', render: (row) => <Link className="font-semibold underline-offset-2 hover:underline" href={handoffPagePath(row.id)}>{row.title}</Link> },
    { key: 'projectId', label: 'PM project', render: (row) => row.projectId || 'Unavailable' },
    { key: 'status', label: 'Receipt', render: (row) => <StatusPill status={row.status} /> },
    { key: 'createdAt', label: 'Requested', render: (row) => formatOperationsDate(row.createdAt) },
  ]} rows={section.rows} rowKey={(row) => row.id} /></Card>
}

export default function OperationsCollection({ businessId, tab = 'intake' }) {
  const [query, setQuery] = useState('')
  const dataRequest = useFetch(businessId ? operationsCollectionPath(businessId, tab) : null, [businessId, tab])
  const data = responseForScope(dataRequest.data, businessId)
  const section = sectionFor(data, tab)
  const hrefForTab = (nextTab) => operationsPagePath(nextTab, query ? { q: query } : {})
  if (!businessId) return <ScopeNotice />
  return <main className="mx-auto max-w-6xl p-5 max-md:p-3">
    <PageHeader eyebrow="MARKETING / OPERATIONS" title="Marketing Operations" subtitle="Coordinate requests and inspect owner receipts without creating a second work system." actions={data?.canWrite && <Link href="/growth/operations/new" className="btn btn-primary"><Plus size={14} aria-hidden /> New intake</Link>} />
    <MarketingTabs tabs={OPERATIONS_TABS} activeKey={tab} hrefForTab={hrefForTab} ariaLabel="Marketing Operations sections" />
    <MarketingDataState loading={dataRequest.loading && !data} error={dataRequest.error} retry={dataRequest.reload}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><label className="min-w-[220px] flex-1"><span className="mb-1 block text-[11px] font-bold text-muted">Filter visible records</span><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search title, capability or status" /></label><span className="text-[10px] text-muted">Source updated {formatOperationsDate(section.lastUpdated || data?.generatedAt)}</span></div>
      {section.truncated && <TruncationNotice shown={section.rows.length} limit={100} noun="records" hint="Search within the bounded owner projection returned for this Business." />}
      {tab === 'intake' && <IntakeView section={section} query={query} />}
      {tab === 'calendar' && <CalendarView section={section} />}
      {tab === 'approvals' && <ApprovalsView section={section} />}
      {tab === 'handoffs' && <HandoffsView section={section} />}
    </MarketingDataState>
  </main>
}
