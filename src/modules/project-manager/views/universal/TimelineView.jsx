'use client'

// Universal timeline: projects/workstreams/milestones on a month grid.
// Neutral vocabulary — "streams", not sprints.
// @req FR-064 — global Schedule reads the relation-rich compatibility view,
// while the Project list route remains a stable DTO boundary.
// @spec SDD-036
// @tested tests/unit/project-list-contract.test.js, tests/e2e/smoke.spec.js

import { differenceInDays, format, max, min } from 'date-fns'
import { Card, StatusPill, EmptyState, ErrorState } from '@/components/ui'
import { useFetch, LoadingCard } from '../../components/useApi'

function Bar({ label, start, end, rangeStart, rangeEnd, status, percent }) {
  const total = Math.max(1, differenceInDays(rangeEnd, rangeStart))
  const left = Math.max(0, (differenceInDays(start, rangeStart) / total) * 100)
  const width = Math.max(2, (Math.max(1, differenceInDays(end, start)) / total) * 100)
  return (
    <div className="grid grid-cols-[150px_1fr_auto] items-center gap-3 max-md:grid-cols-[100px_1fr_auto]">
      <p className="truncate text-[11px] font-bold">{label}</p>
      <div className="relative h-6 rounded-lg bg-surface-mid">
        <div
          className="absolute top-1 h-4 rounded-md"
          style={{
            left: `${Math.min(left, 96)}%`,
            width: `${Math.min(width, 100 - Math.min(left, 96))}%`,
            background: 'linear-gradient(90deg,var(--brand),var(--brand-hover))',
            opacity: status === 'DONE' ? 0.5 : 1,
          }}
          title={`${format(start, 'd MMM')} → ${format(end, 'd MMM yyyy')}`}
        />
      </div>
      <div className="flex items-center gap-2">
        {percent != null && <span className="text-[10px] font-bold">{percent}%</span>}
        <StatusPill status={status} />
      </div>
    </div>
  )
}

export default function TimelineView({ projectId }) {
  const url = projectId ? `/api/projects/${projectId}` : '/api/projects?view=timeline'
  const { data, loading, error, reload } = useFetch(url)

  if (loading) return <LoadingCard />
  if (error) return <ErrorState detail={error} retry={reload} />

  const projects = projectId ? (data ? [data] : []) : data || []
  const dated = []
  for (const p of projects) {
    const pStart = p.startAt ? new Date(p.startAt) : null
    const pEnd = p.targetAt ? new Date(p.targetAt) : null
    if (pStart && pEnd) dated.push({ label: p.code, start: pStart, end: pEnd, status: p.status, kind: 'project' })
    for (const m of p.milestones || []) {
      if (m.targetAt) {
        const t = new Date(m.targetAt)
        dated.push({ label: `◆ ${m.title}`, start: t, end: t, status: m.status, kind: 'milestone' })
      }
    }
  }
  if (dated.length === 0) {
    return <EmptyState title="Nothing scheduled" hint="Set start/target dates on projects and milestones to see the timeline." />
  }
  const rangeStart = min(dated.map((d) => d.start))
  const rangeEnd = max(dated.map((d) => d.end))

  return (
    <Card>
      <p className="mb-3 text-[10px] text-muted">
        {format(rangeStart, 'd MMM yyyy')} — {format(rangeEnd, 'd MMM yyyy')}
      </p>
      <div className="space-y-2.5">
        {dated.map((d, i) => (
          <Bar key={i} {...d} rangeStart={rangeStart} rangeEnd={rangeEnd} />
        ))}
      </div>
    </Card>
  )
}
