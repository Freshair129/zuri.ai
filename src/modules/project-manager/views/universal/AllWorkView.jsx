'use client'

// Universal "All Work" view — neutral vocabulary only (work items, streams,
// containers). Mode-specific words live in execution views.

// @req FR-005 — one component serves both scopes FR-005 declares: the global
// browser at `/work` and the project-scoped one at `/projects/{id}/all-work`.
// The `projectId` prop is that scope, and it decides the filter *and* the
// columns — the two instances are not cosmetically different, they answer
// different questions.
// @spec NFR-008 — the drill-down link's text is a project code, which tells a
// screen reader nothing about where it goes, so it carries an explicit label.
// @tested tests/unit/global-view-drilldown.test.js

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Search } from 'lucide-react'
import { DataTable, StatusPill, EmptyState, ErrorState, TruncationNotice } from '@/components/ui'
import { WORK_STATUSES, ITEM_SUBTYPES, MODE_LABELS } from '@/lib/validation/enums'
import { useFetch, LoadingCard } from '../../components/useApi'
import StatusSelect from '../../components/StatusSelect'

/**
 * The Project cell of a global row: the project's code, linked into the same
 * view scoped to that project.
 *
 * @req FR-005 — the two scopes of this view were reachable only upward: a
 * project-scoped page has an "All projects" button, but a global row naming a
 * project offered no way into it. This is that missing downward edge.
 *
 * `listWork` already selects `workstream.project.id` next to `code`, so the id
 * is in the payload. It is still checked rather than assumed: a row whose
 * workstream or project is absent from a response must degrade to plain text,
 * because interpolating a missing id yields `/projects/undefined/all-work` — a
 * link that looks live and 404s on click. A cell with no code renders nothing.
 */
export function projectDrilldownCell(row) {
  const project = row?.workstream?.project
  const code = project?.code || ''
  if (!code || !project?.id) return code
  return (
    <Link
      className="font-bold hover:text-brand-dark"
      href={`/projects/${project.id}/all-work`}
      aria-label={`View all work in project ${code}`}
    >
      {code}
    </Link>
  )
}

/**
 * @req FR-005 — the column set is scope-dependent, not constant.
 *
 * In GLOBAL scope the Project column is what makes a row locatable, so it
 * becomes the drill-down. In PROJECT scope the column is **dropped**, not
 * merely de-linked: every row would repeat one constant the page header, the
 * project tab bar and the breadcrumb have already established. A column that
 * cannot distinguish any two rows in its own table is noise, and it costs
 * width in a table that is otherwise seven columns wide.
 */
export function buildWorkColumns({ projectId, onStatusChanged } = {}) {
  return [
    { key: 'code', label: 'Code' },
    { key: 'title', label: 'Work item' },
    { key: 'subtype', label: 'Type', render: (r) => r.subtype.replace(/_/g, ' ') },
    { key: 'stream', label: 'Stream', render: (r) => `${r.workstream?.code || ''}` },
    ...(projectId ? [] : [{ key: 'project', label: 'Project', render: projectDrilldownCell }]),
    { key: 'mode', label: 'Mode', render: (r) => MODE_LABELS[r.workstream?.executionMode] || '' },
    { key: 'weight', label: 'Weight' },
    {
      key: 'status',
      label: 'Status',
      render: (r) => (
        <StatusSelect entity="work" id={r.id} value={r.status} statuses={WORK_STATUSES} onChanged={onStatusChanged} />
      ),
    },
  ]
}

import { Plus, Sparkles, UploadCloud } from 'lucide-react'
import StandaloneTaskModal from '../../components/StandaloneTaskModal'
import PlanModeCustomizerModal from '../../components/PlanModeCustomizerModal'
import UploadPlanModal from '../../components/UploadPlanModal'

export default function AllWorkView({ projectId }) {
  const [q, setQ] = useState('')
  const [status, setStatus] = useState('')
  const [subtype, setSubtype] = useState('')
  const [mode, setMode] = useState('')

  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [planModalOpen, setPlanModalOpen] = useState(false)
  const [uploadModalOpen, setUploadModalOpen] = useState(false)

  const params = new URLSearchParams()
  if (projectId) params.set('projectId', projectId)
  if (status) params.set('status', status)
  if (subtype) params.set('subtype', subtype)
  if (mode) params.set('executionMode', mode)
  const { data, loading, error, reload } = useFetch(`/api/work?${params.toString()}`)

  // @req FR-005 — `/api/work` returns { items, limit, truncated } so the cap it
  // applied is visible. This search box filters CLIENT-side over exactly those
  // items, which is why an undisclosed cap mattered here: past the limit, typing
  // a query returned "no work items match" for work that exists.
  const rows = useMemo(() => {
    const items = data?.items || []
    const query = q.trim().toLowerCase()
    if (!query) return items
    return items.filter(
      (r) => r.title.toLowerCase().includes(query) || r.code.toLowerCase().includes(query)
    )
  }, [data, q])

  return (
    <div>
      {/* Top Action Bar for Unbundled Work/Plan Intake */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ECEEF1] bg-white p-3 shadow-sm">
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="btn btn-primary flex items-center gap-1.5 text-xs font-semibold"
            onClick={() => setTaskModalOpen(true)}
          >
            <Plus size={14} /> + New Task
          </button>
          <button
            type="button"
            className="btn flex items-center gap-1.5 text-xs font-semibold text-amber-900 border-amber-300 bg-amber-50 hover:bg-amber-100"
            onClick={() => setPlanModalOpen(true)}
          >
            <Sparkles size={14} className="text-amber-600" /> ✨ Plan Mode (7 Execution Modes)
          </button>
          <button
            type="button"
            className="btn flex items-center gap-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            onClick={() => setUploadModalOpen(true)}
          >
            <UploadCloud size={14} /> 📥 Upload Plan (JSON/Excel)
          </button>
        </div>
        <div className="text-[11px] text-muted">
          <span>Decoupled Tasks & Multi-Agent Planning</span>
        </div>
      </div>

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
      {!loading && !error && data?.truncated && (
        <TruncationNotice
          limit={data.limit}
          noun="work items"
          hint="Narrow the filters above — the search box only searches what is listed here."
        />
      )}
      {!loading && !error && (
        <DataTable
          columns={buildWorkColumns({ projectId, onStatusChanged: reload })}
          rows={rows}
          empty={<EmptyState title="No work items match" hint="Create a task or generate a custom execution plan above." />}
        />
      )}

      {/* Modals */}
      <StandaloneTaskModal
        open={taskModalOpen}
        onClose={() => setTaskModalOpen(false)}
        onSaved={reload}
      />
      <PlanModeCustomizerModal
        open={planModalOpen}
        onClose={() => setPlanModalOpen(false)}
        onGenerated={reload}
      />
      <UploadPlanModal
        open={uploadModalOpen}
        onClose={() => setUploadModalOpen(false)}
        onUploaded={reload}
      />
    </div>
  )
}
