'use client'

// @req FR-035, FR-041, FR-060 - this page is the Business Home Dashboard: the
// shell-level cross-domain surface for the selected Business. FR-060 promoted it
// into the Business Home Tier-2 slot rather than adding a second Business-scoped
// page beside it; Development now roots at /projects.
// @spec SDD-033 - a non-owning projection. Figures are computed by the pure
// read model and recomputed on every render; nothing is persisted here.
// @req FR-059 - OWNER-scoped Business Strategy editing (roadmap/horizons, goals,
// Project link/unlink) lives on this same StrategyCard; MEMBER/DEV viewers see
// the FR-041 read-only card with no edit affordance at all.
// @spec ADR-013, SDD-014, SDD-020 - Organization/Portfolio is ancestry/reporting only.
// @spec SDD-032, BR-001 - writes go through the mutation service; this page
// gates the affordance on the current Business's membership in
// viewer.ownedBusinessIds (never the global `role` label alone — see
// resolve-viewer.js) and re-reads via the unchanged FR-041 GET after every
// mutation.
// @tested tests/unit/overview-split.test.js, tests/e2e/fr041-business-first.spec.js
// @tested tests/unit/fr059-strategy-edit-ui.test.js, tests/e2e/fr059-strategy-edit.spec.js
// @tested tests/unit/fr060-business-home-read-model.test.js, tests/unit/fr060-business-home-visibility.test.js

import { useState } from 'react'
import Link from 'next/link'
import { Pencil, Plus, Link2 } from 'lucide-react'
import { PageHeader, Card, Kpi, SectionTitle, StatusPill, ProgressBar, EmptyState, ErrorState } from '@/components/ui'
import { MODE_LABELS, SLUG_BY_MODE } from '@/lib/validation/enums'
import { useScope } from '@/context/ScopeContext'
import { useFetch, LoadingCard } from '@/modules/project-manager/components/useApi'
import { RoadmapModal, GoalModal, LinkProjectModal } from '@/modules/project-manager/components/StrategyEditModals'
import { DOMAINS } from '@/config/domains'
import { buildBusinessHomeReadModel, DOMAIN_STATE } from '@/modules/business/application/business-home-read-model'

// @req FR-060 — the cross-domain half of Business Home: briefing, per-domain
// health and the attention queue. Every figure comes from the pure projection in
// `business/application/business-home-read-model`; this file renders, it does
// not compute (SDD-033).

const SEVERITY_PILL = { HIGH: 'pill-blocked', MED: 'pill-active', INFO: 'pill-planned' }

function BriefingCard({ briefing }) {
  return (
    <Card className="mb-4">
      <SectionTitle caption="Composed from the same signals shown below — not a generated summary">Zuri briefing</SectionTitle>
      <p className="text-xs leading-relaxed">{briefing.line}</p>
    </Card>
  )
}

function DomainHealthCard({ health }) {
  return (
    <Card className="mb-4">
      <SectionTitle caption={health.score === null ? 'No domain reports a health signal yet' : `Composite covers ${health.coverageLabel}`}>
        Business health
      </SectionTitle>
      <div className="mb-3 flex items-baseline gap-2">
        <span className="text-2xl font-bold">{health.score === null ? '—' : health.score}</span>
        <span className="text-[10px] text-muted">HEALTH / 100 · {health.coverageLabel}</span>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {health.domains.map((domain) => {
          const reserved = domain.state === DOMAIN_STATE.RESERVED
          return (
            <div
              key={domain.key}
              className={`rounded-xl border p-3 ${reserved ? 'border-dashed border-[var(--border)] opacity-60' : 'border-[var(--border)]'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold">{domain.label}</span>
                {/* A reserved domain shows no number at all. A zero here would
                    read as "measured and bad" rather than "not built" (FR-060). */}
                <span className="text-xs font-bold">{domain.score === null ? '—' : domain.score}</span>
              </div>
              <p className="mt-1 text-[10px] text-muted">{domain.signal}</p>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

function AttentionCard({ attention }) {
  return (
    <Card className="mb-4">
      <SectionTitle caption="Cross-domain exceptions from real rows, ordered by impact">Attention queue</SectionTitle>
      {attention.length === 0 ? (
        <EmptyState title="Nothing needs attention" hint="No overdue gate, milestone or goal in this Business." />
      ) : (
        <ul className="space-y-2">
          {attention.map((item) => (
            <li key={item.id}>
              <Link href={item.href} className="flex items-start gap-3 rounded-xl border border-[var(--border)] p-3 hover:bg-[var(--brand-surface)]">
                <span className={`pill ${SEVERITY_PILL[item.severity]} shrink-0`}>{item.severity}</span>
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold">{item.title}</span>
                  <span className="block text-[10px] text-muted">{item.detail}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

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

function StrategyCard({ strategy, loading, error, reload, businessId, isOwner, projects }) {
  // Non-OWNER viewers (MEMBER, DEV) never see an edit control here at all —
  // not disabled, not hidden-by-CSS, simply not rendered (FR-059 §1).
  const [editingRoadmap, setEditingRoadmap] = useState(false)
  // Store an id, not the goal object itself: after a mutation, `reload()`
  // replaces `strategy` wholesale, so a captured object reference would go
  // stale (e.g. a just-linked Project would not show in an already-open Link
  // modal until it was closed and reopened). Re-deriving the live goal by id
  // from the freshly-reloaded `strategy` on every render keeps an open modal
  // in sync with its own mutation.
  const [goalModalState, setGoalModalState] = useState(null) // { goalId, horizonId } | null
  const [linkingGoalId, setLinkingGoalId] = useState(null)

  const roadmap = strategy?.roadmaps?.[0] || null
  const horizonOptions = roadmap ? roadmap.horizons.map((h) => ({ id: h.id, key: h.key, label: h.label })) : []
  const allGoals = roadmap ? roadmap.horizons.flatMap((h) => h.goals) : []
  const editingGoal = goalModalState?.goalId ? allGoals.find((g) => g.id === goalModalState.goalId) || null : null
  const linkingGoal = linkingGoalId ? allGoals.find((g) => g.id === linkingGoalId) || null : null
  const onMutated = () => reload()

  return (
    <Card className="mb-4" data-testid="business-strategy">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle caption="Business direction above project execution">Business Strategy · Roadmap & Goals</SectionTitle>
        {isOwner && roadmap && (
          <button type="button" className="btn px-2 py-1 text-[11px]" onClick={() => setEditingRoadmap(true)}>
            <Pencil size={12} className="mr-1 inline" aria-hidden /> Edit roadmap
          </button>
        )}
      </div>
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {!loading && !error && strategy && strategy.roadmaps.length === 0 && (
        <EmptyState
          title="No Business Roadmap yet"
          hint="Set the Business direction before decomposing more Projects."
          action={isOwner && (
            <button type="button" className="btn btn-primary" onClick={() => setEditingRoadmap(true)}>
              <Plus size={13} className="mr-1 inline" aria-hidden /> Create Roadmap
            </button>
          )}
        />
      )}
      {!loading && !error && roadmap && (
        <div>
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-bold">{roadmap.title}</p>
              {roadmap.description && <p className="mt-1 text-xs text-muted">{roadmap.description}</p>}
            </div>
            <span className="pill pill-planned">{strategy.summary.horizonCount} horizons</span>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {roadmap.horizons.map((horizon) => (
              <div key={horizon.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface-muted)] p-3" data-testid={`strategy-horizon-${horizon.key.toLowerCase()}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold">{horizon.label}</p>
                  {horizon.targetAt && <span className="text-[10px] text-muted">{String(horizon.targetAt).slice(0, 10)}</span>}
                </div>
                <div className="mt-3 space-y-2">
                  {horizon.goals.length === 0 && <p className="text-[10px] text-muted">No goals yet</p>}
                  {horizon.goals.map((goal) => (
                    <div key={goal.id} className="rounded-lg border border-[var(--border)] bg-white p-2.5" data-testid={`strategy-goal-${goal.code}`}>
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[11px] font-bold">{goal.title}</p>
                        <StatusPill status={goal.status} />
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1"><ProgressBar percent={goal.progress} label={`${goal.title} progress`} /></div>
                        <span className="text-[10px] font-bold">{goal.progress}%</span>
                      </div>
                      {goal.projects.length > 0 && <p className="mt-1 text-[10px] text-muted">{goal.projects.length} linked project{goal.projects.length === 1 ? '' : 's'}</p>}
                      {isOwner && (
                        <div className="mt-2 flex gap-1.5">
                          <button
                            type="button"
                            className="btn px-1.5 py-0.5 text-[10px]"
                            onClick={() => setGoalModalState({ goalId: goal.id, horizonId: horizon.id })}
                            aria-label={`Edit ${goal.title}`}
                          >
                            <Pencil size={11} className="mr-1 inline" aria-hidden /> Edit
                          </button>
                          <button
                            type="button"
                            className="btn px-1.5 py-0.5 text-[10px]"
                            onClick={() => setLinkingGoalId(goal.id)}
                            aria-label={`Link Projects to ${goal.title}`}
                          >
                            <Link2 size={11} className="mr-1 inline" aria-hidden /> Link
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {isOwner && (
                    <button
                      type="button"
                      className="w-full rounded-lg border border-dashed border-[var(--border)] py-1.5 text-[10px] font-semibold text-muted hover:bg-[var(--brand-surface)]"
                      onClick={() => setGoalModalState({ goalId: null, horizonId: horizon.id })}
                    >
                      <Plus size={11} className="mr-1 inline" aria-hidden /> New goal
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* T3b-1 FIX 3: rendered conditionally on `editingRoadmap` (like GoalModal
          and LinkProjectModal below), not unconditionally-with-`open`-toggled.
          RoadmapModal's form/horizons state is a `useState(() => ...)`
          initializer that only re-runs on mount — leaving it permanently
          mounted with only `open` flipping meant Cancel discarded nothing
          (reopening showed the previously-typed, supposedly-cancelled text)
          and a goal created while the modal was closed still showed the
          horizon's stale goalCount on reopen. Unmounting on close (the shared
          `Modal` already no-ops while `open` is false, so this changes
          nothing about the closed-state rendering) forces a fresh initializer
          run — and therefore fresh form state and a fresh goalCount — on
          every open. */}
      {isOwner && editingRoadmap && (
        <RoadmapModal
          key={roadmap ? roadmap.id : `new-roadmap-${businessId}`}
          open
          onClose={() => setEditingRoadmap(false)}
          businessId={businessId}
          roadmap={roadmap}
          onSaved={onMutated}
        />
      )}
      {isOwner && goalModalState && (
        <GoalModal
          key={goalModalState.goalId || `new-${goalModalState.horizonId}`}
          open
          onClose={() => setGoalModalState(null)}
          businessId={businessId}
          roadmapId={roadmap?.id}
          horizons={horizonOptions}
          goal={editingGoal}
          currentHorizonId={goalModalState.horizonId}
          onSaved={onMutated}
        />
      )}
      {isOwner && linkingGoal && (
        <LinkProjectModal
          key={linkingGoal.id}
          open
          onClose={() => setLinkingGoalId(null)}
          goal={linkingGoal}
          projects={projects}
          onSaved={onMutated}
        />
      )}
    </Card>
  )
}

function BusinessOverview({ scope }) {
  // BusinessShellGuard resolves BUSINESS_REQUIRED/FORBIDDEN and redirects to
  // `/businesses` before this page mounts, so an authorized `activeBusinessId`
  // is a precondition here (FR-044; ADR-015 Consequences). The page owning a
  // second "choose a Business" empty state was a pre-FR-044 leftover that no
  // route could reach.
  const businessId = scope.shell.activeBusinessId
  const params = new URLSearchParams()
  // Overview is the Business strategy surface. A module-local Workspace
  // selection must not turn a portfolio-shared Project into Business-owned work.
  if (businessId) {
    params.set('businessId', businessId)
    // The Overview projection still needs relation-rich Project rows. Keep it
    // explicit while the /projects page uses the stable list DTO.
    params.set('view', 'overview')
  }
  const { data: projects, loading, error, reload } = useFetch(
    businessId ? `/api/projects?${params.toString()}` : null,
    [businessId],
  )
  const strategy = useFetch(
    businessId ? `/api/business/strategy?businessId=${encodeURIComponent(businessId)}` : null,
    [businessId],
  )
  // @req FR-059 - edit affordances are gated on the resolved viewer's
  // per-Business OWNER grant (`ownedBusinessIds`), the same `/api/viewer`
  // contract DomainBar/BusinessShellGuard already use for the rest of the
  // shell. `viewer.data?.role === 'OWNER'` is a *global* per-principal label
  // (resolve-viewer.js) — true for any principal who owns any single
  // Business — so it would wrongly show edit affordances for this Business
  // to an OWNER-of-somewhere-else who is only a MEMBER here. Gating on
  // membership of the *current* Business in ownedBusinessIds is the correct,
  // per-Business check; a MEMBER or platform DEV grant (ownedBusinessIds: [])
  // still never renders an edit control.
  const viewer = useFetch('/api/viewer')
  const isOwner = Boolean(viewer.data?.ownedBusinessIds?.includes(businessId))
  // @req FR-060 — composed from the owning domains' read models (FR-042 people,
  // FR-040 projects, FR-041 strategy), never by querying their tables (SDD-033).
  const people = useFetch(
    businessId ? `/api/people?businessId=${encodeURIComponent(businessId)}` : null,
    [businessId],
  )

  const workstreamCount = (projects || []).reduce((s, p) => s + (p.workstreams?.length || 0), 0)
  const openGates = (projects || []).reduce((s, p) => s + (p.gates || []).filter((g) => g.required && !['PASSED', 'WAIVED'].includes(g.status)).length, 0)
  const milestonesDone = (projects || []).reduce((s, p) => s + (p.milestones || []).filter((m) => m.status === 'DONE').length, 0)
  const milestonesTotal = (projects || []).reduce((s, p) => s + (p.milestones || []).length, 0)

  const home = buildBusinessHomeReadModel({
    projects: projects || [],
    strategy: strategy.data,
    domains: DOMAINS,
    peopleCount: Array.isArray(people.data) ? people.data.length : people.data?.people?.length,
  })

  return (
    <div>
      <PageHeader
        eyebrow="Business Home"
        title={`${scope.shell.activeBusiness.name} — Command Center`}
        subtitle="Cross-domain health, outcomes and next actions. Drill into a domain only when you need operational detail."
      />
      {loading && <LoadingCard />}
      {error && <ErrorState detail={error} retry={reload} />}
      {!loading && !error && (
        <>
          <BriefingCard briefing={home.briefing} />
          <div className="mb-4 grid grid-cols-4 gap-3 max-md:grid-cols-2">
            <Kpi label="Active projects" value={(projects || []).filter((p) => p.status === 'ACTIVE').length} meta={`${(projects || []).length} total in this Business`} />
            <Kpi label="Workstreams" value={workstreamCount} meta="across execution modes" />
            <Kpi label="Open required gates" value={openGates} tone={openGates > 0 ? 'warn' : 'good'} meta="guarding progress" />
            <Kpi label="Milestones done" value={`${milestonesDone}/${milestonesTotal}`} meta="in this Business" />
          </div>
          <DomainHealthCard health={home.health} />
          <AttentionCard attention={home.attention} />
          <StrategyCard
            strategy={strategy.data}
            loading={strategy.loading}
            error={strategy.error}
            reload={strategy.reload}
            businessId={businessId}
            isOwner={isOwner}
            projects={projects}
          />
          <Card className="mb-4">
            <SectionTitle caption="Open a domain without changing the selected Business">Business domains</SectionTitle>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {/* Business Home is this page — linking to itself would be a
                  no-op tile, so the slot is excluded from its own shortcut list. */}
              {DOMAINS.filter((domain) => !domain.soon && domain.key !== 'business-home').map((domain) => {
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
