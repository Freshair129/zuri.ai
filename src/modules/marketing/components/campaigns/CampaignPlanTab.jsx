'use client'

// @req FR-156 — Campaign Plan reads the selected persisted PM handoff roadmap.
// @spec SDD-087, FR-068 — Marketing projects work; it does not create a second
// WorkItem store or infer execution from planning actions.
// @tested tests/unit/marketing-campaign-ui.test.js, tests/e2e/marketing-campaigns.spec.js

import Link from 'next/link'
import { Card, EmptyState, ProgressBar, SectionTitle, StatusPill } from '@/components/ui'
import { formatProgressPercent } from '@/modules/project-manager/progress/strategies'
import { UnavailableState } from '../MarketingState'
import { campaignExecutionReceipt, campaignExecutionReady } from './campaign-contract'

function dateLabel(value) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : 'Date unavailable'
}

function HandoffLink({ execution }) {
  const projectId = execution?.handoff?.projectId
  if (!projectId) return null
  return <Link className="btn text-[11px]" href={`/projects/${encodeURIComponent(projectId)}/roadmap`}>Open PM roadmap</Link>
}

function WorkItem({ item }) {
  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-2">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-xs font-semibold">{item.title}</p><p className="text-[10px] text-muted">{item.subtype || 'Work item'} · {item.code}</p></div><StatusPill status={item.status} /></div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-muted"><span>Start: {dateLabel(item.startAt)}</span><span>Target: {dateLabel(item.targetAt)}</span>{item.assignee?.status === 'READY' ? <span>Owner: {item.assignee.displayName}</span> : <span>Owner unavailable</span>}</div>
    </li>
  )
}

function ExecutionPlan({ plan, containers, items }) {
  const planContainers = containers.filter((container) => container.planId === plan.planId)
  const planItems = items.filter((item) => item.planId === plan.planId)
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><p className="text-[10px] text-muted">{plan.name}</p><h3 className="text-sm font-bold">{plan.displayVocabulary?.containers?.join(' → ') || 'Execution plan'}</h3><p className="mt-1 text-[10px] text-muted">{plan.displayVocabulary?.items?.join(' / ') || 'Work items'}</p></div><StatusPill status={plan.status} /></div>
       {plan.progress && <div className="mt-3"><p className="mb-1 text-[10px] text-muted">PM execution progress (not Marketing results)</p><div className="flex items-center gap-3"><ProgressBar percent={plan.progress.percent} label={`${plan.name} PM execution progress`} /><span className="shrink-0 text-xs font-bold">{formatProgressPercent(plan.progress.percent)}</span></div>{plan.progress.warnings?.length > 0 && <p className="mt-2 text-[10px] text-muted">{plan.progress.warnings.join(' ')}</p>}{(!plan.progress.evidence || !Array.isArray(plan.progress.evidence.kpis) || plan.progress.evidence.kpis.length === 0) && <p className="mt-1 text-[10px] text-muted">PM KPI targets or observations are unavailable; this value does not assert campaign success.</p>}</div>}
      <div className="mt-3 space-y-3">
        {planContainers.map((container) => {
          const children = planItems.filter((item) => item.containerId === container.containerId)
          return <section key={container.containerId} className="rounded-lg bg-[var(--surface-mid)] p-2" aria-label={`${container.title} execution container`}><div className="flex items-start justify-between gap-2"><div><p className="text-[10px] text-muted">{container.subtype} · {container.code}</p><p className="text-xs font-semibold">{container.title}</p></div><StatusPill status={container.status} /></div><p className="mt-1 text-[10px] text-muted">Start: {dateLabel(container.startAt)} · Target: {dateLabel(container.targetAt)}</p>{children.length > 0 ? <ul className="mt-2 space-y-2">{children.map((item) => <WorkItem key={item.workItemId} item={item} />)}</ul> : <p className="mt-2 text-[10px] text-muted">No work items recorded in this container.</p>}</section>
        })}
        {planItems.filter((item) => item.containerId === null).length > 0 && <ul className="space-y-2">{planItems.filter((item) => item.containerId === null).map((item) => <WorkItem key={item.workItemId} item={item} />)}</ul>}
        {!planContainers.length && !planItems.length && <EmptyState title="No PM work recorded" hint="The selected receipt is valid, but its execution roadmap has no work items yet." />}
      </div>
    </Card>
  )
}

export default function CampaignPlanTab({ campaign }) {
  const execution = campaign?.execution
  if (!campaignExecutionReady(campaign)) return <UnavailableState title="Execution plan unavailable" hint="Select a persisted PM handoff receipt before viewing execution work." />
  const roadmap = execution.roadmap
  const receipt = campaignExecutionReceipt(campaign)
  const plans = Array.isArray(roadmap.plans) ? roadmap.plans : []
  const containers = Array.isArray(roadmap.containers) ? roadmap.containers : []
  const items = Array.isArray(roadmap.items) ? roadmap.items : []
  return (
    <div className="space-y-4" data-testid="marketing-campaign-plan">
      <Card warm><div className="flex flex-wrap items-center justify-between gap-3"><div><SectionTitle caption="Read from the selected PM receipt; Marketing does not duplicate work">Project Manager execution</SectionTitle><p className="text-xs text-muted">{roadmap.project?.name || 'Project name unavailable'} · {roadmap.project?.status || 'Status unavailable'}</p><p className="mt-1 text-[10px] text-muted">Live PM view from receipt revision {receipt?.revision || 'unavailable'} · {receipt?.isCurrentRevision ? 'current brief' : 'current brief is newer; this receipt is historical'}. The Project roadmap may include later handoff work.</p></div><HandoffLink execution={execution} /></div>{roadmap.meta?.warnings?.length > 0 && <p className="mt-2 text-[10px] text-muted">{roadmap.meta.warnings.join(' ')}</p>}</Card>
      {plans.length === 0 ? <EmptyState title="No execution plans" hint="The selected PM roadmap does not contain a B2C campaign workstream yet." /> : plans.map((plan) => <ExecutionPlan key={plan.planId} plan={plan} containers={containers} items={items} />)}
    </div>
  )
}
