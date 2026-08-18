'use client'

// @req FR-001 — single-Workspace detail: resolves one Space's identity
// (code/scopeType/name) from the scope hierarchy and lists its Projects.
// @tested tests/unit/project-list-contract.test.js, tests/e2e/smoke.spec.js
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { PageHeader, Card, StatusPill, EmptyState, ErrorState } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { useFetch, LoadingCard } from '@/modules/project-manager/components/useApi'
import { MODE_LABELS } from '@/lib/validation/enums'

export default function WorkspaceDetailPage() {
  const { workspaceId } = useParams()
  const scope = useScope()
  const { data, loading, error, reload } = useFetch(`/api/projects?workspaceId=${workspaceId}&view=workspace`)
  const workspace = scope.workspaces.find((w) => w.id === workspaceId)

  if (loading) return <LoadingCard />
  if (error) return <ErrorState detail={error} retry={reload} />

  return (
    <div>
      <PageHeader
        eyebrow={workspace ? `${workspace.code} · ${workspace.scopeType}` : 'Space'}
        title={workspace?.name || 'Space'}
        subtitle="Projects in this Space."
        actions={<Link className="btn btn-primary" href="/projects/new">New project</Link>}
      />
      {(data || []).length === 0 ? (
        <EmptyState title="No projects here" hint="Create a project in this Space to start tracking execution." />
      ) : (
        <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1">
          {(data || []).map((p) => (
            <Card key={p.id}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[9px] text-muted">{p.code}</p>
                  <Link href={`/projects/${p.id}`} className="text-sm font-bold hover:text-brand-dark">{p.name}</Link>
                </div>
                <StatusPill status={p.status} />
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                {(p.workstreams || []).map((ws) => (
                  <span key={ws.id} className="pill pill-planned">{MODE_LABELS[ws.executionMode]}</span>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
