'use client'

// @req FR-157 — Content brief detail supports immutable revisions, human review,
// approval decisions and archive with exact Business/version guards.
// @spec ZAI:FR-157-NOTE — the server remains authoritative for independence,
// rights windows, file fingerprints and PM references.
// @tested tests/unit/marketing-content-ui.test.js, tests/e2e/marketing-content.spec.js

import Link from 'next/link'
import { ArrowLeft, Archive, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Card, ErrorState, Field, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { api, LoadingCard, useFetch } from '@/modules/project-manager/components/useApi'
import { MarketingDataState, InlineNotice, ScopeNotice } from '../MarketingState'
import {
  contentAssetPagePath,
  contentBriefApiPath,
  contentChannelLabel,
  contentFormatLabel,
  contentOwnerLabel,
  contentVersionPayload,
  currentContentVersion,
  formatContentDateTime,
  latestContentPassReview,
} from './content-contract'
import ContentBriefForm from './ContentBriefForm'
import { ContentReviewDecisionHistory, ContentVersionHistory } from './ContentVersionHistory'

function responseBrief(data) {
  return data?.brief || data?.contentBrief || data || null
}

function responseForScope(data, businessId, briefId) {
  const value = responseBrief(data)
  if (!value || (value.id && value.id !== briefId) || (value.businessId && value.businessId !== businessId)) return null
  return value
}

function latestPassReview(brief, version) {
  return latestContentPassReview(brief, version)
}

function actorLabel(value) {
  return value?.displayName || value || 'Actor unavailable'
}

function ReferenceRow({ label, children, status }) {
  return <div className="rounded-lg border border-[var(--border)] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><p className="text-[10px] font-bold text-muted">{label}</p>{status && <StatusPill status={status} />}</div><p className="mt-1 text-xs">{children}</p></div>
}

function BriefRead({ brief }) {
  const version = currentContentVersion(brief)
  const payload = contentVersionPayload(version)
  const references = brief.references || {}
  const assetReference = references.asset || references.file || null
  const productionReference = references.production || null
  const initiative = references.initiative || brief.initiative || null
  const assetVersionId = payload.asset ? version?.id : null
  return <div className="space-y-4" data-testid="marketing-content-brief">
    <Card warm>
      <div className="flex flex-wrap items-start justify-between gap-3"><SectionTitle caption="Saved content from the current immutable revision">Brief intent</SectionTitle><StatusPill status={brief.phase || brief.status || 'DRAFT'} /></div>
      <dl className="grid gap-x-4 gap-y-3 text-xs sm:grid-cols-2">
        <div><dt className="text-[10px] text-muted">Objective</dt><dd className="mt-1 whitespace-pre-wrap">{payload.objective || 'Objective unavailable'}</dd></div>
        <div><dt className="text-[10px] text-muted">Audience</dt><dd className="mt-1 whitespace-pre-wrap">{payload.audience || 'Audience unavailable'}</dd></div>
        <div><dt className="text-[10px] text-muted">Primary message</dt><dd className="mt-1 whitespace-pre-wrap">{payload.message || 'Message unavailable'}</dd></div>
        <div><dt className="text-[10px] text-muted">Format</dt><dd className="mt-1 font-semibold">{contentFormatLabel(payload.format)}</dd></div>
        <div><dt className="text-[10px] text-muted">Claims</dt><dd className="mt-1 whitespace-pre-wrap">{payload.claims || 'Claims unavailable'}</dd></div>
        <div><dt className="text-[10px] text-muted">Shot list or outline</dt><dd className="mt-1 whitespace-pre-wrap">{payload.shotList || 'Shot list unavailable'}</dd></div>
        <div><dt className="text-[10px] text-muted">Acceptance criteria</dt><dd className="mt-1 whitespace-pre-wrap">{payload.acceptanceCriteria || 'Acceptance criteria unavailable'}</dd></div>
        <div><dt className="text-[10px] text-muted">Evidence reference</dt><dd className="mt-1 whitespace-pre-wrap">{payload.evidenceReference || 'Evidence reference unavailable'}</dd></div>
        <div className="sm:col-span-2"><dt className="text-[10px] text-muted">Intended channels</dt><dd className="mt-1 font-semibold">{(payload.channels || []).map(contentChannelLabel).join(' · ') || 'Channels unavailable'}</dd></div>
      </dl>
    </Card>
    <Card>
      <SectionTitle caption="References resolve through the owning Marketing, Files and Project Manager services">Owner references</SectionTitle>
      <div className="grid gap-2 sm:grid-cols-2">
        <ReferenceRow label="Campaign">{initiative?.title || initiative?.name || (payload.initiativeId ? 'Campaign reference unavailable' : 'No Campaign reference')}</ReferenceRow>
        <ReferenceRow label="Output source file" status={assetReference?.status === 'READY' ? 'ACTIVE' : assetReference?.status || undefined}>{assetReference?.file?.name || assetReference?.name || (payload.asset ? 'File reference unavailable' : 'No output linked')}</ReferenceRow>
        <ReferenceRow label="Production Project" status={productionReference?.status}>{productionReference?.project?.name || productionReference?.project?.title || (payload.production ? 'Project reference unavailable' : 'No PM Project linked')}</ReferenceRow>
        <ReferenceRow label="Production task">{productionReference?.workItem?.title || (payload.production?.workItemId ? 'Task reference unavailable' : 'No task linked')}</ReferenceRow>
      </div>
      {assetVersionId && <Link className="btn mt-3 inline-flex items-center gap-1 text-[11px]" href={contentAssetPagePath(assetVersionId)}><FileText size={13} aria-hidden /> Open asset revision</Link>}
      {productionReference?.project?.id && <Link className="btn ml-2 mt-3 inline-flex text-[11px]" href={`/projects/${encodeURIComponent(productionReference.project.id)}/roadmap`}>Open PM roadmap</Link>}
    </Card>
  </div>
}

function ReviewForm({ version, busy, viewerId, onSubmit }) {
  const [verdict, setVerdict] = useState('PASS')
  const [rationale, setRationale] = useState('')
  const [rightsConfirmed, setRightsConfirmed] = useState(false)
  const [brandConfirmed, setBrandConfirmed] = useState(false)
  const independent = Boolean(viewerId && version?.createdBy && viewerId !== version.createdBy)
  if (!independent) return <InlineNotice>Independent review requires another real user. The revision owner cannot supply this review.</InlineNotice>
  return <Card data-testid="marketing-content-review">
    <SectionTitle caption="Review the exact current revision before a human decision">Record review</SectionTitle>
    <div className="grid gap-x-4 md:grid-cols-2">
      <Field label="Review verdict"><select className="input" value={verdict} onChange={(event) => setVerdict(event.target.value)}><option value="PASS">Pass</option><option value="CHANGES_REQUIRED">Changes required</option></select></Field>
      <div className="text-[10px] text-muted">Revision {version?.revision || 'unavailable'} · {formatContentDateTime(version?.createdAt)}</div>
    </div>
    <Field label="Rationale"><textarea className="input min-h-24" value={rationale} onChange={(event) => setRationale(event.target.value)} required /></Field>
    {verdict === 'PASS' && <div className="mb-3 flex flex-wrap gap-3 text-xs"><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={rightsConfirmed} onChange={(event) => setRightsConfirmed(event.target.checked)} /> Rights confirmed</label><label className="inline-flex items-center gap-1.5"><input type="checkbox" checked={brandConfirmed} onChange={(event) => setBrandConfirmed(event.target.checked)} /> Brand claims confirmed</label></div>}
    <button type="button" className="btn btn-primary" disabled={busy || !rationale.trim() || (verdict === 'PASS' && (!rightsConfirmed || !brandConfirmed))} onClick={() => onSubmit({ contentVersionId: version.id, payloadHash: version.payloadHash, verdict, rationale, rightsConfirmed, brandConfirmed })}>{busy ? 'Saving…' : 'Record review'}</button>
  </Card>
}

function DecisionForm({ brief, version, busy, onSubmit }) {
  const passReview = latestPassReview(brief, version)
  const [verdict, setVerdict] = useState('APPROVE')
  const [reviewId, setReviewId] = useState(passReview?.id || '')
  const [rationale, setRationale] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const passReviews = passReview ? [passReview] : []
  useEffect(() => { setReviewId(passReview?.id || '') }, [passReview?.id])
  return <Card data-testid="marketing-content-decision">
    <SectionTitle caption="A human decision binds the current revision, matching review and rights window">Record decision</SectionTitle>
    <div className="grid gap-x-4 md:grid-cols-2">
      <Field label="Decision"><select className="input" value={verdict} onChange={(event) => setVerdict(event.target.value)}><option value="APPROVE">Approve</option><option value="REJECT">Reject</option><option value="REVOKE">Revoke approval</option></select></Field>
      <Field label="Matching review"><select className="input" value={reviewId} onChange={(event) => setReviewId(event.target.value)} disabled={verdict !== 'APPROVE'}><option value="">No matching PASS review</option>{passReviews.map((review) => <option key={review.id} value={review.id}>Pass · {actorLabel(review.reviewerId)} · {formatContentDateTime(review.createdAt)}</option>)}</select></Field>
      {verdict === 'APPROVE' && <Field label="Approval expires"><input className="input" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} required /></Field>}
    </div>
    <Field label="Rationale"><textarea className="input min-h-24" value={rationale} onChange={(event) => setRationale(event.target.value)} required /></Field>
    {!passReviews.length && verdict === 'APPROVE' && <InlineNotice>Approval requires a current independent PASS review and an active rights window.</InlineNotice>}
    <button type="button" className="btn btn-primary" disabled={busy || !rationale.trim() || (verdict === 'APPROVE' && (!reviewId || !expiresAt))} onClick={() => onSubmit({ contentVersionId: version.id, payloadHash: version.payloadHash, reviewId: reviewId || null, verdict, rationale, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null })}>{busy ? 'Saving…' : 'Record decision'}</button>
  </Card>
}

export default function ContentBriefDetail({ businessId, briefId }) {
  const detail = useFetch(businessId && briefId ? contentBriefApiPath(briefId, businessId) : null, [businessId, briefId])
  const viewer = useFetch('/api/viewer')
  const [busy, setBusy] = useState(false)
  const [mutationError, setMutationError] = useState(null)
  const brief = responseForScope(detail.data, businessId, briefId)
  const version = currentContentVersion(brief)
  const canWrite = brief?.canWrite === true && brief?.status !== 'ARCHIVED'
  const viewerId = viewer.data?.principal?.id || viewer.data?.personId || viewer.data?.id || null

  const mutate = async (action, extra = {}) => {
    if (!brief || !businessId) return null
    setBusy(true)
    setMutationError(null)
    try {
      const result = await api(contentBriefApiPath(brief.id, businessId), { method: 'PATCH', body: { businessId, expectedVersion: brief.version, action, ...extra } })
      await detail.reload()
      return result
    } catch (error) {
      setMutationError(error.message)
      return null
    } finally {
      setBusy(false)
    }
  }

  if (!businessId) return <ScopeNotice />
  if (detail.loading && !brief) return <main className="mx-auto max-w-6xl p-5 max-md:p-3"><LoadingCard /></main>
  if (detail.error) return <main className="mx-auto max-w-6xl p-5 max-md:p-3"><ErrorState title="Creative brief unavailable" detail={detail.error} retry={detail.reload} /></main>
  if (!brief) return <main className="mx-auto max-w-6xl p-5 max-md:p-3"><ErrorState title="Creative brief unavailable" detail="The requested brief does not belong to the active Business scope." retry={detail.reload} /></main>

  return <main className="mx-auto max-w-6xl p-5 max-md:p-3">
    <PageHeader eyebrow="MARKETING / CONTENT & CREATIVE" title={brief.title || 'Creative brief'} subtitle={`Owner ${contentOwnerLabel(brief)} · revision ${brief.currentRevision || version?.revision || 1}`} actions={<StatusPill status={brief.phase || brief.status || 'DRAFT'} />} />
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><Link href="/growth/content?tab=briefs" className="btn text-[11px]"><ArrowLeft size={13} aria-hidden /> Back to briefs</Link><div className="flex flex-wrap gap-2">{canWrite && <button type="button" className="btn text-[11px]" onClick={() => mutate('archive')} disabled={busy}><Archive size={13} aria-hidden /> Archive brief</button>}</div></div>
    {mutationError && <div className="mb-4"><InlineNotice tone="error">{mutationError} Refresh the brief before retrying a stale write.</InlineNotice></div>}
    {brief.status === 'ARCHIVED' && <div className="mb-4"><InlineNotice>Archived briefs are read-only. Historical revisions and decisions remain visible.</InlineNotice></div>}
    <MarketingDataState loading={detail.loading && !brief} error={null} retry={detail.reload}>
      <BriefRead brief={brief} />
      <div className="mt-4 space-y-4">
        {canWrite && <ContentBriefForm key={`revise-${brief.id}-${version?.id || brief.version}`} businessId={businessId} brief={brief} busy={busy} submitLabel="Save new revision" titleLabel="Revise creative brief" onSubmit={({ title, payload }) => mutate('revise', { title, payload })} />}
        {!canWrite && brief.status !== 'ARCHIVED' && <InlineNotice>This brief is read-only for the current Business grant.</InlineNotice>}
        <ContentVersionHistory key={`history-${brief.id}`} brief={brief} />
        {canWrite && version && <ReviewForm key={`review-${brief.id}-${version.id}`} version={version} viewerId={viewerId} busy={busy} onSubmit={(input) => mutate('review', input)} />}
        {canWrite && version && <DecisionForm key={`decision-${brief.id}-${version.id}`} brief={brief} version={version} busy={busy} onSubmit={(input) => mutate('decide', input)} />}
        <ContentReviewDecisionHistory key={`decisions-${brief.id}`} brief={brief} />
      </div>
    </MarketingDataState>
  </main>
}
