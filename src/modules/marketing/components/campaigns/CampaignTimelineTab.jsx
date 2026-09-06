'use client'

// @req FR-156 — Campaign Timeline projects the selected PM receipt schedule,
// dependencies and gates using the authoritative roadmap read model.
// @spec SDD-087, FR-068 — Marketing dates and PM dates remain visibly distinct.
// @tested tests/unit/marketing-campaign-ui.test.js, tests/e2e/marketing-campaigns.spec.js

import { Card, EmptyState, SectionTitle, StatusPill } from '@/components/ui'
import { UnavailableState } from '../MarketingState'
import { campaignExecutionReceipt, campaignExecutionReady } from './campaign-contract'

function dateLabel(value) {
  if (!value) return 'Date unavailable'
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString() : 'Date unavailable'
}

function scheduleRows(roadmap) {
  const rows = []
  if (roadmap?.project) rows.push({ id: `project-${roadmap.project.id}`, label: roadmap.project.name, kind: 'Project', startAt: roadmap.project.startAt, targetAt: roadmap.project.targetAt, status: roadmap.project.status })
  for (const plan of roadmap?.plans || []) rows.push({ id: `plan-${plan.planId}`, label: plan.name, kind: 'Execution plan', startAt: plan.startAt, targetAt: plan.targetAt, status: plan.status })
  for (const container of roadmap?.containers || []) rows.push({ id: `container-${container.containerId}`, label: container.title, kind: container.subtype, startAt: container.startAt, targetAt: container.targetAt, status: container.status })
  for (const item of roadmap?.items || []) rows.push({ id: `item-${item.workItemId}`, label: item.title, kind: item.subtype, startAt: item.startAt, targetAt: item.targetAt, status: item.status })
  return rows.filter((row) => row.startAt || row.targetAt)
}

export default function CampaignTimelineTab({ campaign }) {
  const execution = campaign?.execution
  if (!campaignExecutionReady(campaign)) return <UnavailableState title="Campaign timeline unavailable" hint="A timeline becomes available after this Campaign is bound to a persisted PM handoff receipt." />
  const roadmap = execution.roadmap
  const receipt = campaignExecutionReceipt(campaign)
  const rows = scheduleRows(roadmap)
  return (
    <div className="space-y-4" data-testid="marketing-campaign-timeline">
      <Card>
        <SectionTitle caption="PM execution dates are separate from the Campaign brief calendar">Execution schedule</SectionTitle>
        <p className="mb-3 text-[10px] text-muted">Live PM view from receipt revision {receipt?.revision || 'unavailable'} · {receipt?.isCurrentRevision ? 'current brief' : 'current brief is newer; this receipt is historical'}. The Project roadmap may include later handoff work.</p>
        {rows.length === 0 ? <EmptyState title="No PM dates recorded" hint="The selected receipt has no scheduled Project, execution plan, container or work item dates." /> : <div className="overflow-x-auto"><table className="w-full min-w-[38rem] border-collapse text-xs"><thead><tr className="border-b border-[var(--border)] text-left text-[10px] text-muted"><th className="p-2">Work</th><th className="p-2">Kind</th><th className="p-2">Start</th><th className="p-2">Target</th><th className="p-2">Status</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-b border-[var(--border)] last:border-0"><td className="p-2 font-semibold">{row.label}</td><td className="p-2 text-muted">{row.kind}</td><td className="p-2 text-muted">{dateLabel(row.startAt)}</td><td className="p-2 text-muted">{dateLabel(row.targetAt)}</td><td className="p-2"><StatusPill status={row.status} /></td></tr>)}</tbody></table></div>}
      </Card>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><SectionTitle caption={`${roadmap.dependencies?.items?.length || 0} edges in the PM read model`}>Dependencies</SectionTitle>{roadmap.dependencies?.status === 'UNAVAILABLE' ? <p className="text-xs text-muted">Dependencies unavailable: {roadmap.dependencies.reasonCode || 'No reason provided'}.</p> : roadmap.dependencies?.items?.length ? <ul className="space-y-2 text-xs">{roadmap.dependencies.items.map((edge) => <li key={edge.id} className="rounded-lg bg-[var(--surface-mid)] p-2"><p className="font-semibold">{edge.source?.title || edge.source?.code || 'Source unavailable'} → {edge.target?.title || edge.target?.code || 'Target unavailable'}</p><p className="mt-1 text-[10px] text-muted">{edge.dependencyType} · {edge.blockedReason || 'No blocker reason recorded'}</p></li>)}</ul> : <p className="text-xs text-muted">No project-contained dependencies recorded.</p>}</Card>
        <Card><SectionTitle caption="Readiness gates are owned by Project Manager">Gates</SectionTitle>{roadmap.closure?.gates?.length ? <ul className="space-y-2 text-xs">{roadmap.closure.gates.map((gate) => <li key={gate.id} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-mid)] p-2"><div className="min-w-0"><p className="truncate font-semibold">{gate.title}</p><p className="text-[10px] text-muted">Target: {dateLabel(gate.targetAt)} · {gate.required ? 'Required' : 'Optional'}</p></div><StatusPill status={gate.status} /></li>)}</ul> : <p className="text-xs text-muted">No PM gates recorded.</p>}</Card>
      </div>
    </div>
  )
}
