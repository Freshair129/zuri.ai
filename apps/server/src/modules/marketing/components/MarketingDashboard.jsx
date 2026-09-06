'use client'

// @req FR-159 — `/growth` summarizes persisted Marketing plans in the active
// Business scope and gives a direct path into the Strategy workspace.
// @spec SDD-086 — unsupported provider metrics are explicit unavailable states.
// @tested tests/unit/marketing-strategy-ui.test.js, tests/e2e/marketing-strategy.spec.js

import Link from 'next/link'
import { ArrowRight, Plus } from 'lucide-react'
import { Card, Kpi, PageHeader, SectionTitle, StatusPill, EmptyState, ProgressBar, TruncationNotice } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { useFetch } from '@/modules/project-manager/components/useApi'
import { growthPlansPath, strategyTabHref } from './marketing-contract'
import { MarketingDataState, ScopeNotice, SourceNote, UnavailableState } from './MarketingState'

function planStatus(plan) {
  return String(plan?.status || 'DRAFT').toUpperCase()
}

export default function MarketingDashboard({ businessId }) {
  const scope = useScope()
  const { data, loading, error, reload } = useFetch(businessId ? growthPlansPath(businessId) : null, [businessId])
  const plans = Array.isArray(data?.plans) ? data.plans : []
  const truncated = Boolean(data?.truncated || data?.pagination?.truncated || data?.meta?.truncated)
  const counts = plans.reduce((result, plan) => {
    const status = planStatus(plan)
    result[status] = (result[status] || 0) + 1
    return result
  }, {})
  const strategyHref = strategyTabHref('/growth/strategy', 'plans')
  const businessName = scope.shell.activeBusiness?.name || 'selected Business'

  if (!businessId) return <ScopeNotice />
  return (
    <main className="mx-auto max-w-6xl p-5 max-md:p-3">
      <PageHeader
        eyebrow="MARKETING"
        title="Growth dashboard"
        subtitle={`Plan activity for ${businessName}. Provider performance is shown only when a measured source exists.`}
        actions={data?.canWrite && <Link href={strategyTabHref('/growth/strategy', 'plans', { newPlan: true })} className="btn btn-primary"><Plus size={14} aria-hidden /> New plan</Link>}
      />
      <MarketingDataState loading={loading} error={error} retry={reload}>
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Plans" value={plans.length} meta="Persisted Marketing plans" />
          <Kpi label="Draft" value={counts.DRAFT || 0} meta="Needs review or decision" tone={counts.DRAFT ? 'warn' : undefined} />
          <Kpi label="Approved" value={counts.APPROVED || 0} meta="Current plan state" tone={counts.APPROVED ? 'good' : undefined} />
          <Kpi label="Archived" value={counts.ARCHIVED || 0} meta="Retained history" />
        </div>
        <Card className="mb-5">
          <SectionTitle caption="No ad, analytics, or SEO provider reader is connected to this first slice">Measured provider performance</SectionTitle>
          <UnavailableState title="Provider metrics are unavailable" hint="Connect an approved provider reader before showing spend, reach, conversions, or return. Plan intent is not a performance observation." />
        </Card>
        {plans.length === 0 ? (
          <EmptyState
            title="No Marketing plans yet"
            hint="Create a plan to capture objective, audience, channels, budget, and actions as an immutable revision."
            action={data?.canWrite && <Link href={strategyHref} className="btn btn-primary"><Plus size={13} aria-hidden /> Create first plan</Link>}
          />
        ) : (
          <Card>
            <div className="mb-3 flex items-center justify-between gap-2">
              <SectionTitle caption="Real plan records in the active Business">Recent plans</SectionTitle>
              <Link href={strategyHref} className="btn text-[11px]">View Strategy <ArrowRight size={13} aria-hidden /></Link>
            </div>
            {truncated && <TruncationNotice shown={plans.length} limit={100} noun="plans" hint="Open Strategy to work with the records currently returned." />}
            <div className="space-y-2">
              {plans.map((plan) => (
                <Link key={plan.id} href={strategyTabHref('/growth/strategy', 'plans', { planId: plan.id })} className="block rounded-xl border border-[var(--border)] p-3 hover:bg-[var(--brand-surface)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--action-primary)]">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0"><p className="truncate text-xs font-bold">{plan.title || 'Untitled plan'}</p><p className="mt-1 text-[10px] text-muted">{plan.code || plan.id} · revision {plan.currentRevision || 1}</p></div>
                    <StatusPill status={planStatus(plan)} />
                  </div>
                  {plan.progress !== undefined && <div className="mt-2"><ProgressBar percent={plan.progress} label={`${plan.title || 'Plan'} progress`} /></div>}
                </Link>
              ))}
            </div>
            <SourceNote>Marketing plan records. Progress is not inferred from action completion.</SourceNote>
          </Card>
        )}
      </MarketingDataState>
    </main>
  )
}
