'use client'

// Universal "All Work" view — neutral vocabulary only (work items, streams,
// containers). Mode-specific words live in execution views.

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { DataTable, StatusPill, EmptyState, ErrorState } from '@/components/ui'
import { WORK_STATUSES, ITEM_SUBTYPES, MODE_LABELS } from '@/lib/validation/enums'
import { useFetch, LoadingCard } from '../../components/useApi'
import StatusSelect from '../../components/StatusSelect'

export default function AllWorkView({ projectId }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [subtype, setSubtype] = useState('')
  const [mode, setMode] = useState('')

  const params = new URLSearchParams()
  if (projectId) params.set('projectId', projectId)
  if (status) params.set('status', status)
  if (subtype) params.set('subtype', subtype)
  if (mode) params.set('executionMode', mode)
  const { data, loading, error, reload } = useFetch(`/api/work?${params.toString()}`)

  const rows = useMemo(() => {
    if (!data) return []
    const query = q.trim().toLowerCase()
    if (!query) return data
    return data.filter(
      (r) => r.title.toLowerCase().includes(query) || r.code.toLowerCase().includes(query)
    )
  }, [data, q])

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            className="input pl-8"
            placeholder="Search work items…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search work items"
          />
        </label>
        <select className="input w-auto" value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Filter by execution mode">
          <option value="">All modes</option>
          {Object.entries(MODE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
          <option value="">All statuses</option>
          {WORK_STATUSES.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
        <select className="input w-auto" value={subtype} onChange={(e) => setSubtype(e.target.value)} aria-label="Filter by type">
          <option value="">All types</option>
          {ITEM_SUBTYPES.map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, ' ')}</option>
          ))}
        </select>
      </div>
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {!loading && !error && (
        <DataTable
          columns={[
            { key: 'code', label: 'Code' },
            { key: 'title', label: 'Work item' },
            { key: 'subtype', label: 'Type', render: (r) => r.subtype.replace(/_/g, ' ') },
            { key: 'stream', label: 'Stream', render: (r) => `${r.workstream?.code || ''}` },
            { key: 'project', label: 'Project', render: (r) => r.workstream?.project?.code || '' },
            { key: 'mode', label: 'Mode', render: (r) => MODE_LABELS[r.workstream?.executionMode] || '' },
            { key: 'weight', label: 'Weight' },
            {
              key: 'status',
              label: 'Status',
              render: (r) => (
                <StatusSelect entity="work" id={r.id} value={r.status} statuses={WORK_STATUSES} onChanged={reload} />
              ),
            },
          ]}
          rows={rows}
          empty={<EmptyState title="No work items match" hint="Adjust filters or add items from an execution view." />}
        />
      )}
    </div>
  )
}
