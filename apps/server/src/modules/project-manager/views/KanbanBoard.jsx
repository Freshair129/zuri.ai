'use client'

import { useMemo, useState } from 'react'
import { CircleDashed, CircleDot, Loader, Eye, Ban, CircleCheck, XCircle } from 'lucide-react'
import { useFetch, LoadingCard } from '../components/useApi'
import { ErrorState, TruncationNotice } from '@/components/ui'
import WorkpackageModal from '../components/WorkpackageModal'
import { WORK_STATUSES } from '@/lib/validation/enums'

// @req FR-063 — one column per value of WORK_STATUSES, derived from enums.js
// rather than a hand-written list, so a status can never render in no column.
// Presentation-only metadata (label/color/icon) keyed by status; membership and
// order come from WORK_STATUSES itself, not from this map.
const COLUMN_META = {
  PLANNED: { label: 'Backlog', color: '#9CA3AF', Icon: CircleDashed },
  READY: { label: 'To Do', color: '#3b82f6', Icon: CircleDot },
  IN_PROGRESS: { label: 'In Progress', color: '#2563eb', Icon: Loader },
  REVIEW: { label: 'In Review', color: '#f59e0b', Icon: Eye },
  BLOCKED: { label: 'Blocked', color: '#C84B4B', Icon: Ban },
  DONE: { label: 'Done', color: '#238553', Icon: CircleCheck },
  CANCELLED: { label: 'Cancelled', color: '#6B7280', Icon: XCircle },
}
const COLUMNS = WORK_STATUSES.map((key) => ({
  key,
  ...(COLUMN_META[key] || { label: key, color: '#9CA3AF', Icon: CircleDashed }),
}))

function Card({ item, onOpen }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(item)}
      className="w-full rounded-xl border border-[var(--border)] bg-[var(--surface-card)] p-3 text-left shadow-[0_1px_2px_rgba(16,24,40,0.04)] transition hover:-translate-y-px hover:border-[#c3c9d4] hover:shadow-md">
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
    </button>
  )
}

export default function KanbanBoard({ projectId }) {
  const { data, loading, error, reload } = useFetch(`/api/work?projectId=${projectId}`)
  const [selected, setSelected] = useState(null)

  const byStatus = useMemo(() => {
    const map = Object.fromEntries(COLUMNS.map((c) => [c.key, []]))
    for (const item of data?.items || []) {
      if (map[item.status]) map[item.status].push(item)
    }
    return map
  }, [data])

  if (loading) return <LoadingCard />
  if (error) return <ErrorState detail={error} retry={reload} />

  return (
    <>
    {/* @req FR-005 — the board is capped by the same listing as the table. A
        board silently missing cards reads as "there is no such work", which is
        exactly what FR-063 exists to prevent one level down. */}
    {data?.truncated && (
      <TruncationNotice limit={data.limit} noun="work items" hint="Some cards are not on this board." />
    )}
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
                items.map((it) => <Card key={it.id} item={it} onOpen={setSelected} />)
              )}
            </div>
          </div>
        )
      })}
    </div>
    <WorkpackageModal key={selected?.id} open={!!selected} item={selected} onClose={() => setSelected(null)} onSaved={reload} />
    </>
  )
}
