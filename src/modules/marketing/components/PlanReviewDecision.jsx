'use client'

// @req FR-153 — authenticated human reviewers and decision actors operate on
// exact version/hash bindings with visible stale/conflict errors.
// @spec SDD-086 — independent review requires another real user; no simulated
// agent can satisfy the independence rule.
// @tested tests/unit/marketing-strategy-ui.test.js, tests/e2e/marketing-strategy.spec.js

import { useState } from 'react'
import { Card, Field, SectionTitle, StatusPill } from '@/components/ui'
import { approvalState, canReviewPlan, currentPlanVersion, formatMarketingDate } from './marketing-contract'
import { InlineNotice } from './MarketingState'

export function PlanReviewDecision({ plan, viewerId, onReview, onDecision, busy = false }) {
  const version = currentPlanVersion(plan)
  const [reviewRationale, setReviewRationale] = useState('')
  const [reviewVerdict, setReviewVerdict] = useState('PASS')
  const [decisionRationale, setDecisionRationale] = useState('')
  const [decisionVerdict, setDecisionVerdict] = useState('APPROVE')
  const [expiresAt, setExpiresAt] = useState('')
  const state = approvalState(plan)
  const independent = canReviewPlan(plan, viewerId)
  const passReview = state.review
  const approvalReady = Boolean(passReview && expiresAt && new Date(expiresAt).getTime() > Date.now())

  if (!version) return null
  return (
    <Card className="mb-4" data-testid="marketing-plan-review">
      <SectionTitle caption="Review and decision records bind to this exact revision and hash">Review and decision</SectionTitle>
      {!independent && <InlineNotice>Independent review requires another real user than the revision author. No simulated agent can provide that review.</InlineNotice>}
      {independent && (
        <form
          className="mt-3 rounded-xl border border-[var(--border)] p-3"
          onSubmit={(event) => { event.preventDefault(); onReview({ planVersionId: version.id, payloadHash: version.payloadHash, verdict: reviewVerdict, rationale: reviewRationale.trim() }) }}
        >
          <p className="mb-2 text-xs font-bold">Submit independent review</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Verdict"><select className="input" value={reviewVerdict} onChange={(event) => setReviewVerdict(event.target.value)} disabled={busy}><option value="PASS">Pass</option><option value="CHANGES_REQUIRED">Changes required</option></select></Field>
            <Field label="Rationale"><textarea className="input min-h-20" value={reviewRationale} onChange={(event) => setReviewRationale(event.target.value)} required disabled={busy} /></Field>
          </div>
          <button type="submit" className="btn btn-primary text-[11px]" disabled={busy}>Record review</button>
        </form>
      )}
      <form
        className="mt-3 rounded-xl border border-[var(--border)] p-3"
        onSubmit={(event) => {
          event.preventDefault()
          onDecision({ planVersionId: version.id, payloadHash: version.payloadHash, reviewId: passReview?.id, verdict: decisionVerdict, rationale: decisionRationale.trim(), expiresAt: decisionVerdict === 'APPROVE' ? new Date(expiresAt).toISOString() : undefined })
        }}
      >
        <p className="mb-2 text-xs font-bold">Record human decision</p>
        {decisionVerdict === 'APPROVE' && !passReview && <InlineNotice tone="error">Approval is disabled until this revision has a matching PASS review.</InlineNotice>}
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Decision"><select className="input" value={decisionVerdict} onChange={(event) => setDecisionVerdict(event.target.value)} disabled={busy}><option value="APPROVE">Approve</option><option value="REJECT">Reject</option><option value="REVOKE">Revoke approval</option></select></Field>
          <Field label="Rationale"><textarea className="input min-h-20" value={decisionRationale} onChange={(event) => setDecisionRationale(event.target.value)} required disabled={busy} /></Field>
          <Field label="Approval expires" hint="Required only for APPROVE"><input className="input" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} disabled={busy || decisionVerdict !== 'APPROVE'} /></Field>
        </div>
        <button type="submit" className="btn btn-primary text-[11px]" disabled={busy || (decisionVerdict === 'APPROVE' && !approvalReady)}>Record decision</button>
      </form>
      {(plan.reviews || []).length > 0 && <div className="mt-4"><p className="mb-2 text-[11px] font-bold">Review history</p><ul className="space-y-1 text-[10px] text-muted">{plan.reviews.map((review) => <li key={review.id}>{review.verdict} · {formatMarketingDate(review.createdAt)} · {review.rationale}</li>)}</ul></div>}
      {(plan.decisions || []).length > 0 && <div className="mt-4"><p className="mb-2 text-[11px] font-bold">Decision history</p><ul className="space-y-1 text-[10px] text-muted">{plan.decisions.map((decision) => <li key={decision.id}><StatusPill status={decision.verdict} /> <span className="ml-1">{formatMarketingDate(decision.createdAt)} · {decision.rationale}</span></li>)}</ul></div>}
    </Card>
  )
}
