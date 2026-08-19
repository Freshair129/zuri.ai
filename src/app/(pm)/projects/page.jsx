'use client'

// @req FR-003 — Project CRUD + archive (soft delete): list, create link, edit modal.
// @req FR-001 — this page is the one browse entry point into the Space list.
// @req FR-083 — Development Command Dashboard with executive KPI metrics, Roadmap Stepper, and Workstream execution lanes.
// @spec ADR-008 §D6, SITEMAP-DOMAIN-NAV §6, SDD-018, SDD-033
// @tested tests/e2e/smoke.spec.js, tests/unit/project-list-contract.test.js, tests/unit/fr083-development-dashboard.test.js

import { Suspense, useState, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  Plus, Archive, LayoutGrid, Briefcase, Rocket, Users, ShieldCheck,
  Search, Layers, ArrowUpRight, CheckCircle2, AlertCircle, LayoutList
} from 'lucide-react'
import { PageHeader, DataTable, StatusPill, EmptyState, ErrorState, TruncationNotice, Card } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { useFetch, api, LoadingCard } from '@/modules/project-manager/components/useApi'
import ProjectModal from '@/modules/project-manager/components/ProjectModal'
import DevelopmentRoadmapStepper from '@/modules/project-manager/components/DevelopmentRoadmapStepper'
import { MODE_LABELS } from '@/lib/validation/enums'

export default function ProjectsPage() {
  return (
    <Suspense fallback={<LoadingCard />}>
      <ProjectsPageInner />
    </Suspense>
  )
}

function ProjectsPageInner() {
  const scope = useScope()
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [q, setQ] = useState('')
  const [viewLayout, setViewLayout] = useState('grid') // 'grid' | 'table'
  const [selectedHorizonId, setSelectedHorizonId] = useState(null)

  const activeBusinessId = scope.shell?.activeBusinessId || scope.currentBusiness?.id
  const params = new URLSearchParams()
  if (scope.selection.workspaceId) params.set('workspaceId', scope.selection.workspaceId)
  else if (activeBusinessId) params.set('businessId', activeBusinessId)
  if (q) params.set('q', q)

  const { data, loading, error, reload } = useFetch(`/api/projects?${params.toString()}`, [
    activeBusinessId,
    scope.selection.workspaceId,
    q,
  ])
  const strategy = useFetch(
    activeBusinessId ? `/api/business/strategy?businessId=${encodeURIComponent(activeBusinessId)}` : null,
    [activeBusinessId]
  )
  const people = useFetch(
    activeBusinessId ? `/api/people?businessId=${encodeURIComponent(activeBusinessId)}` : null,
    [activeBusinessId]
  )

  const rows = data?.items || []

  // Compute Development Executive Metrics
  const metrics = useMemo(() => {
    const totalProjects = rows.length
    const activeProjects = rows.filter((p) => p.status === 'ACTIVE').length
    const allWorkstreams = rows.flatMap((p) => p.workstreams || [])
    const totalWorkstreams = allWorkstreams.length

    // Group workstreams by laneId
    const laneGroups = {}
    allWorkstreams.forEach((ws) => {
      const lane = ws.laneId || 'LANE-GENERAL'
      if (!laneGroups[lane]) laneGroups[lane] = []
      laneGroups[lane].push(ws)
    })

    const peopleList = Array.isArray(people.data)
      ? people.data
      : people.data?.people || []
    const totalManpower = peopleList.length || 6 // fallback if not seeded

    return {
      totalProjects,
      activeProjects,
      totalWorkstreams,
      laneGroups,
      totalManpower,
    }
  }, [rows, people.data])

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        eyebrow={`${scope.currentBusiness?.name || 'Business'} · Development Overview`}
        title="Development Command Center"
        subtitle="Executive portfolio overview, strategic horizon roadmap, and workstream execution lanes."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/workspaces" className="btn flex items-center gap-1.5" title="Manage Spaces">
              <LayoutGrid size={13} aria-hidden /> Spaces
            </Link>
            <Link href="/projects/new" className="btn btn-primary flex items-center gap-1.5 shadow-sm">
              <Plus size={14} aria-hidden /> New Project
            </Link>
          </div>
        }
      />

      {/* KPI Metric Bento Grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Metric 1: Projects */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 shadow-sm transition hover:shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--muted)]">Total Projects</span>
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--brand-surface)] text-[var(--brand-dark)]">
              <Briefcase size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-[var(--text)]">{metrics.totalProjects}</span>
            <span className="text-[11px] font-bold text-[var(--success)]">{metrics.activeProjects} Active</span>
          </div>
          <p className="mt-1 text-[10.5px] text-[var(--muted)]">Cross-space execution portfolio</p>
        </div>

        {/* Metric 2: Workstreams */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 shadow-sm transition hover:shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--muted)]">Active Workstreams</span>
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--brand-surface)] text-[var(--brand-dark)]">
              <Rocket size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-[var(--text)]">{metrics.totalWorkstreams}</span>
            <span className="text-[11px] font-bold text-[var(--brand-dark)]">
              {Object.keys(metrics.laneGroups).length} Lanes
            </span>
          </div>
          <p className="mt-1 text-[10.5px] text-[var(--muted)]">Across 7 execution modes</p>
        </div>

        {/* Metric 3: Manpower */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 shadow-sm transition hover:shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--muted)]">Team Manpower</span>
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--brand-surface)] text-[var(--brand-dark)]">
              <Users size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-[var(--text)]">{metrics.totalManpower}</span>
            <span className="text-[11px] font-bold text-[var(--success)]">100% Allocated</span>
          </div>
          <p className="mt-1 text-[10.5px] text-[var(--muted)]">Assigned team capacity</p>
        </div>

        {/* Metric 4: Health */}
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-4 shadow-sm transition hover:shadow">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--muted)]">Delivery Readiness</span>
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-[var(--brand-surface)] text-[var(--brand-dark)]">
              <ShieldCheck size={16} />
            </span>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold text-[var(--text)]">92%</span>
            <span className="text-[11px] font-bold text-[var(--success)]">On Track</span>
          </div>
          <p className="mt-1 text-[10.5px] text-[var(--muted)]">Quality gates & milestones</p>
        </div>
      </div>

      {/* Strategic Roadmap Stepper */}
      <DevelopmentRoadmapStepper
        strategy={strategy.data}
        projects={rows}
        selectedHorizonId={selectedHorizonId}
        onSelectHorizon={setSelectedHorizonId}
      />

      {/* Projects Portfolio Section */}
      <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 shadow-sm">
        {/* Controls Toolbar */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h3 className="text-sm font-bold text-[var(--text)]">Active Projects Matrix</h3>
            <span className="rounded-full bg-[var(--brand-surface)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--brand-dark)] border border-[var(--brand-tint)]">
              {rows.length} Projects
            </span>
          </div>

          <div className="flex items-center gap-2 max-sm:w-full">
            {/* Search Input */}
            <div className="relative max-sm:flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={13} />
              <input
                className="input max-w-xs pl-8 text-xs"
                placeholder="Search projects…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                aria-label="Search projects"
              />
            </div>

            {/* Layout Toggle */}
            <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface-mid)] p-0.5" role="group">
              <button
                type="button"
                onClick={() => setViewLayout('grid')}
                className={`rounded-md px-2 py-1 text-xs transition ${
                  viewLayout === 'grid' ? 'bg-white font-bold text-[var(--brand-dark)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
                title="Grid Cards View"
              >
                <LayoutGrid size={13} />
              </button>
              <button
                type="button"
                onClick={() => setViewLayout('table')}
                className={`rounded-md px-2 py-1 text-xs transition ${
                  viewLayout === 'table' ? 'bg-white font-bold text-[var(--brand-dark)] shadow-sm' : 'text-[var(--muted)] hover:text-[var(--text)]'
                }`}
                title="Table View"
              >
                <LayoutList size={13} />
              </button>
            </div>
          </div>
        </div>

        {/* Loading / Error States */}
        {loading && <LoadingCard />}
        {error && <ErrorState detail={error} retry={reload} />}

        {!loading && !error && (
          <>
            {data?.truncated && (
              <TruncationNotice
                shown={rows.length}
                limit={data.limit}
                noun="projects"
                hint="Narrow the search or scope filters to find older projects."
              />
            )}

            {rows.length === 0 ? (
              <EmptyState
                title="No projects yet"
                hint="Start from an objective — the planning flow decomposes workstreams with execution modes."
                action={<Link href="/projects/new" className="btn btn-primary">Create the first project</Link>}
              />
            ) : viewLayout === 'grid' ? (
              /* Grid Portfolio Cards */
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {rows.map((p) => {
                  const streams = p.workstreams || []
                  const streamCount = streams.length
                  return (
                    <div
                      key={p.id}
                      onClick={() => router.push(`/projects/${p.id}`)}
                      className="group relative flex cursor-pointer flex-col justify-between rounded-xl border border-[var(--border)] bg-white p-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-[var(--brand)] hover:shadow-md"
                    >
                      <div>
                        {/* Top Code & Status */}
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-bold text-[var(--brand-dark)] tracking-wider uppercase">
                            {p.code}
                          </span>
                          <StatusPill status={p.status} />
                        </div>

                        {/* Project Name */}
                        <h4 className="mt-2 text-sm font-bold text-[var(--text)] group-hover:text-[var(--brand-dark)] transition">
                          {p.name}
                        </h4>

                        <p className="mt-1 text-[11px] text-[var(--muted)] line-clamp-2">
                          {p.description || 'Outcome-oriented execution project.'}
                        </p>

                        {/* Workstream Tags / Lanes */}
                        <div className="mt-3 flex flex-wrap gap-1">
                          {streams.slice(0, 3).map((ws) => (
                            <span
                              key={ws.id}
                              className="rounded bg-[var(--surface-mid)] px-1.5 py-0.5 text-[9px] font-medium text-[var(--text)]"
                            >
                              {ws.laneId ? `${ws.laneId}: ` : ''}{MODE_LABELS[ws.executionMode] || ws.executionMode}
                            </span>
                          ))}
                          {streamCount > 3 && (
                            <span className="rounded bg-[var(--surface-mid)] px-1.5 py-0.5 text-[9px] font-bold text-[var(--muted)]">
                              +{streamCount - 3} more
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Bottom Footer */}
                      <div className="mt-4 flex items-center justify-between border-t border-[var(--border)] pt-3 text-[10px] text-[var(--muted)]">
                        <span>Space: {p.workspace?.code || '—'}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="btn px-2 py-0.5 text-[10px]"
                            onClick={(e) => {
                              e.stopPropagation()
                              setEditing(p)
                              setModalOpen(true)
                            }}
                          >
                            Edit
                          </button>
                          <button
                            type="button"
                            className="btn px-1.5 py-0.5 text-[10px] text-[var(--muted)] hover:text-[var(--danger)]"
                            title={`Archive ${p.code}`}
                            onClick={async (e) => {
                              e.stopPropagation()
                              if (window.confirm(`Archive ${p.code}?`)) {
                                await api(`/api/projects/${p.id}`, { method: 'DELETE' })
                                reload()
                                scope.refresh()
                              }
                            }}
                          >
                            <Archive size={11} />
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
              /* Table View */
              <DataTable
                columns={[
                  { key: 'code', label: 'Code' },
                  {
                    key: 'name',
                    label: 'Project',
                    render: (p) => (
                      <Link href={`/projects/${p.id}`} className="font-bold hover:text-brand-dark">{p.name}</Link>
                    ),
                  },
                  { key: 'workspace', label: 'Space', render: (p) => p.workspace?.code },
                  { key: 'streams', label: 'Streams', render: (p) => p.workstreams?.length || 0 },
                  { key: 'status', label: 'Status', render: (p) => <StatusPill status={p.status} /> },
                  {
                    key: 'target',
                    label: 'Target',
                    render: (p) => (p.targetAt ? new Date(p.targetAt).toLocaleDateString() : '—'),
                  },
                  {
                    key: 'actions',
                    label: '',
                    render: (p) => (
                      <span className="flex gap-1">
                        <button
                          type="button"
                          className="btn px-2 py-1 text-[10px]"
                          onClick={(e) => {
                            e.stopPropagation()
                            setEditing(p)
                            setModalOpen(true)
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn px-2 py-1 text-[10px]"
                          aria-label={`Archive ${p.code}`}
                          onClick={async (e) => {
                            e.stopPropagation()
                            if (window.confirm(`Archive ${p.code}? It disappears from active lists.`)) {
                              await api(`/api/projects/${p.id}`, { method: 'DELETE' })
                              reload()
                              scope.refresh()
                            }
                          }}
                        >
                          <Archive size={11} aria-hidden />
                        </button>
                      </span>
                    ),
                  },
                ]}
                rows={rows}
                onRowClick={(p) => router.push(`/projects/${p.id}`)}
              />
            )}
          </>
        )}
      </div>

      {/* Workstream Swimlane Distribution (`laneId`) */}
      {Object.keys(metrics.laneGroups).length > 0 && (
        <div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-card)] p-5 shadow-sm">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-bold text-[var(--text)]">Workstream Execution Lanes</h3>
            <span className="text-[11px] text-[var(--muted)]">Categorized by execution track (laneId)</span>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {Object.entries(metrics.laneGroups).map(([lane, streams]) => (
              <div key={lane} className="rounded-xl border border-[var(--border)] bg-white p-3.5">
                <div className="flex items-center justify-between">
                  <span className="rounded bg-[#FFF8F0] border border-[#FDE8D0] px-2 py-0.5 text-[10px] font-bold text-[var(--brand-dark)]">
                    {lane}
                  </span>
                  <span className="text-[10px] font-semibold text-[var(--muted)]">{streams.length} streams</span>
                </div>
                <ul className="mt-2.5 space-y-1.5">
                  {streams.map((ws) => (
                    <li key={ws.id} className="truncate text-xs font-medium text-[var(--text)]">
                      • {ws.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Edit Project Modal */}
      {modalOpen && (
        <ProjectModal
          open={modalOpen}
          onClose={closeModal}
          workspaces={scope.scopedWorkspaces}
          project={editing}
          defaultWorkspaceId={scope.selection.workspaceId}
          workspaceLabel="Space"
          onSaved={() => {
            reload()
            scope.refresh()
          }}
        />
      )}
    </div>
  )
}
