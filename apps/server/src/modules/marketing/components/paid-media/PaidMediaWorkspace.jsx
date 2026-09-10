'use client'

// @req FR-185 — Paid Media is an honest owner projection: unavailable metrics
// are visible without fixture rows or false zeros.
// @spec SDD-086, ADR-065
// @tested tests/e2e/marketing-p5.spec.js

import { Card, EmptyState, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { useFetch } from '@/modules/project-manager/components/useApi'
import { MarketingDataState, ScopeNotice, SourceNote } from '../MarketingState'

function metricValue(metric) {
  if (metric?.state !== 'READY' || metric.value === null || metric.value === undefined) return 'UNAVAILABLE'
  return String(metric.value)
}

export default function PaidMediaWorkspace({ businessId }) {
  const endpoint = businessId ? `/api/growth/paid-media?businessId=${encodeURIComponent(businessId)}` : null
  const { data, loading, error, reload } = useFetch(endpoint, [businessId])
  if (!businessId) return <ScopeNotice />
  const metrics = Array.isArray(data?.metrics) ? data.metrics : []
  const sources = Array.isArray(data?.sources) ? data.sources : []
  const revenue = data?.verifiedRevenue
  return (
    <main className="mx-auto max-w-6xl p-5 max-md:p-3">
      <PageHeader eyebrow="MARKETING" title="Paid Media" subtitle="Measured provider metrics appear only when an owner source supplies them." />
      <MarketingDataState loading={loading} error={error} retry={reload}>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {metrics.map((metric) => <Card key={metric.key}><p className="text-[10px] font-semibold text-muted">{metric.key}</p><p className="mt-1 text-lg font-bold">{metricValue(metric)}</p><p className="mt-1 text-[10px] text-muted">{metric.reasonCode}</p></Card>)}
        </div>
        <Card className="mb-5">
          <SectionTitle caption="Provider metrics are outside the approved source contract">Measurement status</SectionTitle>
          <p className="rounded-lg bg-[var(--brand-tint)] p-3 text-xs" role="status">{data?.state || 'UNKNOWN'} — Paid metrics are unavailable; this view never substitutes zeros.</p>
          {revenue ? <p className="mt-3 text-xs">Verified Commerce revenue: {revenue.verifiedNet ?? 'UNAVAILABLE'} ({revenue.from || 'all time'} to {revenue.to || 'today'})</p> : <p className="mt-3 text-xs text-muted">Verified Commerce revenue is unavailable in this scope.</p>}
          <SourceNote>Owner DTOs: Marketing, Integration and Commerce. CRM audience and ad providers are not called.</SourceNote>
        </Card>
        <Card>
          <SectionTitle caption="Each source retains its own state and evidence reference">Owner sources</SectionTitle>
          {sources.length === 0 ? <EmptyState title="No owner sources" hint="No permitted owner read returned a source in this Business." /> : <div className="space-y-2">{sources.map((item) => <div key={`${item.owner}-${item.source}`} className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border)] p-3"><div><p className="text-xs font-bold">{item.owner} · {item.source}</p><p className="mt-1 text-[10px] text-muted">{item.reasonCode || item.ref || 'No additional reference'}</p></div><StatusPill status={item.state} /></div>)}</div>}
        </Card>
      </MarketingDataState>
    </main>
  )
}
