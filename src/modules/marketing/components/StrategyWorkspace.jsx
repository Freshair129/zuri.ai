'use client'

// @req FR-153 — Strategy is a Business-scoped native UI for Situation,
// Objectives, Plans, and honest version comparisons.
// @req FR-154 — a reviewed revision can be previewed and committed through the
// same-Business Project Manager handoff contract.
// @spec SDD-086 — scope changes reset stale data; all persisted writes include
// expectedVersion and plan detail stays addressable by URL.
// @tested tests/unit/marketing-strategy-ui.test.js, tests/e2e/marketing-strategy.spec.js

import Link from 'next/link'
import { ArrowLeft, Archive, Plus } from 'lucide-react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useState } from 'react'
import { Card, EmptyState, ErrorState, PageHeader, ProgressBar, SectionTitle, StatusPill, TruncationNotice } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, useFetch } from '@/modules/project-manager/components/useApi'
import { GROWTH_PLANS_PATH, STRATEGY_TABS, growthPlanPath, growthPlansPath, strategyTabHref } from './marketing-contract'
import { MarketingDataState, ScopeNotice, SourceNote, UnavailableState, InlineNotice } from './MarketingState'
import { MarketingTabs } from './MarketingTabs'
import { PlanForm } from './PlanForm'
import { PlanHandoff } from './PlanHandoff'
import { PlanReviewDecision } from './PlanReviewDecision'
import { PlanVersionHistory } from './PlanVersionHistory'

function PlanList({ plans, planId, truncated }) {
  if (!plans.length) return <EmptyState title="No Marketing plans yet" hint="Create the first plan from this Business-scoped Strategy workspace." />
  return (
    <div className="space-y-2" data-testid="marketing-plan-list">
      {truncated && <TruncationNotice shown={plans.length} limit={100} noun="plans" hint="The API returned the newest records only." />}
      {plans.map((plan) => (
        <Link key={plan.id} href={strategyTabHref('/growth/strategy', 'plans', { planId: plan.id })} className={`block rounded-xl border p-3 hover:bg-[var(--brand-surface)] ${plan.id === planId ? 'border-[var(--action-primary)]' : 'border-[var(--border)]'}`}>
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-bold">{plan.title || 'Untitled plan'}</p><p className="mt-1 text-[10px] text-muted">{plan.code || plan.id} · revision {plan.currentRevision || 1}</p></div><StatusPill status={plan.status || 'DRAFT'} /></div>
        </Link>
      ))}
      <p className="pt-1 text-[10px] text-muted">Plan list is scoped to the current Business.</p>
    </div>
  )
}

function SituationSection({ strategy }) {
  const roadmap = strategy?.roadmaps?.[0]
  return (
    <Card data-testid="marketing-situation">
      <SectionTitle caption="Read-only projection from Business Strategy">Situation</SectionTitle>
      {!roadmap ? <EmptyState title="No Business Roadmap yet" hint="Set Business direction in Overview before using this projection." action={<Link href="/overview" className="btn">Open Business Overview</Link>} /> : (
        <div className="space-y-3">
          <div><p className="text-sm font-bold">{roadmap.title}</p>{roadmap.description && <p className="mt-1 text-xs text-muted">{roadmap.description}</p>}</div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{roadmap.horizons.map((horizon) => <div key={horizon.id} className="rounded-xl border border-[var(--border)] p-3"><p className="text-xs font-bold">{horizon.label}</p>{horizon.description && <p className="mt-1 text-[10px] text-muted">{horizon.description}</p>}{horizon.targetAt && <p className="mt-2 text-[10px] text-muted">Target {String(horizon.targetAt).slice(0, 10)}</p>}</div>)}</div>
          <Link href="/overview" className="btn text-[11px]">Edit Business Strategy</Link>
        </div>
      )}
      <SourceNote>Business Strategy projection. Marketing does not duplicate its editor.</SourceNote>
    </Card>
  )
}

function ObjectivesSection({ strategy }) {
  const goals = (strategy?.roadmaps || []).flatMap((roadmap) => roadmap.horizons.flatMap((horizon) => horizon.goals.map((goal) => ({ ...goal, horizon: horizon.label }))))
  if (!goals.length) return <EmptyState title="No objectives recorded" hint="Objectives are read from Business Strategy goals." />
  return (
    <Card data-testid="marketing-objectives">
      <SectionTitle caption="Read-only Business Strategy goals and their measured progress">Objectives</SectionTitle>
      <div className="space-y-3">{goals.map((goal) => <div key={goal.id} className="rounded-xl border border-[var(--border)] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold">{goal.title}</p><p className="mt-1 text-[10px] text-muted">{goal.horizon}</p></div><StatusPill status={goal.status} /></div><div className="mt-2 flex items-center gap-2"><div className="flex-1"><ProgressBar percent={goal.progress} label={`${goal.title} progress`} /></div><span className="text-[10px] font-bold">{goal.progress}%</span></div>{goal.projects?.length > 0 && <p className="mt-1 text-[10px] text-muted">{goal.projects.length} linked Project{goal.projects.length === 1 ? '' : 's'}</p>}</div>)}</div>
      <SourceNote>Business Strategy goal progress. Marketing actions do not replace PM KPI observations.</SourceNote>
    </Card>
  )
}

function ScenariosSection({ plan }) {
  if (!plan || (plan.versions || []).length < 2) return <UnavailableState title="Scenarios are unavailable" hint="Scenario assumptions are not persisted yet. Compare real Marketing plan versions when at least two revisions exist." />
  return <div><InlineNotice>These are saved plan version comparisons, not simulated provider forecasts.</InlineNotice><div className="mt-3"><PlanVersionHistory plan={plan} /></div></div>
}

export default function StrategyWorkspace({ businessId }) {
  const scope = useScope()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const tab = STRATEGY_TABS.some((item) => item.key === searchParams.get('tab')) ? searchParams.get('tab') : 'situation'
  const planId = searchParams.get('plan') || null
  const creating = searchParams.get('new') === '1' && tab === 'plans' && !planId
  const [mutationError, setMutationError] = useState(null)
  const [busy, setBusy] = useState(false)
  const strategy = useFetch(businessId ? `/api/business/strategy?businessId=${encodeURIComponent(businessId)}` : null, [businessId])
  const plans = useFetch(businessId ? growthPlansPath(businessId) : null, [businessId])
  const detail = useFetch(planId && businessId ? growthPlanPath(planId, businessId) : null, [planId, businessId])
  const viewer = useFetch('/api/viewer')
  const loadedPlan = detail.data?.plan || detail.data || null
  // useFetch keeps the previous response while a new URL request is loading.
  // Never render or mutate that old plan under the new `?plan=` address.
  const plan = loadedPlan?.id === planId ? loadedPlan : null
  const planList = Array.isArray(plans.data?.plans) ? plans.data.plans : []
  // The API's explicit canWrite grant is the affordance gate. Until the scoped
  // response arrives, keep mutation controls hidden rather than guessing from
  // a global role or showing a form that will inevitably fail.
  const canWrite = Boolean((plan?.canWrite ?? plans.data?.canWrite) === true)
  const businessName = scope.shell.activeBusiness?.name || 'selected Business'
  const viewerId = viewer.data?.principal?.id || viewer.data?.personId || viewer.data?.id || null
  const hrefForTab = (nextTab) => strategyTabHref(pathname, nextTab, { planId, newPlan: nextTab === 'plans' && creating })

  const mutate = async (path, body, after) => {
    setBusy(true)
    setMutationError(null)
    try {
      const result = await api(path, { method: 'PATCH', body })
      await after?.(result)
      return result
    } catch (error) {
      setMutationError(error.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  const createPlan = async ({ title, payload }) => {
    setBusy(true)
    setMutationError(null)
    try {
      const result = await api(GROWTH_PLANS_PATH, { method: 'POST', body: { businessId, title, payload } })
      const created = result?.plan || result
      await plans.reload()
      if (created?.id) router.replace(strategyTabHref(pathname, 'plans', { planId: created.id }))
    } catch (error) {
      setMutationError(error.message)
    } finally {
      setBusy(false)
    }
  }

  const revisePlan = ({ title, payload }) => mutate(growthPlanPath(planId, businessId), { businessId, expectedVersion: plan.version, action: 'revise', title, payload }, async () => { await Promise.all([detail.reload(), plans.reload()]) })
  const reviewPlan = (input) => mutate(growthPlanPath(planId, businessId), { businessId, expectedVersion: plan.version, action: 'review', ...input }, async () => { await detail.reload() })
  const decidePlan = (input) => mutate(growthPlanPath(planId, businessId), { businessId, expectedVersion: plan.version, action: 'decide', ...input }, async () => { await detail.reload(); await plans.reload() })
  const archivePlan = () => mutate(growthPlanPath(planId, businessId), { businessId, expectedVersion: plan.version, action: 'archive' }, async () => { await detail.reload(); await plans.reload() })

  if (!businessId) return <ScopeNotice />
  return (
    <main className="mx-auto max-w-6xl p-5 max-md:p-3">
      <PageHeader
        eyebrow="MARKETING / STRATEGY"
        title="Strategy workspace"
        subtitle={`Business-scoped planning for ${businessName}.`}
        actions={tab === 'plans' && canWrite && <Link href={strategyTabHref(pathname, 'plans', { newPlan: true })} className="btn btn-primary"><Plus size={14} aria-hidden /> New plan</Link>}
      />
      <MarketingTabs tabs={STRATEGY_TABS} activeKey={tab} hrefForTab={hrefForTab} ariaLabel="Marketing strategy sections" />
      {mutationError && <div className="mb-4"><InlineNotice tone="error">{mutationError} Refresh the plan before retrying a stale write.</InlineNotice></div>}
      {tab === 'situation' && <MarketingDataState loading={strategy.loading} error={strategy.error} retry={strategy.reload}><SituationSection strategy={strategy.data} /></MarketingDataState>}
      {tab === 'objectives' && <MarketingDataState loading={strategy.loading} error={strategy.error} retry={strategy.reload}><ObjectivesSection strategy={strategy.data} /></MarketingDataState>}
      {tab === 'scenarios' && <MarketingDataState loading={detail.loading && Boolean(planId)} error={detail.error} retry={detail.reload}><ScenariosSection plan={plan} /></MarketingDataState>}
      {tab === 'plans' && (
        <MarketingDataState loading={plans.loading} error={plans.error} retry={plans.reload}>
          {creating && canWrite && <PlanForm busy={busy} onSubmit={createPlan} onCancel={() => router.replace(strategyTabHref(pathname, 'plans'))} />}
          {!creating && planId && (detail.loading || (!plan && !detail.error)) && <div className="card p-6 text-xs text-muted" role="status">Loading plan…</div>}
          {!creating && planId && detail.error && <ErrorState title="Plan unavailable" detail={detail.error} retry={detail.reload} />}
          {!creating && planId && plan && !detail.error && (
            <div>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><Link href={strategyTabHref(pathname, 'plans')} className="btn text-[11px]"><ArrowLeft size={13} aria-hidden /> Back to plans</Link><div className="flex items-center gap-2"><StatusPill status={plan.status || 'DRAFT'} />{canWrite && <button type="button" className="btn text-[11px]" onClick={archivePlan} disabled={busy || plan.status === 'ARCHIVED'}><Archive size={13} aria-hidden /> Archive</button>}</div></div>
              {canWrite && <PlanForm plan={plan} busy={busy} onSubmit={revisePlan} />}
              {!canWrite && <InlineNotice> this plan is read-only for the current Business grant.</InlineNotice>}
              <PlanVersionHistory plan={plan} />
              <PlanReviewDecision plan={plan} viewerId={viewerId} busy={busy} onReview={reviewPlan} onDecision={decidePlan} />
              <PlanHandoff businessId={businessId} plan={plan} />
            </div>
          )}
          {!planId && !creating && <Card><SectionTitle caption="Create or inspect immutable revisions">Marketing plans</SectionTitle><PlanList plans={planList} planId={planId} truncated={Boolean(plans.data?.truncated || plans.data?.pagination?.truncated || plans.data?.meta?.truncated)} /></Card>}
        </MarketingDataState>
      )}
    </main>
  )
}
