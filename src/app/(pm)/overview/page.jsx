'use client'

// @req FR-035, FR-041 - Overview is the selected Business's operational home.
// @spec ADR-013, SDD-014, SDD-020 - Organization/Portfolio is ancestry/reporting only.
// @tested tests/unit/overview-split.test.js, tests/e2e/fr041-business-first.spec.js

import Link from 'next/link'
import { PageHeader, Card, Kpi, SectionTitle, StatusPill, ProgressBar, EmptyState, ErrorState } from '@/components/ui'
import { MODE_LABELS, SLUG_BY_MODE } from '@/lib/validation/enums'
import { useScope } from '@/context/ScopeContext'
import { useFetch, LoadingCard } from '@/modules/project-manager/components/useApi'
import { DOMAINS } from '@/config/domains'

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
        <div className="flex-1"><ProgressBar percent={data?.percent ?? 0} label={`${project.name} progress`} /></div>
        <span className="w-12 text-right text-xs font-bold">{data ? `${data.percent}%` : '…'}</span>
      </div>
      <div className="mt-2 flex flex-wrap gap-1">
        {(project.workstreams || []).map((ws) => <span key={ws.id} className="pill pill-planned">{MODE_LABELS[ws.executionMode]}</span>)}
      </div>
    </Link>
  )
}

function StrategyCard({ strategy, loading, error, reload }) {
  return (
    <Card className="mb-4" data-testid="business-strategy">
      <SectionTitle caption="Business direction above project execution">Business Strategy · Roadmap & Goals</SectionTitle>
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {!loading && !error && strategy && strategy.roadmaps.length === 0 && (
        <EmptyState title="No Business Roadmap yet" hint="Set the Business direction before decomposing more Projects." />
      )}
      {!loading && !error && strategy?.roadmaps?.[0] && (
        <div>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold">{strategy.roadmaps[0].title}</p>
              {strategy.roadmaps[0].description && <p className="mt-1 text-xs text-muted">{strategy.roadmaps[0].description}</p>}
            </div>
            <span className="pill pill-planned">{strategy.summary.horizonCount} horizons</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {strategy.roadmaps[0].horizons.map((horizon) => (
              <div key={horizon.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3" data-testid={`strategy-horizon-${horizon.key.toLowerCase()}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold">{horizon.label}</p>
                  {horizon.targetAt && <span className="text-[10px] text-muted">{String(horizon.targetAt).slice(0, 10)}</span>}
                </div>
                <div className="mt-3 space-y-2">
                  {horizon.goals.length === 0 && <p className="text-[10px] text-muted">No goals yet</p>}
                  {horizon.goals.map((goal) => (
                    <div key={goal.id} className="rounded-lg border border-[var(--border)] bg-white p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[11px] font-bold">{goal.title}</p>
                        <StatusPill status={goal.status} />
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1"><ProgressBar percent={goal.progress} label={`${goal.title} progress`} /></div>
                        <span className="text-[10px] font-bold">{goal.progress}%</span>
                      </div>
                      {goal.projects.length > 0 && <p className="mt-1 text-[10px] text-muted">{goal.projects.length} linked project{goal.projects.length === 1 ? '' : 's'}</p>}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Card>
  )
}

function BusinessOverview({ scope }) {
  const businessId = scope.shell.activeBusinessId
  const params = new URLSearchParams()
  // Overview is the Business strategy surface. A module-local Workspace
  // selection must not turn a portfolio-shared Project into Business-owned work.
  if (businessId) params.set('businessId', businessId)
  const { data: projects, loading, error, reload } = useFetch(
    businessId ? `/api/projects?${params.toString()}` : null,
    [businessId],
  )
  const strategy = useFetch(
    businessId ? `/api/business/strategy?businessId=${encodeURIComponent(businessId)}` : null,
    [businessId],
  )

  if (!businessId) {
    return (
      <EmptyState
        title="Choose a Business to open Overview"
        hint="Organization and Business Group remain ancestry context. Daily work starts inside one operating Business."
        action={<Link href="/" className="btn btn-primary">Choose Business</Link>}
      />
    )
  }

  const workstreamCount = (projects || []).reduce((s, p) => s + (p.workstreams?.length || 0), 0)
  const openGates = (projects || []).reduce((s, p) => s + (p.gates || []).filter((g) => g.required && !['PASSED', 'WAIVED'].includes(g.status)).length, 0)
  const milestonesDone = (projects || []).reduce((s, p) => s + (p.milestones || []).filter((m) => m.status === 'DONE').length, 0)
  const milestonesTotal = (projects || []).reduce((s, p) => s + (p.milestones || []).length, 0)

  return (
    <div>
      <PageHeader
        eyebrow="Business Overview"
        title={`${scope.shell.activeBusiness.name} — Overview`}
        subtitle="Business execution, strategy, and domain health. Projects are resources inside this Business, not shell parents."
      />
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {!loading && !error && (
        <>
          <div className="mb-4 grid grid-cols-4 gap-3 max-md:grid-cols-2">
            <Kpi label="Active projects" value={(projects || []).filter((p) => p.status === 'ACTIVE').length} meta={`${(projects || []).length} total in this Business`} />
            <Kpi label="Workstreams" value={workstreamCount} meta="across execution modes" />
            <Kpi label="Open required gates" value={openGates} tone={openGates > 0 ? 'warn' : 'good'} meta="guarding progress" />
            <Kpi label="Milestones done" value={`${milestonesDone}/${milestonesTotal}`} meta="in this Business" />
          </div>
          <StrategyCard strategy={strategy.data} loading={strategy.loading} error={strategy.error} reload={strategy.reload} />
          <Card className="mb-4">
            <SectionTitle caption="Open a domain without changing the selected Business">Business domains</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {DOMAINS.filter((domain) => !domain.soon).map((domain) => {
                const Icon = domain.icon
                return (
                  <Link key={domain.key} href={domain.sub[0].path} className="flex items-center gap-3 rounded-xl border border-[var(--border)] p-3 transition hover:bg-[var(--brand-surface)]">
                    <span className="grid h-9 w-9 place-items-center rounded-lg bg-[var(--brand-tint)] text-[var(--brand-dark)]" aria-hidden><Icon size={17} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs font-bold">{domain.label}</span>
                      <span className="block text-[10px] text-muted">{domain.key === 'projects' ? 'Projects, work, and delivery health' : domain.key === 'people' ? 'Workforce directory and membership' : 'Business domain dashboard'}</span>
                    </span>
                  </Link>
                )
              })}
            </div>
          </Card>
          <div className="grid grid-cols-[1.5fr_1fr] gap-4 max-md:grid-cols-1">
            <Card>
              <SectionTitle caption="Projects owned by this Business — click to open">Projects</SectionTitle>
              {(projects || []).length === 0 ? (
                <EmptyState title="No Projects in this Business" hint="Create a Project inside a Business workspace; shared portfolio work stays in reporting." action={<Link className="btn btn-primary" href="/projects/new">Create Project</Link>} />
              ) : (
                <div className="space-y-2.5">{(projects || []).map((p) => <ProjectProgressRow key={p.id} project={p} />)}</div>
              )}
            </Card>
            <Card>
              <SectionTitle caption="Seven canonical execution modes">Execution modes</SectionTitle>
              <div className="space-y-1.5">
                {Object.entries(MODE_LABELS).map(([mode, label], i) => (
                  <Link key={mode} href={`/execution/${SLUG_BY_MODE[mode]}`} className="flex items-center justify-between rounded-xl border border-[#ECEEF1] p-2.5 hover:bg-brand-surface">
                    <span className="text-[11px] font-bold">{i + 1}. {label}</span>
                    <span className="pill pill-planned">{(projects || []).reduce((s, p) => s + (p.workstreams || []).filter((w) => w.executionMode === mode).length, 0)} streams</span>
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

export default function OverviewPage() {
  const scope = useScope()
  return <BusinessOverview scope={scope} />
}
