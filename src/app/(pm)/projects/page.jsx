'use client'

// @req FR-086 — the Development domain's Dashboard: a KPI band, a Top-5-by-
// priority panel and the enriched Project list, all from one response
// (SDD-047). It is titled Dashboard, not Overview: `/overview` is Business
// Home's cross-domain surface and FR-060 separated the two deliberately, so
// taking that word here would give the product two Overviews (ADR-036 D1).
// @req FR-003 — Project CRUD + archive (soft delete) still live here.
// @req FR-001 — this page is the one browse entry point into the Space list.
// `/workspaces` had no inbound link anywhere in the application: ADR-008 §D6
// keeps Space out of the Development sidebar ("a resource, not a Development
// capability") and FR-034 keeps it out of the breadcrumb, which between them
// left the Space CRUD surface reachable only by typing the URL.
// @req FR-087, FR-088, FR-089 — Priority, PIC and the team count are the three
// facts the model did not have; the columns exist because the fields now do.
// @spec SDD-047, ADR-036, ADR-037, NFR-008, ADR-008 §D6
// @tested tests/unit/projects-dashboard-ui.test.js, tests/e2e/smoke.spec.js
import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Archive, LayoutGrid, ChevronDown } from 'lucide-react'
import {
  PageHeader, Card, Kpi, ProgressBar, SectionTitle, DataTable, StatusPill,
  EmptyState, ErrorState, TruncationNotice,
} from '@/components/ui'
import { PROJECT_STATUSES, WORK_STATUSES, PROJECT_PRIORITIES } from '@/lib/validation/enums'
import { useScope } from '@/context/ScopeContext'
import { useFetch, api, LoadingCard } from '@/modules/project-manager/components/useApi'
import ProjectModal from '@/modules/project-manager/components/ProjectModal'

export default function ProjectsPage() {
  return (
    <Suspense fallback={<LoadingCard />}>
      <ProjectsDashboardInner />
    </Suspense>
  )
}

const titleCase = (value) => value.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase())

/**
 * One KPI card whose highlighted rows are named up front and whose remainder is
 * disclosed rather than dropped.
 *
 * ADR-036's Consequences make this the rule rather than a nicety: the ask named
 * three project statuses out of five and three work statuses out of seven, and a
 * band whose parts do not add up to the list beneath it teaches the reader to
 * distrust every figure on the page. `other` is therefore always rendered when
 * it is non-zero, and it expands to name what is in it.
 */
function CountCard({ label, counts, highlight, statuses }) {
  const [open, setOpen] = useState(false)
  const byStatus = counts?.byStatus || {}
  const rest = statuses.filter((status) => !highlight.includes(status))
  const otherTotal = rest.reduce((sum, status) => sum + (byStatus[status] || 0), 0)

  return (
    <Card>
      <p className="text-[10px] font-semibold text-muted">{label}</p>
      <p className="mt-1 text-[26px] font-bold leading-8 tracking-tight tabular-nums">{counts?.total ?? 0}</p>
      <dl className="mt-2 space-y-0.5">
        {highlight.map((status) => (
          <div key={status} className="flex items-baseline justify-between gap-3 text-[11px]">
            <dt className="text-muted">{titleCase(status)}</dt>
            <dd className="font-bold tabular-nums">{byStatus[status] || 0}</dd>
          </div>
        ))}
      </dl>
      {otherTotal > 0 && (
        <div className="mt-1.5 border-t border-[var(--border)] pt-1.5">
          <button
            type="button"
            className="flex w-full items-baseline justify-between gap-3 text-[11px] text-muted transition hover:text-[var(--text)]"
            aria-expanded={open}
            onClick={() => setOpen((wasOpen) => !wasOpen)}
          >
            <span className="flex items-center gap-1">
              Other <ChevronDown size={11} aria-hidden className={`transition ${open ? 'rotate-180' : ''}`} />
            </span>
            <span className="font-bold tabular-nums">{otherTotal}</span>
          </button>
          {open && (
            <dl className="mt-1 space-y-0.5">
              {rest.filter((status) => (byStatus[status] || 0) > 0).map((status) => (
                <div key={status} className="flex items-baseline justify-between gap-3 text-[10px]">
                  <dt className="text-muted">{titleCase(status)}</dt>
                  <dd className="tabular-nums">{byStatus[status]}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </Card>
  )
}

// Priority is a word first and a colour second (`color-not-only`, WCAG): the
// level has to survive being printed in greyscale or read aloud.
const PRIORITY_TONE = {
  CRITICAL: 'var(--danger)',
  HIGH: 'var(--warning)',
  MEDIUM: 'var(--ink)',
  LOW: 'var(--muted)',
}

function PriorityCell({ value }) {
  if (!value) return <span className="text-muted">—</span>
  return (
    <span className="text-[11px] font-bold" style={{ color: PRIORITY_TONE[value] || 'var(--ink)' }}>
      {titleCase(value)}
    </span>
  )
}

/**
 * The Top 5 panel, including the state that matters most.
 *
 * ADR-036 D3: when nothing carries a priority the panel says so and links to
 * where it is set. It must never fall back to a `targetAt` ordering — five
 * projects under a "Priority" heading that actually mean "soonest deadline" is a
 * wrong answer the reader has no way to detect.
 */
function TopPriority({ panel }) {
  if (!panel || panel.state !== 'READY') {
    const hint = panel?.reasonCode === 'NO_PROJECTS_IN_SCOPE'
      ? 'No Projects in the selected Business or Space yet.'
      : 'No Project carries a priority yet. Set one from a Project row to rank this panel — it will not guess an order from target dates.'
    return (
      <Card>
        <SectionTitle caption="Ranked by priority, then by target date">Top 5 Priority Projects</SectionTitle>
        <EmptyState title="Nothing to rank" hint={hint} />
      </Card>
    )
  }
  return (
    <Card>
      <SectionTitle caption={`Ranked by priority, then by target date · ${panel.prioritizedTotal} Project(s) carry one`}>
        Top 5 Priority Projects
      </SectionTitle>
      <ol className="space-y-1.5">
        {panel.items.map((project, index) => (
          <li key={project.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-mid)] p-2.5">
            <span className="w-4 shrink-0 text-[11px] font-bold tabular-nums text-muted">{index + 1}</span>
            <span className="min-w-0 flex-1">
              <Link href={`/projects/${project.id}`} className="block truncate text-xs font-bold hover:text-brand-dark">
                {project.name}
              </Link>
              <span className="text-[9px] text-muted">{project.code}</span>
            </span>
            <PriorityCell value={project.priority} />
          </li>
        ))}
      </ol>
    </Card>
  )
}

function ProjectsDashboardInner() {
  const scope = useScope()
  const router = useRouter()
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [q, setQ] = useState('')

  // Single-business installs are scoped implicitly — the shell resolves it (FR-020).
  // A picked workspace wins: group-level workspaces belong to no single business.
  // The band and the rows come from ONE request, so the two halves of the page
  // cannot disagree about what they are counting (FR-086 open question 1).
  const params = new URLSearchParams()
  if (scope.selection.workspaceId) params.set('workspaceId', scope.selection.workspaceId)
  else if (scope.shell.activeBusinessId) params.set('businessId', scope.shell.activeBusinessId)
  const { data, loading, error, reload } = useFetch(`/api/projects/overview?${params.toString()}`, [
    scope.shell.activeBusinessId,
    scope.selection.workspaceId,
  ])

  // Search filters the rows this page already holds. It is deliberately not a
  // query parameter: the band is authoritative over the whole scope, so a
  // server-side search would silently re-scope the counts to the search result.
  const allRows = data?.rows?.items || []
  const query = q.trim().toLowerCase()
  const rows = query
    ? allRows.filter((row) => row.name.toLowerCase().includes(query) || row.code.toLowerCase().includes(query))
    : allRows

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
  }

  return (
    <div>
      <PageHeader
        eyebrow="Development"
        title="Dashboard"
        subtitle="Delivery across the selected scope, and the Projects behind it."
        actions={
          <>
            <Link href="/workspaces" className="btn flex items-center gap-1">
              <LayoutGrid size={13} aria-hidden /> Spaces
            </Link>
            <Link href="/projects/new" className="btn btn-primary flex items-center gap-1">
              <Plus size={13} aria-hidden /> New project
            </Link>
          </>
        }
      />

      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}

      {!loading && !error && data && (
        <>
          <div className="mb-4 grid grid-cols-4 gap-3 max-lg:grid-cols-2 max-md:grid-cols-1">
            <CountCard
              label="Projects"
              counts={data.counts.projects}
              highlight={['ACTIVE', 'DONE']}
              statuses={PROJECT_STATUSES}
            />
            <CountCard
              label="Work items"
              counts={data.counts.work}
              highlight={['IN_PROGRESS', 'DONE']}
              statuses={WORK_STATUSES}
            />
            {/* Two figures, not one. A Team can be attached to a Project with
                nobody assigned yet, and a person can be assigned work while
                belonging to no Team — neither is derivable from the other
                (ADR-037 D4), so each card names what it counts. */}
            <Kpi
              label="Teams"
              value={data.counts.teams.onProjects}
              meta="Teams attached to Projects in scope"
            />
            <Kpi
              label="People"
              value={data.counts.people.withWorkAssigned}
              meta="People with work assigned"
            />
          </div>

          <div className="mb-4">
            <TopPriority panel={data.topPriority} />
          </div>

          {(data.meta?.warnings || []).map((warning) => (
            <p key={warning} className="mb-3 rounded-lg px-3 py-2 text-[11px]" style={{ background: 'var(--surface-mid)', color: 'var(--muted)' }} role="status">
              {warning}
            </p>
          ))}

          <div className="mb-3">
            <input
              className="input max-w-sm"
              placeholder="Search projects…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="Search projects"
            />
          </div>

          {data.rows.truncated && (
            <TruncationNotice
              shown={allRows.length}
              limit={data.rows.limit}
              noun="projects"
              hint="The band above counts every Project in scope; this list is capped. Narrow the Space or Business selection to make the two match."
            />
          )}

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
              // ADR-036 D2 — size is the count of non-deleted WorkItems, and the
              // header says so rather than leaving "size" to mean three things.
              { key: 'size', label: 'Size', render: (p) => <span className="tabular-nums" title="Work items in this project">{p.size}</span> },
              { key: 'workspace', label: 'Space', render: (p) => p.workspace?.code || '—' },
              { key: 'streams', label: 'Streams', render: (p) => <span className="tabular-nums">{p.streams}</span> },
              { key: 'status', label: 'Status', render: (p) => <StatusPill status={p.status} /> },
              {
                key: 'progress',
                label: 'Progress',
                // The number rides beside the bar on purpose: a bar alone cannot
                // be read aloud or compared precisely (NFR-008).
                render: (p) => (
                  <span className="flex min-w-[110px] items-center gap-2">
                    <span className="flex-1"><ProgressBar percent={p.progress?.percent || 0} label={`${p.code} progress`} /></span>
                    <span className="w-9 shrink-0 text-right text-[10px] font-bold tabular-nums">
                      {Math.round(p.progress?.percent || 0)}%
                    </span>
                  </span>
                ),
              },
              {
                key: 'target',
                label: 'Target',
                render: (p) => (p.targetAt ? new Date(p.targetAt).toLocaleDateString() : '—'),
              },
              // Never a guessed name: an unset PIC renders as unset (ADR-036 D4).
              { key: 'pic', label: 'PIC', render: (p) => p.pic?.displayName || <span className="text-muted">—</span> },
              { key: 'priority', label: 'Priority', render: (p) => <PriorityCell value={p.priority} /> },
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
            empty={
              <EmptyState
                title={query ? 'No projects match' : 'No projects yet'}
                hint={
                  query
                    ? 'Clear the search to see every Project in scope.'
                    : 'Start from an objective — the planning flow decomposes workstreams with execution modes. No template picker.'
                }
                action={!query && <Link href="/projects/new" className="btn btn-primary">Create the first project</Link>}
              />
            }
          />
        </>
      )}

      {modalOpen && (
        <ProjectModal
          open={modalOpen}
          onClose={closeModal}
          workspaces={scope.scopedWorkspaces}
          project={editing}
          defaultWorkspaceId={scope.selection.workspaceId}
          workspaceLabel="Space"
          priorities={PROJECT_PRIORITIES}
          onSaved={() => {
            reload()
            scope.refresh()
          }}
        />
      )}
    </div>
  )
}
