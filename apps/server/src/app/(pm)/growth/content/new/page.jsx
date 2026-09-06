'use client'

// @req FR-157 — a Business owner can create a persisted creative brief with
// real FileAsset, Project and WorkItem references.
// @spec ZAI:FR-157-NOTE — create accepts intent references only; server resolves
// file version/fingerprint and creator authority.
// @tested tests/unit/marketing-content-ui.test.js, tests/e2e/marketing-content.spec.js

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PageHeader } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, useFetch } from '@/modules/project-manager/components/useApi'
import { MarketingDataState, InlineNotice, ScopeNotice } from '@/modules/marketing/components/MarketingState'
import ContentBriefForm from '@/modules/marketing/components/content/ContentBriefForm'
import { contentBriefPagePath, contentCollectionPath, CONTENT_API_PATH } from '@/modules/marketing/components/content/content-contract'

export default function NewMarketingContentPage() {
  const scope = useScope()
  const router = useRouter()
  const businessId = scope.shell.activeBusinessId
  const capability = useFetch(businessId ? contentCollectionPath(businessId) : null, [businessId])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  if (!businessId) return <ScopeNotice />
  const canWrite = capability.data?.canWrite === true

  const create = async ({ title, payload }) => {
    setBusy(true)
    setError(null)
    try {
      const result = await api(CONTENT_API_PATH, { method: 'POST', body: { businessId, title, payload } })
      const created = result?.brief || result?.contentBrief || result
      if (!created?.id) throw new Error('Creative brief creation did not return an identity.')
      router.replace(contentBriefPagePath(created.id))
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return <main className="mx-auto max-w-6xl p-5 max-md:p-3">
    <PageHeader eyebrow="MARKETING / CONTENT & CREATIVE" title="New creative brief" subtitle="Capture intent, evidence and owner references before production begins." actions={<Link href="/growth/content?tab=briefs" className="btn">Back to briefs</Link>} />
    <MarketingDataState loading={capability.loading} error={capability.error} retry={capability.reload}>
      {!canWrite ? <InlineNotice>Creating a Content brief requires Business owner access.</InlineNotice> : <ContentBriefForm businessId={businessId} busy={busy} onSubmit={create} onCancel={() => router.replace('/growth/content?tab=briefs')} />}
      {error && <div className="mt-3"><InlineNotice tone="error">{error}</InlineNotice></div>}
    </MarketingDataState>
  </main>
}
