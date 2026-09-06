'use client'

// @req FR-157 — Content revisions, review evidence and decisions remain
// inspectable after later edits.
// @spec ZAI:FR-157-NOTE — every review and decision binds contentVersionId and
// payloadHash; old versions never inherit current approval.
// @tested tests/unit/marketing-content-ui.test.js, tests/e2e/marketing-content.spec.js

import { useMemo } from 'react'
import { Card, SectionTitle, StatusPill } from '@/components/ui'
import {
  contentChannelLabel,
  contentVersionDiff,
  currentContentVersion,
  formatContentDateTime,
} from './content-contract'

const FIELD_LABELS = {
  objective: 'Objective',
  audience: 'Audience',
  message: 'Primary message',
  claims: 'Claims',
  shotList: 'Shot list',
  acceptanceCriteria: 'Acceptance criteria',
  evidenceReference: 'Evidence reference',
  format: 'Format',
  channels: 'Channels',
  initiativeId: 'Campaign reference',
  asset: 'File reference',
  rights: 'Usage rights',
  production: 'Production reference',
}

function fieldLabel(key) {
  return FIELD_LABELS[key] || key
}

function valueText(key, value) {
  if (value === null || value === undefined || value === '') return 'Not recorded'
  if (key === 'channels') return Array.isArray(value) ? value.map(contentChannelLabel).join(' · ') || 'Not recorded' : String(value)
  if (key === 'asset') return value?.fileId ? `File ${value.fileId}` : 'No file linked'
  if (key === 'rights') {
    if (!value) return 'No usage rights recorded'
    return [
      value.holder && `Holder: ${value.holder}`,
      value.license && `License: ${value.license}`,
      value.channels?.length && `Channels: ${value.channels.map(contentChannelLabel).join(' · ')}`,
      value.validFrom && `From: ${formatContentDateTime(value.validFrom)}`,
      value.validUntil && `Until: ${formatContentDateTime(value.validUntil)}`,
      value.proof && `Proof: ${value.proof}`,
    ].filter(Boolean).join(' · ') || 'No usage rights recorded'
  }
  if (key === 'production') return value?.projectId ? `Project ${value.projectId}${value.workItemId ? ` · WorkItem ${value.workItemId}` : ''}` : 'No PM work linked'
  return String(value)
}

function actorLabel(row, primaryKey) {
  return row?.[primaryKey]?.displayName || row?.[primaryKey] || 'Actor unavailable'
}

function versionById(versions) {
  return new Map((versions || []).map((version) => [version.id, version]))
}

export function ContentVersionHistory({ brief }) {
  const versions = useMemo(() => [...(brief?.versions || [])].sort((left, right) => Number(right.revision || 0) - Number(left.revision || 0)), [brief?.versions])
  const current = currentContentVersion(brief)
  if (!versions.length) return <Card data-testid="marketing-content-versions"><SectionTitle caption="Immutable content artifacts remain reviewable">Version history</SectionTitle><p className="text-xs text-muted">No saved content revision is available.</p></Card>

  return <Card data-testid="marketing-content-versions">
    <SectionTitle caption="Each revision is an immutable creative intent and output reference">Version history</SectionTitle>
    <div className="space-y-3">
      {versions.map((version, index) => {
        const previous = versions[index + 1]
        const changed = previous ? contentVersionDiff(previous.payload, version.payload) : []
        const payload = version.payload || {}
        return <details key={version.id} open={index === 0} className="rounded-xl border border-[var(--border)] p-3">
          <summary className="cursor-pointer list-none"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-bold">Revision {version.revision || index + 1}{version.id === current?.id ? ' · current' : ' · historical'}</p><p className="mt-1 text-[10px] text-muted">Created {formatContentDateTime(version.createdAt)} · Owner {actorLabel(version, 'createdBy')}</p></div><StatusPill status={version.id === current?.id ? 'ACTIVE' : 'ARCHIVED'} /></div></summary>
          <div className="mt-3 space-y-3">
            <div className="rounded-lg bg-[var(--surface-mid)] p-3"><p className="text-[10px] font-bold text-muted">Saved content</p><dl className="mt-2 grid gap-x-4 gap-y-2 sm:grid-cols-2">{Object.entries(payload).filter(([key]) => key !== 'rights' && key !== 'asset' && key !== 'production').map(([key, value]) => <div key={key}><dt className="text-[10px] text-muted">{fieldLabel(key)}</dt><dd className="mt-0.5 whitespace-pre-wrap text-xs">{valueText(key, value)}</dd></div>)}</dl><div className="mt-2 space-y-1 text-xs"><p><span className="text-[10px] text-muted">File:</span> {valueText('asset', payload.asset)}</p><p><span className="text-[10px] text-muted">Rights:</span> {valueText('rights', payload.rights)}</p><p><span className="text-[10px] text-muted">Production:</span> {valueText('production', payload.production)}</p></div></div>
            {previous && <div><p className="text-[10px] font-bold text-muted">Before / after revision {previous.revision || index}</p>{changed.length ? <dl className="mt-2 space-y-2">{changed.map((key) => <div key={key} className="rounded-lg border border-[var(--border)] p-2"><dt className="text-[10px] font-semibold">{fieldLabel(key)}</dt><dd className="mt-1 grid gap-1 text-xs sm:grid-cols-2"><span><span className="text-[10px] text-muted">Before:</span> {valueText(key, previous.payload?.[key])}</span><span><span className="text-[10px] text-muted">After:</span> {valueText(key, payload[key])}</span></dd></div>)}</dl> : <p className="mt-1 text-xs text-muted">No content fields changed.</p>}</div>}
          </div>
        </details>
      })}
    </div>
  </Card>
}

export function ContentReviewDecisionHistory({ brief }) {
  const versions = versionById(brief?.versions)
  const reviews = Array.isArray(brief?.reviews) ? brief.reviews : []
  const decisions = Array.isArray(brief?.decisions) ? brief.decisions : []
  return <div className="space-y-4" data-testid="marketing-content-decisions">
    <Card>
      <SectionTitle caption="Independent human review binds the exact immutable revision">Reviews</SectionTitle>
      {reviews.length === 0 ? <p className="text-xs text-muted">No review has been recorded for the current content.</p> : <div className="space-y-2">{reviews.map((review) => <div key={review.id} className="rounded-lg border border-[var(--border)] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold">{review.verdict === 'PASS' ? 'Pass' : 'Changes required'} · Revision {versions.get(review.contentVersionId)?.revision || 'unavailable'}</p><p className="mt-1 text-[10px] text-muted">Reviewer: {actorLabel(review, 'reviewerId')} · {formatContentDateTime(review.createdAt)}</p></div><StatusPill status={review.verdict || 'UNKNOWN'} /></div><p className="mt-2 whitespace-pre-wrap text-xs">{review.rationale || 'No rationale recorded.'}</p>{review.verdict === 'PASS' && <p className="mt-1 text-[10px] text-muted">Rights confirmed: {review.rightsConfirmed ? 'yes' : 'no'} · Brand confirmed: {review.brandConfirmed ? 'yes' : 'no'}</p>}</div>)}</div>}
    </Card>
    <Card>
      <SectionTitle caption="Approval decisions can be revoked and never overwrite history">Decisions</SectionTitle>
      {decisions.length === 0 ? <p className="text-xs text-muted">No human decision has been recorded.</p> : <div className="space-y-2">{decisions.map((decision) => <div key={decision.id} className="rounded-lg border border-[var(--border)] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold">{decision.verdict === 'APPROVE' ? 'Approve' : decision.verdict === 'REVOKE' ? 'Revoke approval' : 'Reject'} · Revision {versions.get(decision.contentVersionId)?.revision || 'unavailable'}</p><p className="mt-1 text-[10px] text-muted">Actor: {actorLabel(decision, 'actorId')} · {formatContentDateTime(decision.createdAt)}</p></div><StatusPill status={decision.verdict || 'UNKNOWN'} /></div><p className="mt-2 whitespace-pre-wrap text-xs">{decision.rationale || 'No rationale recorded.'}</p>{decision.expiresAt && <p className="mt-1 text-[10px] text-muted">Expires: {formatContentDateTime(decision.expiresAt)}</p>}</div>)}</div>}
    </Card>
  </div>
}
