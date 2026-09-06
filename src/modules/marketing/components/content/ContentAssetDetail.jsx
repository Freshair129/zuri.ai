'use client'

// @req FR-157 — an asset route addresses the immutable MarketingContentVersion
// and shows only current, authorized source/rights/review evidence.
// @spec ZAI:FR-157-NOTE — Marketing never serves or stores FileAsset bytes and
// historical revisions do not inherit current approval.
// @tested tests/unit/marketing-content-ui.test.js, tests/e2e/marketing-content.spec.js

import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'
import { useMemo } from 'react'
import { Card, ErrorState, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { useFetch, LoadingCard } from '@/modules/project-manager/components/useApi'
import { InlineNotice, MarketingDataState, ScopeNotice } from '../MarketingState'
import {
  contentAssetApiPath,
  contentChannelLabel,
  contentFormatLabel,
  contentOwnerLabel,
  contentBriefPagePath,
  contentApprovalLabel,
  contentVersionPayload,
  fileSurfacePath,
  formatContentDateTime,
} from './content-contract'

function responseAsset(data, businessId, assetVersionId) {
  if (!data || (data.businessId && data.businessId !== businessId)) return null
  const version = data.assetVersion || null
  if (!version || version.id !== assetVersionId) return null
  return data
}

function reviewRows(brief, versionId) {
  return (Array.isArray(brief?.reviews) ? brief.reviews : []).filter((review) => review.contentVersionId === versionId)
}

function decisionRows(brief, versionId) {
  return (Array.isArray(brief?.decisions) ? brief.decisions : []).filter((decision) => decision.contentVersionId === versionId)
}

function actorLabel(value) {
  return value?.displayName || value || 'Actor unavailable'
}

export default function ContentAssetDetail({ businessId, assetVersionId }) {
  const detail = useFetch(businessId && assetVersionId ? contentAssetApiPath(assetVersionId, businessId) : null, [businessId, assetVersionId])
  const data = responseAsset(detail.data, businessId, assetVersionId)
  const version = data?.assetVersion || null
  const brief = data?.brief || null
  const payload = contentVersionPayload(version)
  const source = data?.references?.asset || brief?.references?.asset || null
  const file = source?.file || source
  const reviews = useMemo(() => reviewRows(brief, version?.id), [brief, version?.id])
  const decisions = useMemo(() => decisionRows(brief, version?.id), [brief, version?.id])
  const fileLink = source?.status === 'READY' && file?.id && file?.state === 'ACTIVE' ? fileSurfacePath(file.id) : null
  const usable = data?.usable === true
  const current = data?.isCurrent === true

  if (!businessId) return <ScopeNotice />
  if (detail.loading && !data) return <main className="mx-auto max-w-6xl p-5 max-md:p-3"><LoadingCard /></main>
  if (detail.error) return <main className="mx-auto max-w-6xl p-5 max-md:p-3"><ErrorState title="Creative asset unavailable" detail={detail.error} retry={detail.reload} /></main>
  if (!data || !version) return <main className="mx-auto max-w-6xl p-5 max-md:p-3"><ErrorState title="Creative asset unavailable" detail="The requested content revision does not belong to the active Business scope." retry={detail.reload} /></main>

  return <main className="mx-auto max-w-6xl p-5 max-md:p-3">
    <PageHeader eyebrow="MARKETING / CONTENT & CREATIVE" title={`${version.title || brief?.title || 'Creative asset'} · revision ${version.revision || 'unavailable'}`} subtitle={`Owner ${contentOwnerLabel(version)} · Content owns rights; Files owns source bytes`} actions={<StatusPill status={usable ? 'APPROVED' : current ? 'REVIEW' : 'ARCHIVED'} />} />
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><Link href="/growth/content?tab=library" className="btn text-[11px]"><ArrowLeft size={13} aria-hidden /> Back to library</Link>{brief?.id && <Link href={contentBriefPagePath(brief.id)} className="btn text-[11px]">Open brief</Link>}</div>
    {!current && <div className="mb-4"><InlineNotice>This is a historical content revision. It does not inherit the current revision approval.</InlineNotice></div>}
    {!usable && <div className="mb-4"><InlineNotice>Source, rights or approval evidence is not currently eligible for external use. Content does not publish or upload from this surface.</InlineNotice></div>}
    <MarketingDataState loading={detail.loading && !data} error={null} retry={detail.reload}>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <Card warm data-testid="marketing-content-asset-source"><SectionTitle caption="Open Files to inspect the authorized source record">Creative source</SectionTitle><div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface-mid)] p-6 text-center"><p className="text-sm font-semibold">{file?.name || source?.name || 'Source file unavailable'}</p>{file?.code && <p className="mt-1 text-[10px] text-muted">Source code: {file.code}</p>}<p className="mt-1 max-w-md text-xs text-muted">Content stores the source reference and rights evidence; Files controls source access and any preview.</p>{fileLink && <a className="btn mt-3 inline-flex items-center gap-1 text-[11px]" href={fileLink}><ExternalLink size={13} aria-hidden /> Open Files</a>}{!fileLink && <p className="mt-3 text-[10px] text-muted">Files source unavailable for this revision.</p>}</div></Card>
        <Card data-testid="marketing-content-asset-rights"><SectionTitle caption="Rights are part of this immutable content revision">Version and rights</SectionTitle><dl className="space-y-3 text-xs"><div><dt className="text-[10px] text-muted">Format</dt><dd className="mt-1 font-semibold">{contentFormatLabel(payload.format)}</dd></div><div><dt className="text-[10px] text-muted">Channels</dt><dd className="mt-1 font-semibold">{(payload.channels || []).map(contentChannelLabel).join(' · ') || 'Channels unavailable'}</dd></div><div><dt className="text-[10px] text-muted">File</dt><dd className="mt-1">{file?.name || source?.name || 'File reference unavailable'}{file?.version ? ` · file v${file.version}` : ''}</dd></div><div><dt className="text-[10px] text-muted">Rights holder</dt><dd className="mt-1">{payload.rights?.holder || 'Rights holder unavailable'}</dd></div><div><dt className="text-[10px] text-muted">License</dt><dd className="mt-1">{payload.rights?.license || 'License unavailable'}</dd></div><div><dt className="text-[10px] text-muted">Usage window</dt><dd className="mt-1">{payload.rights?.validFrom ? formatContentDateTime(payload.rights.validFrom) : 'Start unavailable'} → {payload.rights?.validUntil ? formatContentDateTime(payload.rights.validUntil) : 'End unavailable'}</dd></div><div><dt className="text-[10px] text-muted">Derivative use</dt><dd className="mt-1">{payload.rights?.channels?.length ? `Declared for ${payload.rights.channels.map(contentChannelLabel).join(' · ')}` : 'Separate rights check required'}</dd></div></dl></Card>
      </div>
      <Card className="mt-4" data-testid="marketing-content-asset-reviews"><SectionTitle caption="Review evidence is bound to this exact content revision">Review evidence</SectionTitle>{reviews.length === 0 ? <p className="text-xs text-muted">No review evidence recorded for this revision.</p> : <div className="space-y-2">{reviews.map((review) => <div key={review.id} className="rounded-lg border border-[var(--border)] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold">{review.verdict === 'PASS' ? 'Pass' : 'Changes required'}</p><p className="mt-1 text-[10px] text-muted">Reviewer: {actorLabel(review.reviewerId)} · {formatContentDateTime(review.createdAt)}</p></div><StatusPill status={review.verdict || 'UNKNOWN'} /></div><p className="mt-2 whitespace-pre-wrap text-xs">{review.rationale || 'No rationale recorded.'}</p><p className="mt-1 text-[10px] text-muted">Rights confirmed: {review.rightsConfirmed ? 'yes' : 'no'} · Brand confirmed: {review.brandConfirmed ? 'yes' : 'no'}</p></div>)}</div>}</Card>
      <Card className="mt-4"><SectionTitle caption="Approval remains revocable and revision-specific">Decision evidence</SectionTitle>{decisions.length === 0 ? <p className="text-xs text-muted">No decision recorded for this revision.</p> : <div className="space-y-2">{decisions.map((decision) => <div key={decision.id} className="rounded-lg border border-[var(--border)] p-3"><div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-xs font-semibold">{decision.verdict === 'APPROVE' ? 'Approve' : decision.verdict === 'REVOKE' ? 'Revoke approval' : 'Reject'}</p><p className="mt-1 text-[10px] text-muted">Actor: {actorLabel(decision.actorId)} · {formatContentDateTime(decision.createdAt)}</p></div><StatusPill status={decision.verdict || 'UNKNOWN'} /></div><p className="mt-2 whitespace-pre-wrap text-xs">{decision.rationale || 'No rationale recorded.'}</p>{decision.expiresAt && <p className="mt-1 text-[10px] text-muted">Expires: {formatContentDateTime(decision.expiresAt)}</p>}</div>)}</div>}</Card>
      <Card className="mt-4"><SectionTitle caption="Eligibility is evaluated by the server for this exact source file and rights window">Current eligibility</SectionTitle><div className="flex flex-wrap items-center gap-2"><StatusPill status={usable ? 'ACTIVE' : 'REVIEW'} /><span className="text-xs">{data.approval ? contentApprovalLabel(data.approval) : usable ? 'Approved and usable' : 'Approval unavailable'}</span></div>{source?.status === 'UNAVAILABLE' && <p className="mt-2 text-[10px] text-muted">Files owner reference is unavailable and intentionally exposes no hidden locator.</p>}</Card>
    </MarketingDataState>
  </main>
}
