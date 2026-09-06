'use client'

// @req FR-160 — Campaign Decisions reuses Strategy review/decision evidence,
// explicitly binds one persisted PM receipt, and records required closure text.
// @spec SDD-087, FR-159 — no Campaign-specific approval history or implicit
// latest-receipt switching.
// @tested tests/unit/marketing-campaign-ui.test.js, tests/e2e/marketing-campaigns.spec.js

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Card, Field, SectionTitle, StatusPill } from '@/components/ui'
import { InlineNotice, UnavailableState } from '../MarketingState'
import { strategyTabHref } from '../marketing-contract'
import { campaignHandoffs, campaignIsMutable, campaignPlanIsArchived, formatMarketingDate } from './campaign-contract'

function planVersion(plan, planVersionId) {
  return (plan?.versions || []).find((version) => version.id === planVersionId) || null
}

function revisionLabel(plan, planVersionId, fallbackRevision) {
  const version = planVersion(plan, planVersionId)
  const revision = version?.revision || fallbackRevision || 'unavailable'
  const current = version && plan?.currentVersion?.id === version.id ? 'current' : 'historical'
  return `Revision ${revision} · ${current}`
}

function actorLabel(record, role) {
  return record?.displayName || record?.actorName || record?.reviewerName || record?.[role] || record?.actorId || record?.reviewerId || record?.createdBy || 'Actor unavailable'
}

function targetLabel(handoff) {
  const workspace = handoff?.workspaceName || handoff?.workspaceId || 'Workspace unavailable'
  const project = handoff?.projectName || handoff?.projectId || 'Project unavailable'
  return `${workspace} · ${project}`
}

export default function CampaignDecisionsTab({ campaign, busy, onBindHandoff, onClosure }) {
  const [selectedHandoffId, setSelectedHandoffId] = useState('')
  const [closureAction, setClosureAction] = useState('close')
  const [reason, setReason] = useState('')
  const handoffs = campaignHandoffs(campaign)
  const plan = campaign?.plan
  const mutable = campaignIsMutable(campaign)
  const planArchived = campaignPlanIsArchived(campaign)

  useEffect(() => {
    setSelectedHandoffId(campaign?.handoffId || '')
    setClosureAction('close')
    setReason('')
  }, [campaign?.id, campaign?.handoffId, campaign?.version])

  return (
    <div className="space-y-4" data-testid="marketing-campaign-decisions">
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3"><SectionTitle caption="The same Strategy revision evidence remains the approval authority">Strategy decisions</SectionTitle>{plan?.id && <Link className="btn text-[11px]" href={strategyTabHref('/growth/strategy', 'plans', { planId: plan.id })}>Open Strategy controls</Link>}</div>
        {!plan ? <UnavailableState title="Strategy evidence unavailable" hint="The linked Strategy plan cannot be read in this Business scope." /> : <>
          {(plan.reviews || []).length === 0 && (plan.decisions || []).length === 0 && <p className="text-xs text-muted">No reviews or decisions recorded for the current Campaign plan.</p>}
           {(plan.reviews || []).length > 0 && <section><h3 className="mb-2 text-[11px] font-bold">Review history</h3><ul className="space-y-2">{plan.reviews.map((review) => <li key={review.id} className="rounded-lg border border-[var(--border)] p-2 text-[10px]"><div className="flex flex-wrap items-center gap-2"><StatusPill status={review.verdict} /><span className="text-muted">{formatMarketingDate(review.createdAt)}</span></div><p className="mt-1">{review.rationale || 'No rationale recorded.'}</p><p className="mt-1 text-muted">Reviewer: {actorLabel(review, 'reviewerId')} · {revisionLabel(plan, review.planVersionId)}</p><p className="text-muted">Payload hash: {review.payloadHash || 'unavailable'}</p></li>)}</ul></section>}
           {(plan.decisions || []).length > 0 && <section className="mt-4"><h3 className="mb-2 text-[11px] font-bold">Decision history</h3><ul className="space-y-2">{plan.decisions.map((decision) => <li key={decision.id} className="rounded-lg border border-[var(--border)] p-2 text-[10px]"><div className="flex flex-wrap items-center gap-2"><StatusPill status={decision.verdict} /><span className="text-muted">{formatMarketingDate(decision.createdAt)}</span></div><p className="mt-1">{decision.rationale || 'No rationale recorded.'}</p><p className="mt-1 text-muted">Actor: {actorLabel(decision, 'actorId')} · {revisionLabel(plan, decision.planVersionId)}</p><p className="text-muted">Payload hash: {decision.payloadHash || 'unavailable'} · Expires: {decision.expiresAt ? formatMarketingDate(decision.expiresAt) : 'Not applicable'}</p></li>)}</ul></section>}
        </>}
      </Card>

      <Card>
        <SectionTitle caption="A Campaign uses an explicit persisted receipt; changing it never silently selects the latest handoff">PM receipt selection</SectionTitle>
        {handoffs.length === 0 ? <UnavailableState title="No persisted PM receipt" hint="Approve and commit a Strategy handoff before binding PM execution to this Campaign." /> : <>
           <Field label="Execution receipt" hint="Receipt selection is versioned and Business-scoped."><select className="input" value={selectedHandoffId} onChange={(event) => setSelectedHandoffId(event.target.value)} disabled={busy || !mutable || planArchived} aria-label="Execution receipt"><option value="">Choose a persisted receipt</option>{handoffs.map((handoff) => <option key={handoff.id} value={handoff.id}>{revisionLabel(plan, handoff.planVersionId, handoff.revision)} · {targetLabel(handoff)} · {formatMarketingDate(handoff.createdAt)}</option>)}</select></Field>
          {planArchived && <InlineNotice>Receipt binding is disabled because the linked Strategy plan is archived. Close or cancel remains available while this initiative is open.</InlineNotice>}
          {!mutable && !planArchived && <InlineNotice>Receipt selection is read-only for this Campaign or Business grant.</InlineNotice>}
          {mutable && !planArchived && <button type="button" className="btn btn-primary text-[11px]" disabled={busy || !selectedHandoffId || selectedHandoffId === campaign.handoffId} onClick={() => onBindHandoff(selectedHandoffId)}>Bind selected receipt</button>}
          {campaign.execution?.status === 'READY' && <p className="mt-2 text-[10px] text-muted">Bound execution: {campaign.execution.handoff?.revision ? `revision ${campaign.execution.handoff.revision}` : 'saved receipt'} · PM roadmap is read from that exact receipt.</p>}
        </>}
      </Card>

       {mutable && <Card><SectionTitle caption="Closing or cancelling records a reason and does not stop PM or external work">Campaign lifecycle</SectionTitle><form className="space-y-2" onSubmit={(event) => { event.preventDefault(); onClosure(closureAction, reason.trim()) }}><div className="grid gap-3 sm:grid-cols-2"><Field label="Action"><select className="input" value={closureAction} onChange={(event) => setClosureAction(event.target.value)} disabled={busy}><option value="close">Close campaign</option><option value="cancel">Cancel campaign</option></select></Field><Field label="Closure reason"><textarea className="input min-h-20" value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={4000} disabled={busy} /></Field></div><button type="submit" className="btn btn-primary text-[11px]" disabled={busy || reason.trim().length < 1}>{busy ? 'Saving…' : closureAction === 'close' ? 'Close campaign' : 'Cancel campaign'}</button></form></Card>}
       {(campaign.status === 'CLOSED' || campaign.status === 'CANCELLED') && <><InlineNotice>{campaign.status === 'CLOSED' ? 'This Campaign is closed and read-only.' : 'This Campaign is cancelled and read-only.'}</InlineNotice>{campaign.closureReason && <Card data-testid="marketing-campaign-closure-reason"><SectionTitle caption="Saved with the Campaign lifecycle record">{campaign.status === 'CLOSED' ? 'Closure debrief' : 'Cancellation reason'}</SectionTitle><p className="whitespace-pre-wrap text-xs">{campaign.closureReason}</p></Card>}</>}
    </div>
  )
}
