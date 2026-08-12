'use client'

import { useMemo } from 'react'
import { CircleDashed, CircleDot, Loader, Eye, Ban, CircleCheck } from 'lucide-react'
import { useFetch, LoadingCard } from '../components/useApi'
import { ErrorState } from '@/components/ui'

// Work Execution board (Indest "Work") over real WorkItems, grouped by the seven
// canonical statuses. Read-only for now — status changes still go through the services.
const COLUMNS = [
  { key: 'PLANNED', label: 'Backlog', color: '#9CA3AF', Icon: CircleDashed },
  { key: 'READY', label: 'To Do', color: '#3b82f6', Icon: CircleDot },
  { key: 'IN_PROGRESS', label: 'In Progress', color: '#2563eb', Icon: Loader },
  { key: 'REVIEW', label: 'In Review', color: '#f59e0b', Icon: Eye },
  { key: 'BLOCKED', label: 'Blocked', color: '#C84B4B', Icon: Ban },
  { key: 'DONE', label: 'Done', color: '#238553', Icon: CircleCheck },
]

function Card({ item }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-3 shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:-translate-y-px hover:shadow-md">
      <div className="flex items-start justify-between gap-2">
        <span className="text-[8px] font-bold uppercase tracking-wider text-[var(--muted-2)]">Workpackage</span>
        <span className="rounded-md bg-[var(--surface-mid)] px-1.5 py-0.5 text-[8.5px] font-semibold text-[var(--muted)]">
          {item.subtype?.replace(/_/g, ' ')}
        </span>
      </div>
      <p className="mt-1 text-[13px] font-bold leading-snug text-[var(--text)]">{item.title}</p>
      <div className="mt-2 flex items-center justify-between text-[9px] text-muted">
        <span className="font-semibold">{item.workstream?.code || ''}</span>
        <span>w{item.weight}</span>
      </div>
    </div>
  )
}

export default function KanbanBoard({ projectId }) {
  const { data, loading, error, reload } = useFetch(`/api/work?projectId=${projectId}`)

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map((c) => [c.key, []]))
    for (const item of data || []) {
      if (map[item.status]) map[item.status].push(item)
    }
    return map
  }, [data])

  if (loading) return <LoadingCard />
  if (error) return <ErrorState detail={error} retry={reload} />

  return (
    <div className="flex gap-4 overflow-x-auto pb-4">
      {COLUMNS.map(({ key, label, color, Icon }) => {
        const items = byStatus[key] || []
        return (
          <div key={key} className="flex w-[260px] shrink-0 flex-col">
            <div className="mb-2 flex items-center gap-2 px-1">
              <Icon size={15} style={{ color }} aria-hidden />
              <span className="text-xs font-bold text-[var(--text)]">{label}</span>
              <span className="ml-auto rounded-md bg-[var(--surface-mid)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--muted)]">
                {items.length}
              </span>
            </div>
            <div className="flex min-h-[120px] flex-col gap-2 rounded-2xl bg-[var(--surface-mid)]/60 p-2">
              {items.length === 0 ? (
                <p className="grid h-24 place-items-center text-[10px] text-[var(--muted-2)]">No work packages</p>
              ) : (
                items.map((it) => <Card key={it.id} item={it} />)
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
