'use client'

// @req FR-003 — Project CRUD + archive (soft delete): list, create link,
// edit modal and archive action over /api/projects.
// @req FR-001 — this page is the one browse entry point into the Space list.
// `/workspaces` had no inbound link anywhere in the application: ADR-008 §D6
// keeps Space out of the Development sidebar ("a resource, not a Development
// capability") and FR-034 keeps it out of the breadcrumb, which between them
// left the Space CRUD surface reachable only by typing the URL. Linking from
// here treats it as what it is — a sibling resource list, reached from the
// resource whose rows already carry a Space column — without promoting it to a
// shell capability either decision rejected.
// @spec ADR-008 §D6, SITEMAP-DOMAIN-NAV §6
// @tested tests/e2e/smoke.spec.js, tests/unit/project-list-contract.test.js
import { Suspense, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Plus, Archive, LayoutGrid } from 'lucide-react'
import { PageHeader, DataTable, StatusPill, EmptyState, ErrorState, TruncationNotice } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { useFetch, api, LoadingCard } from '@/modules/project-manager/components/useApi'
import ProjectModal from '@/modules/project-manager/components/ProjectModal'

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

  const params = new URLSearchParams()
  // Single-business installs are scoped implicitly — the shell resolves it (FR-020).
  // A picked workspace wins: group-level workspaces belong to no single business.
  if (scope.selection.workspaceId) params.set('workspaceId', scope.selection.workspaceId)
  else if (scope.shell.activeBusinessId) params.set('businessId', scope.shell.activeBusinessId)
  if (q) params.set('q', q)
  const { data, loading, error, reload } = useFetch(`/api/projects?${params.toString()}`, [
    scope.shell.activeBusinessId,
    scope.selection.workspaceId,
    q,
  ])
  const rows = data?.items || []

  const closeModal = () => {
    setModalOpen(false)
    setEditing(null)
  }

  return (
    <div>
      <PageHeader
        eyebrow="Projects"
        title="Projects"
        subtitle="Outcome-oriented projects. Each project may mix execution modes across its workstreams."
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
      <div className="mb-3">
        <input className="input max-w-sm" placeholder="Search projects…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" />
      </div>
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
          empty={
            <EmptyState
              title="No projects yet"
              hint="Start from an objective — the planning flow decomposes workstreams with execution modes. No template picker."
              action={<Link href="/projects/new" className="btn btn-primary">Create the first project</Link>}
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
          onSaved={() => {
            reload()
            scope.refresh()
          }}
        />
      )}
    </div>
  )
}
