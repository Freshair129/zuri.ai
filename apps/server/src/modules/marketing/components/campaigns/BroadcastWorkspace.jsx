'use client'

// @req FR-185 — durable PLANNING intent UI with explicit dispatch-unavailable
// state; no recipient count, send action or provider receipt is rendered.
// @spec SDD-086, SEC-001, SEC-003
// @tested tests/e2e/marketing-p5.spec.js

import { useState } from 'react'
import { Card, EmptyState, Field, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { api, useFetch } from '@/modules/project-manager/components/useApi'
import { MarketingDataState, ScopeNotice, SourceNote } from '../MarketingState'
import { broadcastPayloadTemplate, BROADCAST_DISPATCH_UNAVAILABLE } from '../marketing-broadcast-client-contract'

const CONSENT_CRITERIA_HASH = '40a2ec2eb918a1ac9ba76e6a0f811b8b3e38eec32f0fe654388123122b780268'

export default function BroadcastWorkspace({ businessId }) {
  const endpoint = businessId ? `/api/growth/broadcast-intents?businessId=${encodeURIComponent(businessId)}` : null
  const { data, loading, error, reload } = useFetch(endpoint, [businessId])
  const [code, setCode] = useState('')
  const [idempotencyKey, setIdempotencyKey] = useState('')
  const [briefId, setBriefId] = useState('')
  const [contentVersionId, setContentVersionId] = useState('')
  const [contentHash, setContentHash] = useState('')
  const [accountId, setAccountId] = useState('')
  const [accountVersion, setAccountVersion] = useState('1')
  const [submitting, setSubmitting] = useState(false)
  const [message, setMessage] = useState(null)

  if (!businessId) return <ScopeNotice />
  async function createIntent(event) {
    event.preventDefault()
    setSubmitting(true)
    setMessage(null)
    try {
      await api('/api/growth/broadcast-intents', { method: 'POST', body: { businessId, idempotencyKey, ...(code.trim() ? { code } : {}), payload: broadcastPayloadTemplate({ briefId, contentVersionId, payloadHash: contentHash, lineOaAccountId: accountId, accountVersion, criteriaHash: CONSENT_CRITERIA_HASH }) } })
      setMessage('Planning intent saved.')
      setIdempotencyKey('')
      await reload()
    } catch (requestError) {
      setMessage(requestError.message)
    } finally {
      setSubmitting(false)
    }
  }
  const intents = Array.isArray(data?.intents) ? data.intents : []
  return (
    <main className="mx-auto max-w-6xl p-5 max-md:p-3">
      <PageHeader eyebrow="MARKETING" title="Broadcast planning" subtitle="Save a LINE planning intent for review. Dispatch is unavailable in this approved slice." />
      <MarketingDataState loading={loading} error={error} retry={reload}>
        {data?.canWrite && <Card className="mb-5"><SectionTitle caption="References are validated through their owning modules; message bodies and audiences are never copied.">New planning intent</SectionTitle><form onSubmit={createIntent} className="grid gap-3 sm:grid-cols-2"><Field label="Idempotency key"><input required value={idempotencyKey} onChange={(event) => setIdempotencyKey(event.target.value)} className="input w-full" /></Field><Field label="Business code (optional)"><input value={code} onChange={(event) => setCode(event.target.value)} className="input w-full" /></Field><Field label="Content brief id"><input required value={briefId} onChange={(event) => setBriefId(event.target.value)} className="input w-full" /></Field><Field label="Content version id"><input required value={contentVersionId} onChange={(event) => setContentVersionId(event.target.value)} className="input w-full" /></Field><Field label="Content payload hash"><input required pattern="[a-f0-9]{64}" value={contentHash} onChange={(event) => setContentHash(event.target.value)} className="input w-full" /></Field><Field label="LINE OA account id (optional)"><input value={accountId} onChange={(event) => setAccountId(event.target.value)} className="input w-full" /></Field><Field label="Account version"><input type="number" min="1" value={accountVersion} onChange={(event) => setAccountVersion(event.target.value)} className="input w-full" /></Field><div className="flex items-end"><button className="btn btn-primary w-full" disabled={submitting}>{submitting ? 'Saving…' : 'Save planning intent'}</button></div></form>{message && <p className="mt-3 text-xs" role="status">{message}</p>}</Card>}
        <Card><SectionTitle caption="Append-only revisions retain internal references and hashes.">Saved intents</SectionTitle>{intents.length === 0 ? <EmptyState title="No planning intents" hint="Create a planning intent after a content owner version is available." /> : <div className="space-y-2">{intents.map((intent) => <div key={intent.id} className="rounded-lg border border-[var(--border)] p-3"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold">{intent.code}</p><p className="mt-1 text-[10px] text-muted">revision {intent.currentRevision} · version {intent.version}</p></div><StatusPill status={intent.status} /></div><p className="mt-2 text-[11px] text-muted">Dispatch: {BROADCAST_DISPATCH_UNAVAILABLE.reasonCode}</p></div>)}</div>}<SourceNote>Marketing owns the planning identity. CRM, provider and LINE send readers are not invoked.</SourceNote></Card>
      </MarketingDataState>
    </main>
  )
}

