'use client'

import { useParams } from 'next/navigation'
import { Card, EmptyState, ErrorState, Kpi, PageHeader, ProgressBar, SectionTitle, StatusPill } from '@/components/ui'
import { LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'
import WorkViewTabs from '@/modules/project-manager/components/WorkViewTabs'
import { MODE_LABELS } from '@/lib/validation/enums'
import { formatProgressPercent } from '@/modules/project-manager/progress/strategies'
import { humanizeEnumValue, reasonLabel, resolveContainerLabel, resolveItemLabel } from '@/modules/project-manager/application/project-roadmap-labels'

// @req FR-068 — Human-visible Execution Roadmap includes Business Goals and
// the same Project execution hierarchy used by the other Work views.
// @spec SDD-039, ADR-028, FR-070
// @tested tests/unit/project-roadmap-ui.test.js

function dateLabel(value) {
  if (!value) return '—'
  return new Date(value).toLocaleDateString()
}

function Unavailable({ value }) {
  if (!value || value.status !== 'UNAVAILABLE') return null
  return <span className="text-[11px] text-muted" title={value.reasonCode}>{reasonLabel(value.reasonCode)}</span>
}

function ContractValue({ label, value }) {
  if (value?.status === 'UNAVAILABLE') {
    return <span>{label}: <Unavailable value={value} /></span>
  }
  if (Array.isArray(value)) return <span>{label}: {value.length ? value.join(', ') : '—'}</span>
  return <span>{label}: {value || '—'}</span>
}

function EvidenceKeys({ evidence }) {
  const keys = Object.keys(evidence || {})
  return <span>{keys.length ? keys.join(', ') : 'No progress evidence recorded.'}</span>
}

function GoalCard({ goal }) {
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] text-muted">{goal.code} · Business Goal</p>
          <h3 className="truncate text-sm font-bold">{goal.title}</h3>
          {goal.description && <p className="mt-1 text-xs text-muted">{goal.description}</p>}
        </div>
        <StatusPill status={goal.status} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <ProgressBar percent={goal.progress} label="Business Goal progress" />
        <span className="shrink-0 text-xs font-bold">{goal.progress}%</span>
      </div>
      <p className="mt-2 text-[10px] text-muted">Target: {dateLabel(goal.targetAt)}</p>
    </Card>
  )
}

function WorkItemRow({ item }) {
  return (
    <div aria-label={`${item.title} work item details`} className="rounded-lg border border-[var(--border)] bg-[var(--surface-card)] px-3 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] text-muted" title={`${item.typedId.key} = ${item.typedId.value}`}>{item.code} · {item.subtype}</p>
          <p className="truncate text-xs font-semibold">{item.title}</p>
        </div>
        <StatusPill status={item.status} />
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted">
        <span>Target: {dateLabel(item.targetAt)}</span>
        <span>Start: {dateLabel(item.startAt)}</span>
        {item.assignee.status === 'READY' ? <span>Owner: {item.assignee.displayName}</span> : <Unavailable value={item.assignee} />}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted" aria-label="Work item contract fields">
        <ContractValue label="Tags" value={item.tags} />
        <ContractValue label="Criteria" value={item.criteria} />
        <ContractValue label="Completion evidence" value={item.evidence} />
      </div>
    </div>
  )
}

function PlanSection({ plan, containers, items }) {
  const planContainers = containers.filter((container) => container.planId === plan.planId)
  const planItems = items.filter((item) => item.planId === plan.planId)
  return (
    <Card>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] text-muted" title={`Plan ID: ${plan.planId}`}>{plan.planCode} · {MODE_LABELS[plan.executionModeId] || plan.executionModeId}</p>
          <h3 className="text-sm font-bold">{plan.name}</h3>
          <p className="mt-1 text-[10px] text-muted">{plan.displayVocabulary.containers.join(' → ')} → {plan.displayVocabulary.items.join(' / ')}</p>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted" aria-label="Execution plan identities">
            <span>Execution contract: {plan.executionContractId || '—'}</span>
            <span title={plan.currentContainerId ? `Current container ID: ${plan.currentContainerId}` : undefined}>
              Current container: {resolveContainerLabel(containers, plan.currentContainerId) || '—'}
            </span>
          </div>
        </div>
        <StatusPill status={plan.status} />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <ProgressBar percent={plan.progress.percent} label={`${plan.name} progress`} />
        <span className="shrink-0 text-xs font-bold">{formatProgressPercent(plan.progress.percent)}</span>
      </div>
      <p className="mt-2 text-[10px] text-muted">Progress evidence: <EvidenceKeys evidence={plan.progress.evidence} /></p>
      <div className="mt-3 space-y-2">
        {planContainers.map((container) => (
          <div key={container.containerId} className="rounded-lg bg-[var(--surface-mid)] px-3 py-2">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-[10px] text-muted" title={`${container.typedId.key} = ${container.typedId.value}`}>{container.code} · {container.subtype}</p>
                <p className="text-xs font-semibold">{container.title}</p>
              </div>
              <StatusPill status={container.status} />
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted" aria-label="Execution container contract fields">
              <span title={container.parentContainerId ? `Parent container ID: ${container.parentContainerId}` : undefined}>
                Parent: {resolveContainerLabel(containers, container.parentContainerId) || '—'}
              </span>
              <span>Start: {dateLabel(container.startAt)}</span>
              <span>Target: {dateLabel(container.targetAt)}</span>
              <ContractValue label="Progress evidence" value={container.progressEvidence} />
              <span>Closure: {container.closure.completed} completed · {container.closure.open} open · {container.closure.blocked} blocked · {container.closure.carryOver ?? '—'} carry-over</span>
            </div>
            <div className="mt-2 space-y-2">
              {planItems.filter((item) => item.containerId === container.containerId).map((item) => <WorkItemRow key={item.workItemId} item={item} />)}
            </div>
          </div>
        ))}
        {planItems.filter((item) => item.containerId === null).map((item) => <WorkItemRow key={item.workItemId} item={item} />)}
        {!planContainers.length && !planItems.length && <p className="text-xs text-muted">No work recorded.</p>}
      </div>
    </Card>
  )
}

export default function ProjectRoadmapPage() {
  const { projectId } = useParams()
  const roadmap = useFetch(projectId ? `/api/projects/${projectId}/roadmap` : null)

  if (roadmap.loading) return <LoadingCard />
  if (roadmap.error) return <ErrorState title="Execution Roadmap unavailable" detail={roadmap.error} retry={roadmap.reload} />
  if (!roadmap.data) return <ErrorState title="Project not found" />

  const data = roadmap.data
  return (
    <div>
      <PageHeader
        eyebrow="Project Work · Execution Roadmap"
        title={data.project.name}
        subtitle={`${data.project.code} · one read model over the Project execution graph`}
        actions={<StatusPill status={data.project.status} />}
      />
      <WorkViewTabs projectId={projectId} />

      <div className="mb-4 grid grid-cols-5 gap-3 max-xl:grid-cols-3 max-md:grid-cols-2">
        <Kpi label="Total work" value={data.summary.total} />
        <Kpi label="Backlog" value={data.summary.backlog} />
        <Kpi label="Open" value={data.summary.open} />
        <Kpi label="Completed" value={data.summary.completed} tone="good" />
        <Kpi label="Blocked" value={data.summary.blocked} tone={data.summary.blocked ? 'warn' : 'good'} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 max-lg:grid-cols-1">
        <Card warm>
          <SectionTitle caption="Strategy-based Project roll-up">Project progress</SectionTitle>
          <div className="flex items-center gap-3">
            <ProgressBar percent={data.project.progress.percent} label="Project progress" />
            <span className="shrink-0 text-sm font-bold">{formatProgressPercent(data.project.progress.percent)}</span>
          </div>
          {data.project.progress.warnings.length > 0 && <p className="mt-2 text-[10px] text-muted">{data.project.progress.warnings.join(' ')}</p>}
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-muted" aria-label="Project roadmap references">
            <ContractValue label="Linked Business Goal IDs" value={data.project.goalIds} />
            <ContractValue label="Project risk IDs" value={data.project.riskIds} />
            <ContractValue label="Active source" value={data.sources} />
          </div>
        </Card>
        <Card>
          <SectionTitle caption={`Deadline: ${humanizeEnumValue(data.summary.deadlineState)}`}>Project outcome</SectionTitle>
          <p className="text-sm font-semibold">{data.project.outcome || 'No project outcome recorded.'}</p>
          <p className="mt-2 text-[10px] text-muted">Target: {dateLabel(data.project.targetAt)}</p>
          <div className="mt-2"><Unavailable value={data.project.accountableOwner} /></div>
        </Card>
      </div>

      <section aria-labelledby="business-goals-heading" className="mb-4">
        <div id="business-goals-heading"><SectionTitle caption="Read-only projections owned by Business Strategy">Business Goals</SectionTitle></div>
        {data.goals.length === 0 ? (
          <EmptyState title="No Business Goals linked" hint="The Project outcome remains independent; link an existing Business Goal from Business Strategy." />
        ) : (
          <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">{data.goals.map((goal) => <GoalCard key={goal.id} goal={goal} />)}</div>
        )}
      </section>

      <section aria-labelledby="plans-heading" className="mb-4">
        <div id="plans-heading"><SectionTitle caption="One neutral hierarchy with mode-specific vocabulary">Execution Plans</SectionTitle></div>
        {data.plans.length === 0 ? <EmptyState title="No execution plans" hint="Import an Agent PlanEnvelope to populate the Roadmap." /> : (
          <div className="space-y-3">{data.plans.map((plan) => <PlanSection key={plan.planId} plan={plan} containers={data.containers} items={data.items} />)}</div>
        )}
      </section>

      <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
        <Card>
          <SectionTitle caption={`${data.dependencies.items.length} project-contained edges`}>Dependencies and blockers</SectionTitle>
          <ul aria-label="Roadmap dependency list" className="space-y-2">
            {data.dependencies.items.length === 0 ? <li className="text-xs text-muted">No project-contained dependencies.</li> : data.dependencies.items.map((edge) => (
              <li
                key={edge.id}
                className="rounded-lg bg-[var(--surface-mid)] px-3 py-2 text-xs"
                title={`${edge.source.endpointType}:${edge.source.endpointId} → ${edge.target.endpointType}:${edge.target.endpointId}`}
              >
                <p><span className="font-semibold">{edge.source.code || edge.source.title}</span> → <span className="font-semibold">{edge.target.code || edge.target.title}</span> <span className="ml-2 text-muted">{edge.dependencyType}</span></p>
                <p className="mt-1 text-[10px] text-muted">Blocked reason: {edge.blockedReason || '—'} · Affected item: {resolveItemLabel(data.items, edge.affectedItemId) || '—'}</p>
                <p className="text-[10px] text-muted">Blocker owner: {edge.blockingOwner?.status === 'UNAVAILABLE' ? <Unavailable value={edge.blockingOwner} /> : edge.blockingOwner?.displayName || '—'}</p>
              </li>
            ))}
          </ul>
        </Card>
        <Card>
          <SectionTitle caption="Required gates and close decision">Closure</SectionTitle>
          <p className="text-xs">Completed: {data.closure.summary.completed} · Open: {data.closure.summary.open} · Blocked: {data.closure.summary.blocked}</p>
          <p className="mt-1 text-xs">Carry-over: {data.closure.summary.carryOver ?? '—'}</p>
          <div className="mt-2"><Unavailable value={data.closure.decision} /></div>
          <div className="mt-3 space-y-1 text-xs">
            {data.closure.gates.length === 0 ? <p className="text-muted">No gates recorded.</p> : data.closure.gates.map((gate) => (
              <p key={gate.id} title={`Gate ID: ${gate.id}`}>{gate.code} · {gate.title} · {gate.status} · Evidence: {gate.evidencePresent ? 'present' : 'unavailable'}</p>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle caption="Supporting references remain read-only and explicit">Identity references</SectionTitle>
        <div aria-label="Roadmap identity references" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
          <ContractValue label="Identity references" value={data.identityRefs} />
        </div>
      </Card>

      <p className="mt-4 text-[10px] text-muted">Business Goals remain owned by Business Strategy. Risks, tags, criteria, source and closure decision fields are explicit unavailable data until their owning contracts exist.</p>
    </div>
  )
}
