'use client'

// @req FR-157 — Content collection presents briefs, PM production and usable
// approved revisions under one Business-scoped URL tab row.
// @spec ZAI:FR-157-NOTE — production is a PM projection and Library filters on
// server-authoritative approval eligibility; no mockup rows are synthesized.
// @tested tests/unit/marketing-content-ui.test.js, tests/e2e/marketing-content.spec.js

import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Card, DataTable, EmptyState, PageHeader, StatusPill, TruncationNotice } from '@/components/ui'
import { useFetch } from '@/modules/project-manager/components/useApi'
import { MarketingDataState, ScopeNotice, UnavailableState } from '../MarketingState'
import { MarketingTabs } from '../MarketingTabs'
import {
  CONTENT_TABS,
  contentApprovalLabel,
  contentBriefPagePath,
  contentBriefRows,
  contentCollectionPagePath,
  contentCollectionPath,
  contentFormatLabel,
  contentLibraryRows,
  contentOwnerLabel,
  contentProductionRows,
  currentContentVersion,
  formatContentDate,
  productionStage,
  productionStageLabel,
  contentAssetPagePath,
} from './content-contract'

function responseForScope(data, businessId) {
  if (!data) return null
  if (data.businessId && data.businessId !== businessId) return null
  return data
}

function versionPayload(row) {
  return currentContentVersion(row)?.payload || row?.payload || {}
}

function briefIdFor(row) {
  return row?.briefId || row?.contentBriefId || row?.brief?.id || row?.content?.briefId || null
}

function assetVersionFor(row) {
  return row?.assetVersion || null
}

function assetVersionIdFor(row) {
  return assetVersionFor(row)?.id || null
}

function titleFor(row) {
  return row?.title || row?.brief?.title || row?.contentBrief?.title || 'Untitled content'
}

function truncationFor(data) {
  return data?.truncated === true
}

function BriefList({ data, query }) {
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return contentBriefRows(data).filter((row) => !needle || [titleFor(row), row.code, row.status, row.phase, contentFormatLabel(versionPayload(row).format)].join(' ').toLowerCase().includes(needle))
  }, [data, query])
  if (!contentBriefRows(data).length) return <UnavailableState title="No creative briefs yet" hint="Create a brief when the objective, audience, message and acceptance evidence are ready." />
  if (!rows.length) return <EmptyState title="No briefs match" hint="Change the search text." />
  const columns = [
    { key: 'title', label: 'Brief', render: (row) => <Link className="font-semibold underline-offset-2 hover:underline" href={contentBriefPagePath(row.id)}>{titleFor(row)}</Link> },
    { key: 'initiative', label: 'Campaign', render: (row) => row.initiative?.title || row.campaign?.title || 'No Campaign reference' },
    { key: 'format', label: 'Format', render: (row) => contentFormatLabel(versionPayload(row).format) },
    { key: 'owner', label: 'Owner', render: contentOwnerLabel },
    { key: 'revision', label: 'Revision', render: (row) => `v${row.currentRevision || currentContentVersion(row)?.revision || 1}` },
    { key: 'phase', label: 'Phase', render: (row) => <StatusPill status={row.phase || row.status || 'DRAFT'} /> },
  ]
  return <Card data-testid="marketing-content-brief-list"><DataTable columns={columns} rows={rows} rowKey={(row) => row.id} /></Card>
}

function ProductionCard({ item }) {
  const briefId = briefIdFor(item)
  const target = briefId ? contentBriefPagePath(briefId) : null
  const body = <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-3"><div className="flex items-start justify-between gap-2"><p className="min-w-0 truncate text-xs font-semibold">{item.title || item.name || 'Work item unavailable'}</p><StatusPill status={item.status || 'UNKNOWN'} /></div><p className="mt-1 text-[10px] text-muted">{item.code || item.workItemId || 'WorkItem reference unavailable'}{item.owner?.displayName ? ` · ${item.owner.displayName}` : ''}</p><p className="mt-1 text-[10px] text-muted">Start {formatContentDate(item.startAt)} · Target {formatContentDate(item.targetAt || item.dueAt)}</p>{item.evidence?.label && <p className="mt-1 text-[10px] text-muted">Evidence: {item.evidence.label}</p>}</div>
  return target ? <Link href={target} className="block hover:opacity-80">{body}</Link> : body
}

function ProductionBoard({ rows }) {
  return <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" data-testid="marketing-content-production-board">
    {['READY', 'IN_PROGRESS', 'REVIEW', 'DONE', 'OTHER'].map((stage) => {
      const items = rows.filter((item) => productionStage(item.status) === stage)
      return <section key={stage} className="min-h-32 rounded-xl bg-[var(--surface-mid)] p-2" aria-labelledby={`content-production-${stage}`}><div className="mb-2 flex items-center justify-between gap-2 px-1"><h2 id={`content-production-${stage}`} className="text-[11px] font-bold">{productionStageLabel(stage)}</h2><span className="text-[10px] text-muted">{items.length}</span></div><div className="space-y-2">{items.map((item) => <ProductionCard key={item.workItemId || item.id} item={item} />)}{items.length === 0 && <p className="px-1 py-3 text-[10px] text-muted">No work items recorded</p>}</div></section>
    })}
  </div>
}

function ProductionList({ rows }) {
  const columns = [
    { key: 'title', label: 'Work item', render: (row) => briefIdFor(row) ? <Link className="font-semibold underline-offset-2 hover:underline" href={contentBriefPagePath(briefIdFor(row))}>{row.title || row.name || 'Work item unavailable'}</Link> : (row.title || row.name || 'Work item unavailable') },
    { key: 'project', label: 'Project', render: (row) => row.project?.name || row.projectName || 'Project unavailable' },
    { key: 'status', label: 'Status', render: (row) => <StatusPill status={row.status || 'UNKNOWN'} /> },
    { key: 'start', label: 'Start', render: (row) => formatContentDate(row.startAt) },
    { key: 'target', label: 'Target', render: (row) => formatContentDate(row.targetAt || row.dueAt) },
  ]
  return <Card data-testid="marketing-content-production-list"><DataTable columns={columns} rows={rows} rowKey={(row) => row.workItemId || row.id} /></Card>
}

function ProductionView({ data, view, setView }) {
  const rows = contentProductionRows(data)
  if (!rows.length) return <UnavailableState title="No production work recorded" hint="Production is read from the selected Business Project Manager records." />
  return <div><div className="mb-3 flex justify-end"><div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-1" role="group" aria-label="Content production presentation">{['board', 'list'].map((value) => <button key={value} type="button" className={`rounded-md px-3 py-2 text-xs font-semibold ${view === value ? 'bg-[var(--brand-tint)] text-[var(--brand-dark)]' : 'text-muted'}`} aria-pressed={view === value} onClick={() => setView(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}</div></div>{view === 'board' ? <ProductionBoard rows={rows} /> : <ProductionList rows={rows} />}</div>
}

function LibraryCard({ row }) {
  const version = assetVersionFor(row)
  const payload = version?.payload || row?.payload || {}
  const rights = payload.rights || row.rights || null
  const assetVersionId = assetVersionIdFor(row)
  if (!assetVersionId) return null
  return <Link href={contentAssetPagePath(assetVersionId)} className="block rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-4 hover:bg-[var(--brand-surface)]"><div className="flex items-start justify-between gap-2"><p className="truncate text-sm font-bold">{titleFor(row)}</p><StatusPill status="APPROVED" /></div><p className="mt-1 text-[10px] text-muted">{contentFormatLabel(payload.format)} · revision {version?.revision || row.revision || 'unavailable'}</p><p className="mt-3 text-[11px] text-muted">{rights?.holder || 'Rights holder unavailable'} · {rights?.validUntil ? `usage through ${formatContentDate(rights.validUntil)}` : 'Usage window unavailable'}</p><p className="mt-1 text-[10px] text-muted">{contentApprovalLabel(row.approval)}</p></Link>
}

function LibraryView({ data }) {
  const rows = contentLibraryRows(data)
  if (!rows.length) return <UnavailableState title="No approved creative is usable" hint="Library only shows current revisions with a valid approval, live FileAsset and active rights window." />
  return <div className="grid gap-3 md:grid-cols-2" data-testid="marketing-content-library">{rows.map((row) => <LibraryCard key={assetVersionIdFor(row)} row={row} />)}</div>
}

export default function ContentCollection({ businessId, tab = 'briefs' }) {
  const [query, setQuery] = useState('')
  const [productionView, setProductionView] = useState('board')
  const dataRequest = useFetch(businessId ? contentCollectionPath(businessId) : null, [businessId])
  const data = responseForScope(dataRequest.data, businessId)
  const canWrite = data?.canWrite === true
  const hrefForTab = (nextTab) => contentCollectionPagePath(nextTab, { query })

  if (!businessId) return <ScopeNotice />
  return <main className="mx-auto max-w-6xl p-5 max-md:p-3">
    <PageHeader eyebrow="MARKETING / CONTENT & CREATIVE" title="Content & Creative" subtitle="Brief intent, PM production and approved creative references stay connected to their owner services." actions={canWrite && <Link href="/growth/content/new" className="btn btn-primary"><Plus size={14} aria-hidden /> New brief</Link>} />
    <MarketingTabs tabs={CONTENT_TABS} activeKey={tab} hrefForTab={hrefForTab} ariaLabel="Marketing content sections" />
    <MarketingDataState loading={dataRequest.loading && !data} error={dataRequest.error} retry={dataRequest.reload}>
      <div className="mb-4 flex flex-wrap items-end gap-2"><label className="min-w-[220px] flex-1"><span className="mb-1 block text-[11px] font-bold text-muted">Search content</span><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search visible briefs" /></label>{tab === 'production' && <span className="text-[10px] text-muted">Work status and dates come from Project Manager.</span>}</div>
      {truncationFor(data) && <TruncationNotice shown={tab === 'briefs' ? contentBriefRows(data).length : tab === 'production' ? contentProductionRows(data).length : contentLibraryRows(data).length} limit={100} noun={tab === 'briefs' ? 'briefs' : tab === 'production' ? 'work items' : 'approved creative'} hint="Search within the bounded records returned for this Business." />}
      {tab === 'briefs' && <BriefList data={data} query={query} />}
      {tab === 'production' && <ProductionView data={data} view={productionView} setView={setProductionView} />}
      {tab === 'library' && <LibraryView data={data} />}
    </MarketingDataState>
  </main>
}
