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

function formatThbFromSatang(value) {
  if (value === null || value === undefined || value === '') return 'UNAVAILABLE'
  const satang = Number(value)
  if (!Number.isFinite(satang)) return 'UNAVAILABLE'
  return `${(satang / 100).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} THB`
}

function measurementWindowLabel(window) {
  if (!window || typeof window !== 'object') return 'UNAVAILABLE (no window evidence)'
  const from = window.from ?? null
  const to = window.to ?? null
  if (from === null && to === null) return 'All time (from/to unbounded)'
  if (from === null) return `From all available history through ${to}`
  if (to === null) return `From ${from} onward (unbounded end)`
  return `${from} to ${to}`
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
          {metrics.map((metric) => <Card key={metric.key}><p className="break-words text-[10px] font-semibold text-muted">{metric.key}</p><p className="mt-1 text-lg font-bold">{metricValue(metric)}</p><p className="mt-1 break-all text-[10px] text-muted">{metric.reasonCode || 'No measurement source'}</p></Card>)}
        </div>
        <Card className="mb-5">
          <SectionTitle caption="Provider metrics are outside the approved source contract">Measurement status</SectionTitle>
          <p className="break-words rounded-lg bg-[var(--brand-tint)] p-3 text-xs" role="status">{data?.state || 'UNKNOWN'} — Paid metrics are unavailable; this view never substitutes zeros.</p>
          {revenue ? <div className="mt-3 min-w-0 text-xs"><p className="break-words">Verified Commerce revenue: {formatThbFromSatang(revenue.verifiedNet)}</p><p className="mt-1 break-words text-muted">Measurement window: {measurementWindowLabel(revenue)}</p></div> : <p className="mt-3 break-words text-xs text-muted">Verified Commerce revenue is unavailable in this scope.</p>}
          <SourceNote>Owner DTOs: Marketing, Integration and Commerce. CRM audience and ad providers are not called.</SourceNote>
        </Card>
        <Card>
          <SectionTitle caption="Each source retains its own state and evidence reference">Owner sources</SectionTitle>
          {sources.length === 0 ? <EmptyState title="No owner sources" hint="No permitted owner read returned a source in this Business." /> : <div className="space-y-2">{sources.map((item) => <div key={`${item.owner}-${item.source}`} className="flex items-start justify-between gap-3 rounded-lg border border-[var(--border)] p-3"><div className="min-w-0 flex-1"><p className="break-words text-xs font-bold">{item.owner} · {item.source}</p><p className="mt-1 break-all text-[10px] text-muted">{item.reasonCode || item.ref || 'No additional reference'}</p><p className="mt-1 break-words text-[10px] text-muted">Measurement window: {measurementWindowLabel(item.window)}</p></div><StatusPill status={item.state || 'UNKNOWN'} /></div>)}</div>}
        </Card>
      </MarketingDataState>
    </main>
  )
}
