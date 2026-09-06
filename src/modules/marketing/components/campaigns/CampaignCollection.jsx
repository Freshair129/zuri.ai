'use client'

// @req FR-156 — Campaign collection is a bounded Business-scoped projection
// with list/board presentation, phase filtering and a native create entry.
// @spec SDD-087, SEC-001 — no PM project or provider campaign is inferred from
// a title, label or mockup fixture.
// @tested tests/unit/marketing-campaign-ui.test.js, tests/e2e/marketing-campaigns.spec.js

import Link from 'next/link'
import { Plus } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Card, DataTable, EmptyState, PageHeader, StatusPill, TruncationNotice } from '@/components/ui'
import { useFetch } from '@/modules/project-manager/components/useApi'
import { MarketingDataState, ScopeNotice, UnavailableState } from '../MarketingState'
import { CAMPAIGN_PHASES, campaignBudget, campaignChannelLabel, campaignDateWindow, campaignPhase, growthCampaignPath, growthCampaignsPath } from './campaign-contract'

function campaignRows(data) {
  return Array.isArray(data?.campaigns) ? data.campaigns : []
}

function filteredCampaigns(campaigns, query, phase) {
  const needle = query.trim().toLowerCase()
  return campaigns.filter((campaign) => {
    if (phase && campaignPhase(campaign) !== phase) return false
    if (!needle) return true
    const text = [campaign.title, campaign.code, ...(campaign.channels || []).map(campaignChannelLabel)].join(' ').toLowerCase()
    return text.includes(needle)
  })
}

function listColumns() {
  return [
    {
      key: 'title',
      label: 'Campaign',
      render: (campaign) => <Link className="font-semibold underline-offset-2 hover:underline" href={growthCampaignPath(campaign.id, campaign.businessId)}>{campaign.title || 'Untitled campaign'}</Link>,
    },
    { key: 'channels', label: 'Channels', render: (campaign) => (campaign.channels || []).map(campaignChannelLabel).join(' · ') || 'Channels unavailable' },
    { key: 'phase', label: 'Phase', render: (campaign) => <StatusPill status={campaignPhase(campaign)} /> },
    { key: 'window', label: 'Window', render: campaignDateWindow },
    { key: 'budget', label: 'Budget', render: campaignBudget },
  ]
}

function Board({ campaigns }) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5" data-testid="marketing-campaign-board">
      {CAMPAIGN_PHASES.map((phase) => {
        const rows = campaigns.filter((campaign) => campaignPhase(campaign) === phase)
        return (
          <section key={phase} className="min-h-32 rounded-xl bg-[var(--surface-mid)] p-2" aria-labelledby={`campaign-phase-${phase}`}>
            <div className="mb-2 flex items-center justify-between gap-2 px-1"><h2 id={`campaign-phase-${phase}`} className="text-[11px] font-bold">{phase}</h2><span className="text-[10px] text-muted">{rows.length}</span></div>
            <div className="space-y-2">
              {rows.map((campaign) => (
                <Link key={campaign.id} href={growthCampaignPath(campaign.id, campaign.businessId)} className="block rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-2 hover:bg-[var(--brand-surface)]">
                  <p className="truncate text-xs font-semibold">{campaign.title || 'Untitled campaign'}</p>
                  <p className="mt-1 text-[10px] text-muted">{campaignDateWindow(campaign)}</p>
                  <p className="mt-1 text-[10px] text-muted">{campaignBudget(campaign)}</p>
                </Link>
              ))}
              {rows.length === 0 && <p className="px-1 py-3 text-[10px] text-muted">No campaigns</p>}
            </div>
          </section>
        )
      })}
    </div>
  )
}

export default function CampaignCollection({ businessId }) {
  const [view, setView] = useState('list')
  const [phase, setPhase] = useState('')
  const [query, setQuery] = useState('')
  const { data, loading, error, reload } = useFetch(businessId ? growthCampaignsPath(businessId) : null, [businessId])
  const campaigns = useMemo(() => filteredCampaigns(campaignRows(data), query, phase), [data, phase, query])

  if (!businessId) return <ScopeNotice />
  const canWrite = data?.canWrite === true
  const truncated = data?.truncated === true

  return (
    <main className="mx-auto max-w-6xl p-5 max-md:p-3">
      <PageHeader
        eyebrow="MARKETING / CAMPAIGNS"
        title="Campaigns"
        subtitle="One Business initiative can connect planning and PM execution. Provider campaigns are separate records."
        actions={canWrite && <Link href="/growth/campaigns/new" className="btn btn-primary"><Plus size={14} aria-hidden /> New campaign</Link>}
      />
      <MarketingDataState loading={loading} error={error} retry={reload}>
        <div className="mb-4 flex flex-wrap items-end gap-2" data-testid="marketing-campaign-controls">
          <label className="min-w-[220px] flex-1"><span className="mb-1 block text-[11px] font-bold text-muted">Search campaigns</span><input className="input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search visible campaigns" /></label>
          <label><span className="mb-1 block text-[11px] font-bold text-muted">Phase</span><select className="input" value={phase} onChange={(event) => setPhase(event.target.value)} aria-label="Filter by campaign phase"><option value="">All phases</option>{CAMPAIGN_PHASES.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
          <div className="flex rounded-lg border border-[var(--border)] bg-[var(--surface-card)] p-1" role="group" aria-label="Campaign presentation">
            {['list', 'board'].map((value) => <button key={value} type="button" className={`rounded-md px-3 py-2 text-xs font-semibold ${view === value ? 'bg-[var(--brand-tint)] text-[var(--brand-dark)]' : 'text-muted'}`} aria-pressed={view === value} onClick={() => setView(value)}>{value === 'list' ? 'List' : 'Board'}</button>)}
          </div>
        </div>
        {truncated && <TruncationNotice shown={campaignRows(data).length} limit={100} noun="campaigns" hint="Search and filter within the bounded result set returned for this Business." />}
        {campaignRows(data).length === 0 ? <UnavailableState title="No campaigns yet" hint={canWrite ? 'Create a campaign brief to connect a Marketing initiative to one Strategy plan.' : 'No Campaign records are available in this Business scope.'} /> : campaigns.length === 0 ? <EmptyState title="No campaigns match" hint="Change the search or phase filter." /> : view === 'list' ? <Card data-testid="marketing-campaign-list"><DataTable columns={listColumns()} rows={campaigns} rowKey={(row) => row.id} /></Card> : <Board campaigns={campaigns} />}
      </MarketingDataState>
    </main>
  )
}
