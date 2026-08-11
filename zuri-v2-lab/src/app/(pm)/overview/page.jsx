'use client'

import Link from 'next/link'
import { PageHeader, Card, Kpi, SectionTitle, StatusPill, ProgressBar, EmptyState, ErrorState } from '@/components/ui'
import { MODE_LABELS, SLUG_BY_MODE } from '@/lib/validation/enums'
import { useScope } from '@/context/ScopeContext'
import { useFetch, LoadingCard } from '@/modules/project-manager/components/useApi'

function ProjectProgressRow({ project }) {
  const { data } = useFetch(`/api/progress/project/${project.id}`)
  return (
    <Link href={`/projects/${project.id}`} className="block rounded-xl border border-[#ECEEF1] bg-[#FAFBFC] p-3 hover:border-[#F0BE81]">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[9px] text-muted">{project.code} · {project.workspace?.code}</p>
          <p className="truncate text-xs font-bold">{project.name}</p>
        </div>
        <StatusPill status={project.status} />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1">
          <ProgressBar percent={data?.percent ?? 0} label={`${project.name} progress`} />
        </div>
        <span className="w-12 text-right text-xs font-bold">{data ? `${data.percent}%` : '…'}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {(project.workstreams || []).map((ws) => (
          <span key={ws.id} className="pill pill-planned">{MODE_LABELS[ws.executionMode]}</span>
        ))}
      </div>
    </Link>
  )
}

export default function OverviewPage() {
  const scope = useScope()
  const params = new URLSearchParams()
  if (scope.selection.businessId) params.set('businessId', scope.selection.businessId)
  if (scope.selection.workspaceId) params.set('workspaceId', scope.selection.workspaceId)
  const { data: projects, loading, error, reload } = useFetch(`/api/projects?${params.toString()}`, [scope.selection.businessId, scope.selection.workspaceId])

  const workstreamCount = (projects || []).reduce((s, p) => s + (p.workstreams?.length || 0), 0)
  const openGates = (projects || []).reduce(
    (s, p) => s + (p.gates || []).filter((g) => g.required && !['PASSED', 'WAIVED'].includes(g.status)).length,
    0
  )
  const milestonesDone = (projects || []).reduce((s, p) => s + (p.milestones || []).filter((m) => m.status === 'DONE').length, 0)
  const milestonesTotal = (projects || []).reduce((s, p) => s + (p.milestones || []).length, 0)

  return (
    <div>
      <PageHeader
        eyebrow="Portfolio"
        title={scope.currentBusiness ? `${scope.currentBusiness.name} — Overview` : 'Portfolio Overview'}
        subtitle="Business execution across every project and workstream in the selected scope."
      />
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {!loading && !error && (
        <>
          <div className="mb-4 grid grid-cols-4 gap-3 max-md:grid-cols-2">
            <Kpi label="Active projects" value={(projects || []).filter((p) => p.status === 'ACTIVE').length} meta={`${(projects || []).length} total in scope`} />
            <Kpi label="Workstreams" value={workstreamCount} meta="across all execution modes" />
            <Kpi label="Open required gates" value={openGates} tone={openGates > 0 ? 'warn' : 'good'} meta="guarding progress" />
            <Kpi label="Milestones done" value={`${milestonesDone}/${milestonesTotal}`} meta="portfolio-wide" />
          </div>
          <div className="grid grid-cols-[1.5fr_1fr] gap-4 max-md:grid-cols-1">
            <Card>
              <SectionTitle caption="Weighted progress per project — click to open">Projects</SectionTitle>
              {(projects || []).length === 0 ? (
                <EmptyState
                  title="No projects in this scope"
                  hint="Create a project or run the demo seed (npm run db:seed)."
                  action={<Link className="btn btn-primary" href="/projects?new=1">New project</Link>}
                />
              ) : (
                <div className="space-y-2.5">
                  {(projects || []).map((p) => <ProjectProgressRow key={p.id} project={p} />)}
                </div>
              )}
            </Card>
            <Card>
              <SectionTitle caption="Seven canonical execution modes">Execution modes</SectionTitle>
              <div className="space-y-1.5">
                {Object.entries(MODE_LABELS).map(([mode, label], i) => (
                  <Link key={mode} href={`/execution/${SLUG_BY_MODE[mode]}`} className="flex items-center justify-between rounded-xl border border-[#ECEEF1] p-2.5 hover:bg-brand-surface">
                    <span className="text-[11px] font-bold">{i + 1}. {label}</span>
                    <span className="pill pill-planned">
                      {(projects || []).reduce((s, p) => s + (p.workstreams || []).filter((w) => w.executionMode === mode).length, 0)} streams
                    </span>
                  </Link>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
