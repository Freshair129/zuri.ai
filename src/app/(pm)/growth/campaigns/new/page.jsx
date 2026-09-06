'use client'

// @req FR-156 — Campaign creation persists a complete Strategy payload with a
// required campaignBrief before navigating to the new initiative detail.
// @spec SDD-087, SEC-001, SEC-003 — writes are Business-owner and API-authorized.
// @tested tests/unit/marketing-campaign-ui.test.js, tests/e2e/marketing-campaigns.spec.js

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { PageHeader } from '@/components/ui'
import { useScope } from '@/context/ScopeContext'
import { api, useFetch } from '@/modules/project-manager/components/useApi'
import { MarketingDataState, ScopeNotice, InlineNotice } from '@/modules/marketing/components/MarketingState'
import { growthCampaignsPath } from '@/modules/marketing/components/campaigns/campaign-contract'
import CampaignForm from '@/modules/marketing/components/campaigns/CampaignForm'

export default function NewMarketingCampaignPage() {
  const scope = useScope()
  const router = useRouter()
  const businessId = scope.shell.activeBusinessId
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const capability = useFetch(businessId ? growthCampaignsPath(businessId) : null, [businessId])

  if (!businessId) return <ScopeNotice />
  const canWrite = capability.data?.canWrite === true

  const create = async ({ title, payload }) => {
    setBusy(true)
    setError(null)
    try {
      const result = await api('/api/growth/campaigns', { method: 'POST', body: { businessId, title, payload } })
      const created = result?.campaign || result?.initiative || result
      if (created?.id) router.replace(`/growth/campaigns/${encodeURIComponent(created.id)}?tab=brief`)
      else setError('Campaign creation did not return an initiative identity.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto max-w-6xl p-5 max-md:p-3">
      <PageHeader eyebrow="MARKETING / CAMPAIGNS" title="New campaign brief" subtitle="Create a Business initiative before provider campaigns or PM execution." actions={<Link href="/growth/campaigns" className="btn">Cancel</Link>} />
      <MarketingDataState loading={capability.loading} error={capability.error} retry={capability.reload}>
        {!canWrite ? <InlineNotice>Campaign creation requires Business owner access.</InlineNotice> : <CampaignForm busy={busy} onSubmit={create} onCancel={() => router.replace('/growth/campaigns')} />}
        {error && <div className="mt-3"><InlineNotice tone="error">{error}</InlineNotice></div>}
      </MarketingDataState>
    </main>
  )
}
