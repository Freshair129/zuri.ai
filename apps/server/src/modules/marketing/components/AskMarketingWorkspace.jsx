'use client'

// @req FR-185 — deterministic AskMarketing read-only UI exposes source state
// and never offers an action or provider call.
// @spec SDD-086, SEC-001, SEC-003
// @tested tests/e2e/marketing-p5.spec.js

import { useState } from 'react'
import { Card, PageHeader, SectionTitle, StatusPill } from '@/components/ui'
import { api } from '@/modules/project-manager/components/useApi'
import { ScopeNotice } from './MarketingState'

export default function AskMarketingWorkspace({ businessId }) {
  const [question, setQuestion] = useState('overview')
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  if (!businessId) return <ScopeNotice />
  async function ask(event) {
    event.preventDefault()
    setLoading(true)
    try { setResult(await api('/api/growth/ask-marketing', { method: 'POST', body: { businessId, question } })) } catch (error) { setResult({ state: 'UNKNOWN', unavailable: [{ source: 'ASK_MARKETING', reasonCode: error.message }] }) } finally { setLoading(false) }
  }
  return <main className="mx-auto max-w-3xl p-5 max-md:p-3"><PageHeader eyebrow="MARKETING" title="AskMarketing" subtitle="Deterministic read-only answers grounded in owner projections." /><Card><form onSubmit={ask} className="flex gap-2"><input aria-label="Marketing question" value={question} onChange={(event) => setQuestion(event.target.value)} className="input min-w-0 flex-1" /><button className="btn btn-primary" disabled={loading}>{loading ? 'Reading…' : 'Ask'}</button></form>{result && <div className="mt-5" aria-live="polite"><div className="flex items-center justify-between"><SectionTitle caption={result.intentType || 'No classification'}>Result</SectionTitle><StatusPill status={result.state} /></div>{result.answer?.sections?.length ? <div className="space-y-2">{result.answer.sections.map((section) => <div key={section.key} className="rounded-lg border border-[var(--border)] p-3 text-xs"><strong>{section.title}</strong>{section.count !== undefined && <span className="ml-2 text-muted">{section.count}</span>}{section.value !== undefined && <span className="ml-2 text-muted">{section.value}</span>}</div>)}</div> : <p className="rounded-lg bg-[var(--brand-tint)] p-3 text-xs">No measured answer is available for this question.</p>}{result.unavailable?.length > 0 && <ul className="mt-3 space-y-1 text-[11px] text-muted">{result.unavailable.map((item, index) => <li key={`${item.source}-${index}`}>{item.source}: {item.reasonCode}</li>)}</ul>}</div>}</Card></main>
}

